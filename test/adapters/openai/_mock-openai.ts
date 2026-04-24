import type { Mock } from 'vitest';
import { openAIFactory } from '../../../src/adapters/openai/index.js';
import type { AuthKind, AuthSpec } from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';

/**
 * Factory for an OpenAI ContractHarness that drives a vi.mock'd OpenAI client.
 *
 * The test file owns the `vi.mock('openai', ...)` call (must be hoisted per-file)
 * and passes the mock spies here. This keeps the hoisting file-local while
 * sharing the scenario-to-chunks translation logic.
 */
export interface OpenAIMockSpies {
  create: Mock;
  modelsList: Mock;
}

export function createOpenAIHarness(mocks: OpenAIMockSpies): ContractHarness {
  let lastRequestBody: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.create.mockReset();
    mocks.modelsList.mockReset();

    mocks.create.mockImplementation(async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      lastRequestBody = body;
      // Honor pre-fired abort — SDK would throw APIUserAbortError immediately.
      if (options?.signal?.aborted) {
        const err = new Error('Request aborted.');
        err.name = 'APIUserAbortError';
        throw err;
      }
      return makeMockStream(scenario, options?.signal);
    });

    mocks.modelsList.mockResolvedValue({
      data: [
        { id: 'gpt-4o', object: 'model' },
        { id: 'gpt-4o-mini', object: 'model' },
        { id: 'some-new-model', object: 'model' },
      ],
    });
  }

  return {
    vendor: 'openai',
    factory: openAIFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'apiKey') return { kind: 'apiKey', apiKey: 'sk-test' };
      throw new Error(`OpenAI harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: {
      kind: 'bedrockIam',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      region: 'us-east-1',
    },
    mockScenario(scenario) {
      lastRequestBody = null;
      programMock(scenario);
    },
    cleanup() {
      mocks.create.mockReset();
      mocks.modelsList.mockReset();
      lastRequestBody = null;
    },
    getCapturedRequest(): CapturedRequest | null {
      if (!lastRequestBody) return null;
      const messages = (lastRequestBody.messages as Array<{ role: string }>) ?? [];
      const systemMsg = messages.find((m) => m.role === 'system') as
        | { role: string; content: string }
        | undefined;
      const nonSystemCount = messages.filter((m) => m.role !== 'system').length;
      // vendorRaw round-trip heuristic: the adapter preserves vendorRaw as the
      // wire message. We look for an assistant message carrying a `tool_calls`
      // array — which only appears if vendorRaw (or manually-constructed
      // equivalent) was honored.
      const vendorRawHonored = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray((m as unknown as { tool_calls?: unknown[] }).tool_calls),
      );
      const result: CapturedRequest = {
        messageCount: nonSystemCount,
        vendorRawHonored,
      };
      if (systemMsg) result.system = systemMsg.content;
      return result;
    },
    toolCapableModel: 'gpt-4o',
    nonToolCapableModel: 'o1-preview',
    emitsToolCallStart: true,
  };
}

// ---------------------------------------------------------------------------
// Scenario → mock stream translation
// ---------------------------------------------------------------------------

type Chunk = Record<string, unknown>;

/**
 * Exported so the Vertex-OpenAI harness can reuse the same OpenAI chunk shapes
 * without duplicating scenario logic.
 */
export async function* makeMockStream(
  scenario: ContractScenario,
  signal?: AbortSignal,
): AsyncIterable<Chunk> {
  switch (scenario) {
    case 'simple-stream':
      yield* simpleStreamChunks(signal);
      return;
    case 'tool-call':
      yield* toolCallChunks(signal);
      return;
    case 'tool-call-after-tokens':
      yield* toolCallAfterTokensChunks(signal);
      return;
    case 'long-stream':
      yield* longStreamChunks(signal);
      return;
    case 'long-stream-with-pending-tool':
      yield* longStreamWithPendingToolChunks(signal);
      return;
    case 'list-models':
      // Same stream shape as simple — list-models is handled via the separate
      // models.list() mock.
      yield* simpleStreamChunks(signal);
      return;
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

async function* simpleStreamChunks(signal: AbortSignal | undefined): AsyncIterable<Chunk> {
  for (const content of ['Hello', ', ', 'world', '!']) {
    checkAbort(signal);
    yield contentChunk(content);
  }
  yield finishChunk('stop');
  yield usageChunk(5, 4);
}

async function* toolCallChunks(signal: AbortSignal | undefined): AsyncIterable<Chunk> {
  checkAbort(signal);
  // First delta: id + name, no args
  yield toolCallDelta(0, { id: 'call_abc', name: 'test_tool', arguments: '' });
  // Args arrive fragmented — emulates real OpenAI streaming
  yield toolCallDelta(0, { arguments: '{"fo' });
  yield toolCallDelta(0, { arguments: 'o":' });
  yield toolCallDelta(0, { arguments: '"bar"}' });
  yield finishChunk('tool_calls');
  yield usageChunk(6, 8);
}

async function* toolCallAfterTokensChunks(
  signal: AbortSignal | undefined,
): AsyncIterable<Chunk> {
  for (const content of ['Let ', 'me ', 'check']) {
    checkAbort(signal);
    yield contentChunk(content);
  }
  checkAbort(signal);
  yield toolCallDelta(0, { id: 'call_xyz', name: 'test_tool', arguments: '{"q":"hi"}' });
  yield finishChunk('tool_calls');
  yield usageChunk(7, 10);
}

async function* longStreamChunks(signal: AbortSignal | undefined): AsyncIterable<Chunk> {
  for (let i = 0; i < 12; i++) {
    checkAbort(signal);
    yield contentChunk(`chunk-${i} `);
    await sleep(20);
  }
  yield finishChunk('stop');
  yield usageChunk(4, 12);
}

async function* longStreamWithPendingToolChunks(
  signal: AbortSignal | undefined,
): AsyncIterable<Chunk> {
  for (let i = 0; i < 5; i++) {
    checkAbort(signal);
    yield contentChunk(`chunk-${i} `);
    await sleep(25);
  }
  checkAbort(signal);
  // Would emit tool call next — but the contract requires that on mid-stream
  // abort, the tool call is NOT emitted. We yield the id+name first, then args,
  // interspersed with abort checks so the adapter has chances to bail.
  yield toolCallDelta(0, { id: 'call_late', name: 'test_tool', arguments: '' });
  await sleep(25);
  checkAbort(signal);
  yield toolCallDelta(0, { arguments: '{"q":"late"}' });
  await sleep(25);
  checkAbort(signal);
  yield finishChunk('tool_calls');
  yield usageChunk(5, 8);
}

function contentChunk(content: string): Chunk {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function toolCallDelta(
  index: number,
  fn: { id?: string; name?: string; arguments?: string },
): Chunk {
  const toolCall: Record<string, unknown> = { index };
  if (fn.id !== undefined) toolCall.id = fn.id;
  toolCall.type = 'function';
  const func: Record<string, unknown> = {};
  if (fn.name !== undefined) func.name = fn.name;
  if (fn.arguments !== undefined) func.arguments = fn.arguments;
  toolCall.function = func;
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: { tool_calls: [toolCall] },
        finish_reason: null,
      },
    ],
  };
}

function finishChunk(reason: string): Chunk {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
  };
}

function usageChunk(prompt: number, completion: number): Chunk {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  };
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error('Request aborted.');
    err.name = 'APIUserAbortError';
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
