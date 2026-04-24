import Anthropic from '@anthropic-ai/sdk';
import type {
  ApiKeyAuth,
  ClientOptions,
  FinishReason,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  Tool,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';
import { anthropicManifest } from './manifest.js';

/**
 * Adapter for Anthropic Claude.
 *
 * Key wire-shape differences from OpenAI:
 *   - `system` is a top-level request parameter, not a message.
 *   - Tool schema is `{name, description, input_schema}` (not `parameters`).
 *   - Tool results are `{role: 'user', content: [{type: 'tool_result', tool_use_id, content}]}`
 *     — note role: 'user', not 'tool'.
 *   - Assistant messages with tool calls carry `content: [{type: 'tool_use', id, name, input}]`
 *     — content is an array of blocks, not a string or a separate tool_calls array.
 *   - Stream events are content-block based (content_block_start/delta/stop + message_*).
 *   - `max_tokens` is REQUIRED; we default to 4096 if the caller doesn't set one.
 */
export class AnthropicAdapter implements LlmAdapter<ApiKeyAuth> {
  readonly vendor = anthropicManifest.vendor;
  readonly acceptedAuth = ['apiKey'] as const;

  private client: Anthropic | undefined;

  init(auth: ApiKeyAuth, client?: ClientOptions): void {
    if (!auth.apiKey) {
      throw new Error('AnthropicAdapter: apiKey is required');
    }
    this.client = new Anthropic({
      apiKey: auth.apiKey,
      ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
      ...(client?.timeout !== undefined ? { timeout: client.timeout } : {}),
      ...(client?.maxRetries !== undefined ? { maxRetries: client.maxRetries } : {}),
    });
  }

  async *stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    assertValidRequest(req);
    const client = this.ensureClient();

    if (req.signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }

    const messages = buildWireMessages(req);
    const tools = req.tools && req.tools.length > 0 ? formatTools(req.tools) : undefined;

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 4_096,
      stream: true,
    };
    if (req.system) body.system = req.system;
    if (tools) body.tools = tools;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    let stream;
    try {
      stream = await client.messages.create(
        body as unknown as Parameters<typeof client.messages.create>[0],
        { signal: req.signal },
      );
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    let currentToolUse: PendingToolUse | null = null;
    const completedToolCalls: CompletedToolCall[] = [];
    let stopReason: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      for await (const event of stream as unknown as AsyncIterable<AnthropicStreamEvent>) {
        if (req.signal?.aborted) {
          yield { type: 'end', finishReason: 'aborted' };
          return;
        }

        switch (event.type) {
          case 'message_start':
            inputTokens = event.message?.usage?.input_tokens;
            break;

          case 'content_block_start': {
            const block = event.content_block;
            if (block?.type === 'tool_use') {
              currentToolUse = {
                id: block.id ?? '',
                name: block.name ?? '',
                argumentsText: '',
              };
              if (currentToolUse.id && currentToolUse.name) {
                yield {
                  type: 'toolCallStart',
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                };
              }
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              yield { type: 'token', text: delta.text };
            } else if (delta?.type === 'input_json_delta' && currentToolUse && delta.partial_json) {
              currentToolUse.argumentsText += delta.partial_json;
            }
            break;
          }

          case 'content_block_stop':
            if (currentToolUse && currentToolUse.id && currentToolUse.name) {
              let parsed: unknown = {};
              try {
                parsed = currentToolUse.argumentsText
                  ? JSON.parse(currentToolUse.argumentsText)
                  : {};
              } catch {
                parsed = {};
              }
              completedToolCalls.push({
                id: currentToolUse.id,
                name: currentToolUse.name,
                arguments: parsed,
              });
            }
            currentToolUse = null;
            break;

          case 'message_delta':
            if (event.delta?.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            if (event.usage?.output_tokens !== undefined) {
              outputTokens = event.usage.output_tokens;
            }
            break;

          case 'message_stop':
            // No-op — we synthesize the `end` event after the loop completes.
            break;

          default:
            // Ignore unknown event types (forward compat).
            break;
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    if (req.signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }

    // Emit accumulated tool calls before the end event.
    for (const tc of completedToolCalls) {
      yield {
        type: 'toolCall',
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      };
    }

    const finishReason = mapStopReason(stopReason, completedToolCalls.length > 0);
    const usage =
      inputTokens !== undefined || outputTokens !== undefined
        ? {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(inputTokens !== undefined && outputTokens !== undefined
              ? { totalTokens: inputTokens + outputTokens }
              : {}),
          }
        : undefined;

    const endEvent: Extract<LlmEvent, { type: 'end' }> = {
      type: 'end',
      finishReason,
      ...(usage ? { usage } : {}),
      ...(stopReason ? { rawReason: stopReason } : {}),
    };
    yield endEvent;
  }

  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[] {
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    const wireMessage = {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content,
        },
      ],
    };
    return [
      ...history,
      {
        role: 'tool',
        content,
        vendorRaw: wireMessage,
      },
    ];
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    const client = this.ensureClient();
    const result = await client.models.list();
    const models: ModelInfo[] = [];
    for (const m of result.data) {
      const known = anthropicManifest.knownModels.find((k) => k.id === m.id);
      if (known) {
        models.push(known);
      } else {
        models.push({
          id: m.id,
          displayName: m.display_name ?? undefined,
          capabilities: defaultClaudeCapabilities(),
        });
      }
    }
    return models;
  }

  async warmup(): Promise<void> {
    const client = this.ensureClient();
    await client.models.list().catch(() => undefined);
  }

  private ensureClient(): Anthropic {
    if (!this.client) {
      throw new Error('AnthropicAdapter: init() must be called before stream()/listAvailableModels()');
    }
    return this.client;
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PendingToolUse {
  id: string;
  name: string;
  argumentsText: string;
}

interface CompletedToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWireMessages(req: PromptRequest): unknown[] {
  const out: unknown[] = [];
  for (const msg of req.messages) {
    if (msg.vendorRaw && typeof msg.vendorRaw === 'object') {
      out.push(msg.vendorRaw);
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }
  return out;
}

function formatTools(tools: Tool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.parameters ?? { type: 'object', properties: {} },
  }));
}

function mapStopReason(r: string | undefined, hadToolCalls: boolean): FinishReason {
  if (hadToolCalls) return 'tool';
  switch (r) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool';
    case 'max_tokens':
      return 'length';
    default:
      return 'stop';
  }
}

function defaultClaudeCapabilities() {
  return {
    streaming: true,
    tools: true,
    vision: true,
    systemPrompt: true,
  };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === 'APIUserAbortError' ||
    e.name === 'AbortError' ||
    e.code === 'ABORT_ERR' ||
    (typeof e.message === 'string' && /aborted/i.test(e.message))
  );
}
