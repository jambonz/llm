import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type {
  ApiKeyAuth,
  ClientOptions,
  FinishReason,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelCapabilities,
  ModelInfo,
  PromptRequest,
  Tool,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';
import { openAIManifest } from './manifest.js';

/**
 * Adapter for OpenAI (and OpenAI-compatible endpoints: DeepSeek, LM Studio,
 * Ollama, vLLM, custom gateways).
 *
 * The `deepseek` vendor id is an alias — see `registerAliases()`. When a
 * consumer calls `createLlm({vendor: 'deepseek', ...})` the library returns
 * an `OpenAIAdapter` with `baseURL` defaulted to DeepSeek's endpoint.
 */
export class OpenAIAdapter implements LlmAdapter<ApiKeyAuth> {
  readonly vendor = openAIManifest.vendor;
  readonly acceptedAuth = ['apiKey'] as const;

  private client: OpenAI | undefined;

  init(auth: ApiKeyAuth, client?: ClientOptions): void {
    if (!auth.apiKey) {
      throw new Error('OpenAIAdapter: apiKey is required');
    }
    this.client = new OpenAI({
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

    const capabilities = capabilitiesFor(req.model);
    const useTools = req.tools && req.tools.length > 0 && capabilities.tools;

    const messages = buildWireMessages(req);
    const tools = useTools ? formatTools(req.tools!) : undefined;

    const body: ChatCompletionCreateParamsStreaming = {
      model: req.model,
      messages: messages as ChatCompletionCreateParamsStreaming['messages'],
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools) {
      body.tools = tools as unknown as ChatCompletionCreateParamsStreaming['tools'];
      body.tool_choice = 'auto';
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    let stream;
    try {
      stream = await client.chat.completions.create(body, { signal: req.signal });
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    const pending: Record<number, PendingToolCall> = {};
    const startedIds = new Set<string>();
    const toolCallsEmitted = new Set<string>();
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    let finalFinishReason: FinishReason | null = null;
    let finalRawReason: string | undefined;

    try {
      for await (const chunk of stream) {
        if (req.signal?.aborted) {
          yield { type: 'end', finishReason: 'aborted' };
          return;
        }

        if (chunk.usage) {
          usage = {
            ...(chunk.usage.prompt_tokens !== undefined
              ? { inputTokens: chunk.usage.prompt_tokens }
              : {}),
            ...(chunk.usage.completion_tokens !== undefined
              ? { outputTokens: chunk.usage.completion_tokens }
              : {}),
            ...(chunk.usage.total_tokens !== undefined
              ? { totalTokens: chunk.usage.total_tokens }
              : {}),
          };
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        const finishReason = choice.finish_reason;

        if (delta?.content) {
          yield { type: 'token', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!pending[idx]) {
              pending[idx] = { id: '', name: '', arguments: '' };
            }
            if (tc.id) pending[idx].id += tc.id;
            if (tc.function?.name) pending[idx].name += tc.function.name;
            if (tc.function?.arguments) pending[idx].arguments += tc.function.arguments;

            if (pending[idx].id && pending[idx].name && !startedIds.has(pending[idx].id)) {
              startedIds.add(pending[idx].id);
              yield {
                type: 'toolCallStart',
                id: pending[idx].id,
                name: pending[idx].name,
              };
            }
          }
        }

        if (finishReason === 'tool_calls') {
          if (req.signal?.aborted) {
            yield { type: 'end', finishReason: 'aborted' };
            return;
          }
          for (const tc of Object.values(pending)) {
            if (!tc.id || !tc.name) continue;
            if (toolCallsEmitted.has(tc.id)) continue;
            toolCallsEmitted.add(tc.id);
            let args: unknown = {};
            try {
              args = tc.arguments ? JSON.parse(tc.arguments) : {};
            } catch {
              args = {};
            }
            yield {
              type: 'toolCall',
              id: tc.id,
              name: tc.name,
              arguments: args,
            };
          }
          finalFinishReason = 'tool';
          finalRawReason = finishReason;
          // Don't return — keep draining so we can pick up the post-finish usage chunk.
        } else if (finishReason) {
          finalFinishReason = mapFinishReason(finishReason);
          finalRawReason = finishReason;
          // Same reason — don't return yet.
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    const endEvent: Extract<LlmEvent, { type: 'end' }> = {
      type: 'end',
      finishReason: finalFinishReason ?? 'stop',
      ...(usage ? { usage } : {}),
      ...(finalRawReason ? { rawReason: finalRawReason } : {}),
    };
    yield endEvent;
  }

  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[] {
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    const wireMessage = {
      role: 'tool',
      tool_call_id: toolCallId,
      content,
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
      const known = openAIManifest.knownModels.find((k) => k.id === m.id);
      if (known) {
        models.push(known);
      } else {
        models.push({
          id: m.id,
          capabilities: defaultCapabilitiesForUnknown(m.id),
        });
      }
    }
    return models;
  }

  async warmup(): Promise<void> {
    const client = this.ensureClient();
    await client.models.list().catch(() => undefined);
  }

  private ensureClient(): OpenAI {
    if (!this.client) {
      throw new Error('OpenAIAdapter: init() must be called before stream()/listAvailableModels()');
    }
    return this.client;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

function buildWireMessages(req: PromptRequest): unknown[] {
  const out: unknown[] = [];
  if (req.system) {
    out.push({ role: 'system', content: req.system });
  }
  for (const msg of req.messages) {
    // If vendorRaw is an object, it IS the wire shape (preserves tool_calls,
    // tool_call_id, etc. that the normalized Message type doesn't capture).
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
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters ?? { type: 'object', properties: {} },
    },
  }));
}

function capabilitiesFor(modelId: string): ModelCapabilities {
  const known = openAIManifest.knownModels.find((k) => k.id === modelId);
  if (known) return known.capabilities;
  return defaultCapabilitiesForUnknown(modelId);
}

function defaultCapabilitiesForUnknown(modelId: string): ModelCapabilities {
  // Reasoning-family heuristics. Assume tool support is unavailable for o1/o3
  // prefixed ids; otherwise default to modern-GPT defaults.
  const isReasoning = /^o[13]([-/]|$)/i.test(modelId);
  if (isReasoning) {
    return {
      streaming: false,
      tools: false,
      vision: false,
      systemPrompt: false,
    };
  }
  return {
    streaming: true,
    tools: true,
    vision: false,
    systemPrompt: true,
  };
}

function mapFinishReason(r: string): FinishReason {
  switch (r) {
    case 'stop': return 'stop';
    case 'tool_calls': return 'tool';
    case 'function_call': return 'tool';
    case 'length': return 'length';
    case 'content_filter': return 'filtered';
    default: return 'stop';
  }
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
