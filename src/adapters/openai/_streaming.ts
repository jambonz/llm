import type OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type {
  FinishReason,
  LlmEvent,
  Message,
  ModelCapabilities,
  ModelInfo,
  PromptRequest,
  Tool,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';

/**
 * OpenAI wire translation, shared between the native OpenAI adapter and the
 * Vertex-OpenAI adapter (which talks to third-party models hosted on Vertex AI
 * via the OpenAI-compatible endpoint).
 */
export async function* streamFromOpenAI(
  client: OpenAI,
  req: PromptRequest,
  options: {
    knownModels: ReadonlyArray<ModelInfo>;
    /**
     * Whether to set `stream_options: { include_usage: true }` on the
     * request. Defaults to `true` for OpenAI's native API. Set to `false`
     * for third-party OpenAI-compatible endpoints (e.g. Vertex AI's OpenAI
     * endpoint for partner models) that reject unknown extensions with a
     * 400 error. When disabled, the `end` event's `usage` field is omitted.
     */
    includeStreamOptions?: boolean;
    /**
     * If the caller did not supply `maxTokens`, use this value. Set by the
     * Vertex-OpenAI adapter because Vertex AI's Llama MaaS endpoint returns
     * an empty assistant message (zero tokens, `finish_reason: stop`) when
     * `max_tokens` is omitted. Leave undefined for OpenAI's native API,
     * which defaults correctly on its own.
     */
    defaultMaxTokens?: number;
  },
): AsyncIterable<LlmEvent> {
  assertValidRequest(req);

  if (req.signal?.aborted) {
    yield { type: 'end', finishReason: 'aborted' };
    return;
  }

  const capabilities = capabilitiesFor(req.model, options.knownModels);
  const useTools = req.tools && req.tools.length > 0 && capabilities.tools;

  const messages = buildWireMessages(req);
  const tools = useTools ? formatTools(req.tools!) : undefined;

  const body: ChatCompletionCreateParamsStreaming = {
    model: req.model,
    messages: messages as ChatCompletionCreateParamsStreaming['messages'],
    stream: true,
    ...(options.includeStreamOptions !== false
      ? { stream_options: { include_usage: true } }
      : {}),
  };
  if (tools) {
    body.tools = tools as unknown as ChatCompletionCreateParamsStreaming['tools'];
    body.tool_choice = 'auto';
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  const effectiveMaxTokens = req.maxTokens ?? options.defaultMaxTokens;
  if (effectiveMaxTokens !== undefined) body.max_tokens = effectiveMaxTokens;

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
      } else if (finishReason) {
        finalFinishReason = mapFinishReason(finishReason);
        finalRawReason = finishReason;
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

export function appendOpenAIAssistantToolCall(
  history: Message[],
  toolCalls: ReadonlyArray<Extract<LlmEvent, { type: 'toolCall' }>>,
): Message[] {
  const wireMessage = {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: typeof tc.arguments === 'string'
          ? tc.arguments
          : JSON.stringify(tc.arguments ?? {}),
      },
    })),
  };
  return [
    ...history,
    {
      role: 'assistant',
      content: '',
      vendorRaw: wireMessage,
    },
  ];
}

export function appendOpenAIToolResult(
  history: Message[],
  toolCallId: string,
  result: unknown,
): Message[] {
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

/**
 * Call `models.list()` and normalise results, merging capabilities from a
 * known-models table when possible.
 */
export async function listOpenAICompatibleModels(
  client: OpenAI,
  knownModels: ReadonlyArray<ModelInfo>,
): Promise<ModelInfo[]> {
  const result = await client.models.list();
  const out: ModelInfo[] = [];
  for (const m of result.data) {
    const known = knownModels.find((k) => k.id === m.id);
    if (known) {
      out.push(known);
    } else {
      out.push({
        id: m.id,
        capabilities: defaultCapabilitiesForUnknown(m.id),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
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

function capabilitiesFor(
  modelId: string,
  knownModels: ReadonlyArray<ModelInfo>,
): ModelCapabilities {
  const known = knownModels.find((k) => k.id === modelId);
  if (known) return known.capabilities;
  return defaultCapabilitiesForUnknown(modelId);
}

export function defaultCapabilitiesForUnknown(modelId: string): ModelCapabilities {
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
