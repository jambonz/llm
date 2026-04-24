import type { Mock } from 'vitest';
import { googleFactory } from '../../../src/adapters/google/index.js';
import type {
  AuthKind,
  AuthSpec,
  LlmEvent,
  Message,
} from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';

export interface GoogleMockSpies {
  generateContentStream: Mock;
  modelsList: Mock;
}

export function createGoogleHarness(mocks: GoogleMockSpies): ContractHarness {
  let lastRequestArg: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();

    mocks.generateContentStream.mockImplementation(async (arg: Record<string, unknown>) => {
      lastRequestArg = arg;
      const signal = (arg.config as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
      if (signal?.aborted) {
        const err = new Error('Request aborted.');
        err.name = 'AbortError';
        throw err;
      }
      return makeMockStream(scenario, signal);
    });

    mocks.modelsList.mockImplementation(async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' };
          yield { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' };
          yield { name: 'models/gemini-future', displayName: 'Gemini Future' };
        },
      };
    });
  }

  return {
    vendor: 'google',
    factory: googleFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'googleApiKey') return { kind: 'googleApiKey', apiKey: 'AIza-test' };
      throw new Error(`Google harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: {
      kind: 'bedrockIam',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      region: 'us-east-1',
    },
    mockScenario(scenario) {
      lastRequestArg = null;
      programMock(scenario);
    },
    cleanup() {
      mocks.generateContentStream.mockReset();
      mocks.modelsList.mockReset();
      lastRequestArg = null;
    },
    getCapturedRequest(): CapturedRequest | null {
      if (!lastRequestArg) return null;
      const contents = (lastRequestArg.contents as Array<Record<string, unknown>>) ?? [];
      // Gemini honors vendorRaw when message content carries functionCall /
      // functionResponse parts, or any parts object beyond a plain {text}.
      const vendorRawHonored = contents.some((c) => {
        const parts = c.parts as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(parts)) return false;
        return parts.some((p) => 'functionCall' in p || 'functionResponse' in p);
      });
      const result: CapturedRequest = {
        messageCount: contents.length,
        vendorRawHonored,
      };
      const sys = (lastRequestArg.config as { systemInstruction?: { parts?: Array<{ text?: string }> } } | undefined)
        ?.systemInstruction;
      if (sys && Array.isArray(sys.parts)) {
        const text = sys.parts.map((p) => p.text ?? '').join('');
        if (text) result.system = text;
      }
      return result;
    },
    toolCapableModel: 'gemini-2.5-flash',
    nonToolCapableModel: null,
    emitsToolCallStart: true,
    buildAssistantWithToolCall(tc: Extract<LlmEvent, { type: 'toolCall' }>): Message {
      return {
        role: 'assistant',
        content: '',
        vendorRaw: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            },
          ],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario → mock chunk stream (Gemini format)
// ---------------------------------------------------------------------------

type Chunk = Record<string, unknown>;

async function* makeMockStream(
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
      yield* simpleStreamChunks(signal);
      return;
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

async function* simpleStreamChunks(signal: AbortSignal | undefined): AsyncIterable<Chunk> {
  for (const text of ['Hello', ', ', 'world', '!']) {
    checkAbort(signal);
    yield textChunk(text);
  }
  yield finishChunk('STOP', { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 });
}

async function* toolCallChunks(signal: AbortSignal | undefined): AsyncIterable<Chunk> {
  checkAbort(signal);
  yield {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'test_tool',
                args: { foo: 'bar' },
              },
            },
          ],
        },
      },
    ],
  };
  yield finishChunk('STOP', { promptTokenCount: 6, candidatesTokenCount: 8, totalTokenCount: 14 });
}

async function* toolCallAfterTokensChunks(
  signal: AbortSignal | undefined,
): AsyncIterable<Chunk> {
  for (const text of ['Let ', 'me ', 'check']) {
    checkAbort(signal);
    yield textChunk(text);
  }
  checkAbort(signal);
  yield {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'test_tool', args: { q: 'hi' } } }],
        },
      },
    ],
  };
  yield finishChunk('STOP', { promptTokenCount: 7, candidatesTokenCount: 10, totalTokenCount: 17 });
}

async function* longStreamChunks(signal: AbortSignal | undefined): AsyncIterable<Chunk> {
  for (let i = 0; i < 12; i++) {
    checkAbort(signal);
    yield textChunk(`chunk-${i} `);
    await sleep(20);
  }
  yield finishChunk('STOP', { promptTokenCount: 4, candidatesTokenCount: 12, totalTokenCount: 16 });
}

async function* longStreamWithPendingToolChunks(
  signal: AbortSignal | undefined,
): AsyncIterable<Chunk> {
  for (let i = 0; i < 5; i++) {
    checkAbort(signal);
    yield textChunk(`chunk-${i} `);
    await sleep(25);
  }
  checkAbort(signal);
  // Simulate a slow-arriving tool-call chunk so abort can happen first.
  await sleep(25);
  checkAbort(signal);
  yield {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'test_tool', args: { q: 'late' } } }],
        },
      },
    ],
  };
  yield finishChunk('STOP', { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13 });
}

function textChunk(text: string): Chunk {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
  };
}

function finishChunk(
  reason: string,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number },
): Chunk {
  return {
    candidates: [
      {
        content: { role: 'model', parts: [] },
        finishReason: reason,
      },
    ],
    usageMetadata: usage,
  };
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error('Request aborted.');
    err.name = 'AbortError';
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
