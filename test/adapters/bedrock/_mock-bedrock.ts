import type { AwsClientStub } from 'aws-sdk-client-mock';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { bedrockFactory } from '../../../src/adapters/bedrock/index.js';
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

export function createBedrockHarness(
  mock: AwsClientStub<BedrockRuntimeClient>,
): ContractHarness {
  let lastRequestInput: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mock.reset();
    mock.on(ConverseStreamCommand).callsFake((input, getClient) => {
      lastRequestInput = input;
      const signal = (getClient as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
      if (signal?.aborted) {
        const err = new Error('Request aborted.');
        err.name = 'AbortError';
        throw err;
      }
      return Promise.resolve({
        $metadata: {},
        stream: makeMockStream(scenario, signal),
      });
    });
  }

  return {
    vendor: 'bedrock',
    factory: bedrockFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'bedrockApiKey') {
        return { kind: 'bedrockApiKey', apiKey: 'bedrock-test-key', region: 'us-east-1' };
      }
      if (kind === 'bedrockIam') {
        return {
          kind: 'bedrockIam',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: 'secret-example',
          region: 'us-east-1',
        };
      }
      throw new Error(`Bedrock harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: { kind: 'apiKey', apiKey: 'sk-test' },
    mockScenario(scenario) {
      lastRequestInput = null;
      programMock(scenario);
    },
    cleanup() {
      mock.reset();
      lastRequestInput = null;
    },
    getCapturedRequest(): CapturedRequest | null {
      if (!lastRequestInput) return null;
      const messages = (lastRequestInput.messages as Array<Record<string, unknown>>) ?? [];
      const vendorRawHonored = messages.some((m) => {
        const content = m.content as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(content)) return false;
        return content.some((block) => 'toolUse' in block || 'toolResult' in block);
      });
      const result: CapturedRequest = {
        messageCount: messages.length,
        vendorRawHonored,
      };
      const system = lastRequestInput.system as Array<{ text?: string }> | undefined;
      if (Array.isArray(system)) {
        const text = system.map((s) => s.text ?? '').join('');
        if (text) result.system = text;
      }
      return result;
    },
    toolCapableModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    // All models in the Bedrock manifest advertise tools:true.
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
              toolUse: {
                toolUseId: tc.id,
                name: tc.name,
                input: tc.arguments,
              },
            },
          ],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario → Bedrock Converse stream events
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
  yield { messageStart: { role: 'assistant' } };
  yield contentBlockStartText(0);
  for (const text of ['Hello', ', ', 'world', '!']) {
    checkAbort(signal);
    yield textDelta(0, text);
  }
  yield contentBlockStop(0);
  yield { messageStop: { stopReason: 'end_turn' } };
  yield metadata(5, 4);
}

async function* toolCallEvents(signal: AbortSignal | undefined): AsyncIterable<Event> {
  yield { messageStart: { role: 'assistant' } };
  checkAbort(signal);
  yield contentBlockStartToolUse(0, 'toolu_abc', 'test_tool');
  for (const partial of ['{"fo', 'o":', '"bar"}']) {
    checkAbort(signal);
    yield toolUseDelta(0, partial);
  }
  yield contentBlockStop(0);
  yield { messageStop: { stopReason: 'tool_use' } };
  yield metadata(6, 8);
}

async function* toolCallAfterTokensEvents(
  signal: AbortSignal | undefined,
): AsyncIterable<Event> {
  yield { messageStart: { role: 'assistant' } };
  yield contentBlockStartText(0);
  for (const text of ['Let ', 'me ', 'check']) {
    checkAbort(signal);
    yield textDelta(0, text);
  }
  yield contentBlockStop(0);
  checkAbort(signal);
  yield contentBlockStartToolUse(1, 'toolu_xyz', 'test_tool');
  yield toolUseDelta(1, '{"q":"hi"}');
  yield contentBlockStop(1);
  yield { messageStop: { stopReason: 'tool_use' } };
  yield metadata(7, 10);
}

async function* longStreamEvents(signal: AbortSignal | undefined): AsyncIterable<Event> {
  yield { messageStart: { role: 'assistant' } };
  yield contentBlockStartText(0);
  for (let i = 0; i < 12; i++) {
    checkAbort(signal);
    yield textDelta(0, `chunk-${i} `);
    await sleep(20);
  }
  yield contentBlockStop(0);
  yield { messageStop: { stopReason: 'end_turn' } };
  yield metadata(4, 12);
}

async function* longStreamWithPendingToolEvents(
  signal: AbortSignal | undefined,
): AsyncIterable<Event> {
  yield { messageStart: { role: 'assistant' } };
  yield contentBlockStartText(0);
  for (let i = 0; i < 5; i++) {
    checkAbort(signal);
    yield textDelta(0, `chunk-${i} `);
    await sleep(25);
  }
  yield contentBlockStop(0);
  checkAbort(signal);
  yield contentBlockStartToolUse(1, 'toolu_late', 'test_tool');
  await sleep(25);
  checkAbort(signal);
  yield toolUseDelta(1, '{"q":"late"}');
  await sleep(25);
  checkAbort(signal);
  yield contentBlockStop(1);
  yield { messageStop: { stopReason: 'tool_use' } };
  yield metadata(5, 8);
}

// ---------------------------------------------------------------------------
// Event constructors
// ---------------------------------------------------------------------------

function contentBlockStartText(index: number): Event {
  return { contentBlockStart: { contentBlockIndex: index, start: {} } };
}

function contentBlockStartToolUse(index: number, id: string, name: string): Event {
  return {
    contentBlockStart: {
      contentBlockIndex: index,
      start: { toolUse: { toolUseId: id, name } },
    },
  };
}

function textDelta(index: number, text: string): Event {
  return {
    contentBlockDelta: {
      contentBlockIndex: index,
      delta: { text },
    },
  };
}

function toolUseDelta(index: number, input: string): Event {
  return {
    contentBlockDelta: {
      contentBlockIndex: index,
      delta: { toolUse: { input } },
    },
  };
}

function contentBlockStop(index: number): Event {
  return { contentBlockStop: { contentBlockIndex: index } };
}

function metadata(inputTokens: number, outputTokens: number): Event {
  return {
    metadata: {
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    },
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
