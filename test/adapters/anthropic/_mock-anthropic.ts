import type { Mock } from 'vitest';
import { anthropicFactory } from '../../../src/adapters/anthropic/index.js';
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

export interface AnthropicMockSpies {
  create: Mock;
  modelsList: Mock;
}

export function createAnthropicHarness(mocks: AnthropicMockSpies): ContractHarness {
  let lastRequestBody: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.create.mockReset();
    mocks.modelsList.mockReset();

    mocks.create.mockImplementation(async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      lastRequestBody = body;
      if (options?.signal?.aborted) {
        const err = new Error('Request aborted.');
        err.name = 'APIUserAbortError';
        throw err;
      }
      return makeMockStream(scenario, options?.signal);
    });

    mocks.modelsList.mockResolvedValue({
      data: [
        { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' },
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
      ],
    });
  }

  return {
    vendor: 'anthropic',
    factory: anthropicFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'apiKey') return { kind: 'apiKey', apiKey: 'sk-ant-test' };
      throw new Error(`Anthropic harness does not provide auth for kind '${kind}'`);
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
      const messages = (lastRequestBody.messages as Array<Record<string, unknown>>) ?? [];
      // Anthropic honors vendorRaw when a message's content is an array of
      // content blocks — the only way to convey tool_use / tool_result shapes.
      const vendorRawHonored = messages.some((m) => Array.isArray(m.content));
      const result: CapturedRequest = {
        messageCount: messages.length,
        vendorRawHonored,
      };
      if (typeof lastRequestBody.system === 'string') {
        result.system = lastRequestBody.system;
      }
      return result;
    },
    toolCapableModel: 'claude-sonnet-4-6',
    // All Claude models in the manifest support tools, so check #16 is skipped.
    nonToolCapableModel: null,
    emitsToolCallStart: true,
    buildAssistantWithToolCall(tc: Extract<LlmEvent, { type: 'toolCall' }>): Message {
      return {
        role: 'assistant',
        content: '',
        vendorRaw: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            },
          ],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario → mock event stream translation (Anthropic event format)
// ---------------------------------------------------------------------------

type Event = Record<string, unknown>;

async function* makeMockStream(
  scenario: ContractScenario,
  signal?: AbortSignal,
): AsyncIterable<Event> {
  switch (scenario) {
    case 'simple-stream':
      yield* simpleStreamEvents(signal);
      return;
    case 'tool-call':
      yield* toolCallEvents(signal);
      return;
    case 'tool-call-after-tokens':
      yield* toolCallAfterTokensEvents(signal);
      return;
    case 'long-stream':
      yield* longStreamEvents(signal);
      return;
    case 'long-stream-with-pending-tool':
      yield* longStreamWithPendingToolEvents(signal);
      return;
    case 'list-models':
      yield* simpleStreamEvents(signal);
      return;
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

async function* simpleStreamEvents(signal: AbortSignal | undefined): AsyncIterable<Event> {
  yield messageStart(5);
  yield contentBlockStart(0, { type: 'text', text: '' });
  for (const text of ['Hello', ', ', 'world', '!']) {
    checkAbort(signal);
    yield textDelta(0, text);
  }
  yield contentBlockStop(0);
  yield messageDelta('end_turn', 4);
  yield messageStop();
}

async function* toolCallEvents(signal: AbortSignal | undefined): AsyncIterable<Event> {
  yield messageStart(6);
  checkAbort(signal);
  yield contentBlockStart(0, {
    type: 'tool_use',
    id: 'toolu_abc',
    name: 'test_tool',
    input: {},
  });
  for (const partial of ['{"fo', 'o":', '"bar"}']) {
    checkAbort(signal);
    yield inputJsonDelta(0, partial);
  }
  yield contentBlockStop(0);
  yield messageDelta('tool_use', 8);
  yield messageStop();
}

async function* toolCallAfterTokensEvents(
  signal: AbortSignal | undefined,
): AsyncIterable<Event> {
  yield messageStart(7);
  yield contentBlockStart(0, { type: 'text', text: '' });
  for (const text of ['Let ', 'me ', 'check']) {
    checkAbort(signal);
    yield textDelta(0, text);
  }
  yield contentBlockStop(0);
  checkAbort(signal);
  yield contentBlockStart(1, {
    type: 'tool_use',
    id: 'toolu_xyz',
    name: 'test_tool',
    input: {},
  });
  yield inputJsonDelta(1, '{"q":"hi"}');
  yield contentBlockStop(1);
  yield messageDelta('tool_use', 10);
  yield messageStop();
}

async function* longStreamEvents(signal: AbortSignal | undefined): AsyncIterable<Event> {
  yield messageStart(4);
  yield contentBlockStart(0, { type: 'text', text: '' });
  for (let i = 0; i < 12; i++) {
    checkAbort(signal);
    yield textDelta(0, `chunk-${i} `);
    await sleep(20);
  }
  yield contentBlockStop(0);
  yield messageDelta('end_turn', 12);
  yield messageStop();
}

async function* longStreamWithPendingToolEvents(
  signal: AbortSignal | undefined,
): AsyncIterable<Event> {
  yield messageStart(5);
  yield contentBlockStart(0, { type: 'text', text: '' });
  for (let i = 0; i < 5; i++) {
    checkAbort(signal);
    yield textDelta(0, `chunk-${i} `);
    await sleep(25);
  }
  yield contentBlockStop(0);
  checkAbort(signal);
  // Tool call would start here — but abort-checks are interspersed so the
  // adapter can bail before the tool_use block is emitted.
  yield contentBlockStart(1, {
    type: 'tool_use',
    id: 'toolu_late',
    name: 'test_tool',
    input: {},
  });
  await sleep(25);
  checkAbort(signal);
  yield inputJsonDelta(1, '{"q":"late"}');
  await sleep(25);
  checkAbort(signal);
  yield contentBlockStop(1);
  yield messageDelta('tool_use', 8);
  yield messageStop();
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

function messageStart(inputTokens: number): Event {
  return {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-6',
      stop_reason: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  };
}

function contentBlockStart(index: number, contentBlock: Record<string, unknown>): Event {
  return {
    type: 'content_block_start',
    index,
    content_block: contentBlock,
  };
}

function textDelta(index: number, text: string): Event {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
}

function inputJsonDelta(index: number, partialJson: string): Event {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  };
}

function contentBlockStop(index: number): Event {
  return { type: 'content_block_stop', index };
}

function messageDelta(stopReason: string, outputTokens: number): Event {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

function messageStop(): Event {
  return { type: 'message_stop' };
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
