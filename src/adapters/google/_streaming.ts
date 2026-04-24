import type { GoogleGenAI } from '@google/genai';
import type {
  FinishReason,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  Tool,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';

/**
 * Gemini wire translation, shared between the Google AI Studio adapter
 * and the Vertex-Gemini adapter. Both use the same `@google/genai` SDK
 * with the same on-wire shape — only the client construction differs.
 */
export async function* streamFromGemini(
  client: GoogleGenAI,
  req: PromptRequest,
): AsyncIterable<LlmEvent> {
  assertValidRequest(req);

  if (req.signal?.aborted) {
    yield { type: 'end', finishReason: 'aborted' };
    return;
  }

  const contents = buildWireContents(req);
  const tools = req.tools && req.tools.length > 0 ? formatTools(req.tools) : undefined;

  const config: Record<string, unknown> = {};
  if (req.system) {
    config.systemInstruction = { parts: [{ text: req.system }] };
  }
  if (tools) config.tools = tools;
  if (req.temperature !== undefined) config.temperature = req.temperature;
  if (req.maxTokens !== undefined) config.maxOutputTokens = req.maxTokens;
  if (req.signal) config.abortSignal = req.signal;

  let stream;
  try {
    stream = await client.models.generateContentStream({
      model: req.model,
      contents: contents as Parameters<typeof client.models.generateContentStream>[0]['contents'],
      config,
    });
  } catch (err) {
    if (isAbortError(err)) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }
    throw err;
  }

  const toolCallCounter = new Map<string, number>();
  const completedToolCalls: Array<{ id: string; name: string; arguments: unknown }> = [];
  let stopReason: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let totalTokens: number | undefined;

  try {
    for await (const chunk of stream) {
      if (req.signal?.aborted) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }

      const usage = chunk.usageMetadata;
      if (usage) {
        if (usage.promptTokenCount !== undefined) inputTokens = usage.promptTokenCount;
        if (usage.candidatesTokenCount !== undefined) outputTokens = usage.candidatesTokenCount;
        if (usage.totalTokenCount !== undefined) totalTokens = usage.totalTokenCount;
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) {
        if (candidate?.finishReason) stopReason = candidate.finishReason;
        continue;
      }

      for (const part of candidate.content.parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          yield { type: 'token', text: part.text };
        }
        if (part.functionCall) {
          const name = part.functionCall.name ?? '';
          if (!name) continue;
          const count = toolCallCounter.get(name) ?? 0;
          toolCallCounter.set(name, count + 1);
          const id = count === 0 ? name : `${name}#${count}`;
          yield { type: 'toolCallStart', id, name };
          completedToolCalls.push({
            id,
            name,
            arguments: part.functionCall.args ?? {},
          });
        }
      }

      if (candidate.finishReason) {
        stopReason = candidate.finishReason;
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

  for (const tc of completedToolCalls) {
    yield {
      type: 'toolCall',
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    };
  }

  const finishReason = mapFinishReason(stopReason, completedToolCalls.length > 0);
  const usage =
    inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined
      ? {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(totalTokens !== undefined ? { totalTokens } : {}),
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

/**
 * Build a tool-result message in the Gemini wire shape. Shared between
 * Google AI Studio and Vertex-Gemini adapters.
 */
export function appendGeminiToolResult(
  history: Message[],
  toolCallId: string,
  result: unknown,
): Message[] {
  const name = parseToolName(toolCallId);
  const content = typeof result === 'string' ? result : JSON.stringify(result);
  const wireMessage = {
    role: 'user',
    parts: [
      {
        functionResponse: {
          name,
          response: { result: content },
        },
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

/**
 * Call the models.list() pager and return normalised `ModelInfo` records,
 * merging capabilities from a known-models table when possible.
 */
export async function listGeminiModels(
  client: GoogleGenAI,
  knownModels: ReadonlyArray<ModelInfo>,
): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  const pager = await client.models.list();
  for await (const m of pager as AsyncIterable<{ name?: string; displayName?: string }>) {
    const id = stripModelPrefix(m.name ?? '');
    if (!id) continue;
    const known = knownModels.find((k) => k.id === id);
    if (known) {
      out.push(known);
    } else {
      out.push({
        id,
        displayName: m.displayName ?? undefined,
        capabilities: defaultGeminiCapabilities(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for adapter-local reuse only; not public)
// ---------------------------------------------------------------------------

function buildWireContents(req: PromptRequest): unknown[] {
  const out: unknown[] = [];
  for (const msg of req.messages) {
    if (msg.vendorRaw && typeof msg.vendorRaw === 'object') {
      out.push(msg.vendorRaw);
      continue;
    }
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    out.push({
      role: toGeminiRole(msg.role),
      parts: [{ text }],
    });
  }
  return out;
}

function toGeminiRole(role: string): 'user' | 'model' {
  return role === 'assistant' || role === 'model' ? 'model' : 'user';
}

function formatTools(tools: Tool[]): Array<Record<string, unknown>> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: t.parameters ?? { type: 'object', properties: {} },
      })),
    },
  ];
}

function mapFinishReason(r: string | undefined, hadToolCalls: boolean): FinishReason {
  if (hadToolCalls && (r === 'STOP' || r === 'TOOL_CALLS' || !r)) return 'tool';
  switch (r) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'filtered';
    case 'TOOL_CALLS':
      return 'tool';
    default:
      return 'stop';
  }
}

function parseToolName(id: string): string {
  const hashIdx = id.lastIndexOf('#');
  if (hashIdx === -1) return id;
  const suffix = id.slice(hashIdx + 1);
  if (/^\d+$/.test(suffix)) return id.slice(0, hashIdx);
  return id;
}

function stripModelPrefix(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

export function defaultGeminiCapabilities() {
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
