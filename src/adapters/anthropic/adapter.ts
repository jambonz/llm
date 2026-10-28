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
  ToolCallEvent,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';
import { makeMetadataExtractor } from '../_metadata.js';
import { anthropicManifest } from './manifest.js';

/**
 * Anthropic response-header diagnostics. `request-id` is the support-ticket
 * id; the rate-limit headers help operators see when an account is
 * approaching limits across turns within a call.
 */
const ANTHROPIC_METADATA_EXTRACTOR = makeMetadataExtractor([
  { header: 'request-id', key: 'request_id' },
  { header: 'anthropic-ratelimit-requests-remaining', key: 'requests_remaining', numeric: true },
  { header: 'anthropic-ratelimit-input-tokens-remaining', key: 'input_tokens_remaining', numeric: true },
  { header: 'anthropic-ratelimit-output-tokens-remaining', key: 'output_tokens_remaining', numeric: true },
]);

/**
 * Models that return 400 on any non-default sampling parameter. Opus 4.7
 * dropped `temperature` / `top_p` / `top_k`, and every Claude model since
 * (Opus 4.8 and 5.x, Sonnet 5.x, Haiku 5.5, Fable, Mythos) does the same.
 * `temperature` is left out of their requests: a value the model cannot
 * honor is not worth failing every call over.
 */
const REJECTS_SAMPLING_PARAMS = /^claude-(opus-4-[7-9]|opus-5|sonnet-5|haiku-5|fable|mythos)/;

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
    if (req.temperature !== undefined && !REJECTS_SAMPLING_PARAMS.test(req.model)) {
      body.temperature = req.temperature;
    }

    // Merge caller-supplied provider-specific params (e.g. Claude's
    // `output_config: {effort}` or `thinking`). Add-only: never overwrite a
    // library-managed field, so this can extend the request but not corrupt
    // its core shape.
    if (req.providerParams) {
      for (const [key, value] of Object.entries(req.providerParams)) {
        if (!(key in body)) body[key] = value;
      }
    }

    if (req.cacheKey) {
      if (req.system) {
        body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
      }
      if (tools) {
        const lastTool = tools[tools.length - 1];
        lastTool.cache_control = { type: 'ephemeral' };
      }
      // Third breakpoint on the final message so the ENTIRE conversation
      // prefix is cached, not just system + tools. In the append-only
      // conversation pattern each turn's request extends the previous one,
      // so the moving breakpoint hits the prior turn's cache via Anthropic's
      // longest-prefix matching. Without this, the growing history — the
      // bulk of mid-call input tokens — is re-billed at full price every turn.
      markLastMessageForCaching(messages);
    }

    // Production: `.withResponse()` on the Anthropic SDK's APIPromise
    // exposes the underlying HTTP `Response` for header diagnostics.
    // Test mocks return the stream directly with no APIPromise wrapper;
    // fall through to plain await when `.withResponse` isn't present.
    const open = async (b: Record<string, unknown>) => {
      const apiPromise = client.messages.create(
        b as unknown as Parameters<typeof client.messages.create>[0],
        { signal: req.signal },
      );
      const maybeWithResponse = (apiPromise as unknown as {
        withResponse?: () => Promise<{
          data: Awaited<typeof apiPromise>;
          response: { headers?: Headers };
        }>;
      }).withResponse;
      if (typeof maybeWithResponse === 'function') {
        const result = await maybeWithResponse.call(apiPromise);
        return { stream: result.data, headers: result.response?.headers };
      }
      return { stream: await apiPromise, headers: undefined };
    };

    let stream;
    let responseHeaders: Headers | undefined;
    try {
      let opened;
      try {
        opened = await open(body);
      } catch (err) {
        // A replayed thinking block is bound to the conversation prefix that
        // produced it. Once the caller edits that prefix (a new system prompt,
        // a different tool set, summarized history), accounts the API enforces
        // this on get a 400 for every later request that replays the block.
        // Retry once without thinking blocks: the turn runs without that
        // reasoning, as it did before tool-call turns were replayed.
        const stripped = isThinkingBlockRejection(err) ? withoutThinking(messages) : undefined;
        if (!stripped) throw err;
        opened = await open({ ...body, messages: stripped });
      }
      stream = opened.stream;
      responseHeaders = opened.headers;
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    let currentToolUse: PendingToolUse | null = null;
    let currentThinking: ThinkingBlock | null = null;
    let currentText: string | null = null;
    const completedToolCalls: CompletedToolCall[] = [];
    // The turn's content blocks in the order the model produced them, so a
    // tool-call turn can be replayed as written (see appendAssistantToolCall).
    const turnContent: AssistantBlock[] = [];
    let stopReason: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    let cacheWriteTokens: number | undefined;

    try {
      for await (const event of stream as unknown as AsyncIterable<AnthropicStreamEvent>) {
        if (req.signal?.aborted) {
          yield { type: 'end', finishReason: 'aborted' };
          return;
        }

        switch (event.type) {
          case 'message_start':
            // Anthropic's input_tokens EXCLUDES cache activity — the read and
            // write classes arrive in their own fields, matching the library's
            // additive Usage convention with no adjustment needed.
            inputTokens = event.message?.usage?.input_tokens;
            cacheReadTokens = event.message?.usage?.cache_read_input_tokens;
            cacheWriteTokens = event.message?.usage?.cache_creation_input_tokens;
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
            } else if (block?.type === 'text') {
              currentText = block.text ?? '';
            } else if (block?.type === 'thinking') {
              currentThinking = {
                type: 'thinking',
                thinking: block.thinking ?? '',
                signature: block.signature ?? '',
              };
            } else if (block?.type === 'redacted_thinking' && block.data) {
              turnContent.push({ type: 'redacted_thinking', data: block.data });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              if (currentText !== null) currentText += delta.text;
              yield { type: 'token', text: delta.text };
            } else if (delta?.type === 'input_json_delta' && currentToolUse && delta.partial_json) {
              currentToolUse.argumentsText += delta.partial_json;
            } else if (delta?.type === 'thinking_delta' && currentThinking && delta.thinking) {
              currentThinking.thinking += delta.thinking;
            } else if (delta?.type === 'signature_delta' && currentThinking && delta.signature) {
              currentThinking.signature += delta.signature;
            }
            break;
          }

          case 'content_block_stop':
            // Close whichever block is open and record it in turn order. An
            // unsigned thinking block is dropped: the API rejects a replayed
            // one without its signature. (Haiku 5.5 omits the thinking text
            // by default, so an empty `thinking` with a signature is kept.)
            if (currentThinking) {
              if (currentThinking.signature) turnContent.push(currentThinking);
              currentThinking = null;
            }
            if (currentText !== null) {
              if (currentText) turnContent.push({ type: 'text', text: currentText });
              currentText = null;
            }
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
              turnContent.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: parsed,
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

    // Emit accumulated tool calls before the end event. Each carries the
    // whole turn as the model wrote it, so appendAssistantToolCall can replay
    // it whichever of the calls the caller passes back.
    const toolCallRaw: AnthropicToolCallRaw = { content: turnContent };
    for (const tc of completedToolCalls) {
      yield {
        type: 'toolCall',
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        vendorRaw: toolCallRaw,
      };
    }

    const finishReason = mapStopReason(stopReason, completedToolCalls.length > 0);
    const usage =
      inputTokens !== undefined || outputTokens !== undefined
        ? {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(inputTokens !== undefined && outputTokens !== undefined
              ? {
                  totalTokens:
                    inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
                }
              : {}),
            ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
          }
        : undefined;

    const endEvent: Extract<LlmEvent, { type: 'end' }> = {
      type: 'end',
      finishReason,
      ...(usage ? { usage } : {}),
      ...(stopReason ? { rawReason: stopReason } : {}),
    };

    if (responseHeaders) {
      const metadata = ANTHROPIC_METADATA_EXTRACTOR(responseHeaders);
      if (Object.keys(metadata).length > 0) {
        endEvent.vendorMetadata = metadata;
      }
    }

    yield endEvent;
  }

  appendAssistantToolCall(
    history: Message[],
    toolCalls: ReadonlyArray<ToolCallEvent>,
    assistantText?: string,
  ): Message[] {
    // A text block may precede tool_use blocks in the same assistant turn.
    // Anthropic rejects an empty text block, so it is only included when the
    // model actually said something before calling the tool.
    const text = assistantText?.trim() ? assistantText : null;
    const wireMessage = {
      role: 'assistant',
      content: assistantTurnContent(toolCalls, text),
    };
    return [
      ...history,
      {
        role: 'assistant',
        content: text ?? '',
        vendorRaw: wireMessage,
      },
    ];
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

  async testCredential(): Promise<void> {
    // Anthropic's /v1/models is authenticated and costs nothing.
    await this.ensureClient().models.list();
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

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

type AssistantBlock = ThinkingBlock | RedactedThinkingBlock | TextBlock | ToolUseBlock;

/** Shape of `vendorRaw` on the toolCall events this adapter emits. */
interface AnthropicToolCallRaw {
  /** The assistant turn's content blocks, in the order the model produced them. */
  content: AssistantBlock[];
}

interface AnthropicStreamEvent {
  type: string;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    data?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
    signature?: string;
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

/**
 * Replace the last wire message with a copy whose final content block
 * carries `cache_control: {type: 'ephemeral'}`. COPY, never mutate: the
 * `vendorRaw` entries in `messages` are the caller's history objects, and a
 * marker persisted there would accumulate one breakpoint per turn — past
 * Anthropic's 4-breakpoint limit the request is rejected outright.
 */
function markLastMessageForCaching(messages: unknown[]): void {
  if (messages.length === 0) return;
  const last = messages[messages.length - 1] as { content?: unknown };
  const cacheControl = { cache_control: { type: 'ephemeral' } };
  if (typeof last.content === 'string' && last.content.length > 0) {
    messages[messages.length - 1] = {
      ...last,
      content: [{ type: 'text', text: last.content, ...cacheControl }],
    };
  } else if (Array.isArray(last.content) && last.content.length > 0) {
    const blocks = last.content as Array<Record<string, unknown>>;
    messages[messages.length - 1] = {
      ...last,
      content: [...blocks.slice(0, -1), { ...blocks[blocks.length - 1], ...cacheControl }],
    };
  }
  // Empty content (e.g. a bare assistant placeholder) is left unmarked —
  // an empty text block with cache_control would be rejected by the API.
}

/** A 400 that names a replayed `thinking` block (bound to an edited prefix, or an invalid signature). */
function isThinkingBlockRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: unknown };
  return e?.status === 400 && /`thinking` block/.test(String(e.message ?? ''));
}

/**
 * Copy of the wire messages with every `thinking` / `redacted_thinking` block
 * removed, or undefined when there were none. COPY, never mutate: the
 * `vendorRaw` entries are the caller's history objects.
 */
function withoutThinking(messages: unknown[]): unknown[] | undefined {
  let removed = false;
  const out = messages.map((m) => {
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) return m;
    const kept = content.filter((b: { type?: string }) => {
      const thinking = b?.type === 'thinking' || b?.type === 'redacted_thinking';
      if (thinking) removed = true;
      return !thinking;
    });
    return kept.length === content.length ? m : { ...(m as object), content: kept };
  });
  return removed ? out : undefined;
}

/**
 * The content of an assistant tool-call turn, for the wire.
 *
 * Events from `stream()` carry the turn as the model wrote it (thinking,
 * text and tool_use blocks in order) and that record is replayed: thinking
 * blocks keep their place — dropped, the request still succeeds, but the
 * model reasons the turn out again after the tool result — and so does text
 * the model wrote between tool calls. Only the tool_use blocks the caller
 * passed back stay in; `text` is added before the first tool call when the
 * record has no text of its own. Events built by the caller carry no record,
 * so the turn is rebuilt from the text and the call arguments.
 */
function assistantTurnContent(
  toolCalls: ReadonlyArray<ToolCallEvent>,
  text: string | null,
): Array<Record<string, unknown>> {
  const recorded = recordedTurnOf(toolCalls);
  if (!recorded) {
    return [
      ...(text ? [{ type: 'text', text }] : []),
      ...toolCalls.map((tc) => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments ?? {},
      })),
    ];
  }

  const ids = new Set(toolCalls.map((tc) => tc.id));
  const content: AssistantBlock[] = recorded.filter(
    (b) => b.type !== 'tool_use' || ids.has(b.id),
  );
  if (text && !content.some((b) => b.type === 'text')) {
    const at = content.findIndex((b) => b.type === 'tool_use');
    content.splice(at === -1 ? content.length : at, 0, { type: 'text', text });
  }
  // A call the record does not know about (two turns' events passed
  // together) still gets its tool_use block, or its result has no match.
  const known = new Set(
    content.flatMap((b) => (b.type === 'tool_use' ? [b.id] : [])),
  );
  for (const tc of toolCalls) {
    if (!known.has(tc.id)) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
    }
  }
  return content as unknown as Array<Record<string, unknown>>;
}

/**
 * The turn record `stream()` attached to a turn's toolCall events. Every call
 * of the turn carries the same record, so the first one found is the whole
 * turn; events built by the caller (no `vendorRaw`) have none.
 */
function recordedTurnOf(toolCalls: ReadonlyArray<ToolCallEvent>): AssistantBlock[] | undefined {
  for (const tc of toolCalls) {
    const raw = tc.vendorRaw as Partial<AnthropicToolCallRaw> | undefined;
    if (raw && Array.isArray(raw.content)) return raw.content;
  }
  return undefined;
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
    case 'refusal':
      return 'filtered';
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
