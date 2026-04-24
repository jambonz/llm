import type {
  AdapterFactory,
  AdapterManifest,
  ApiKeyAuth,
  AuthKind,
  AuthSpec,
  ClientOptions,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  ToolCallEvent,
} from '../types.js';
import { assertValidRequest } from '../validate.js';
import type { CapturedRequest, ContractHarness, ContractScenario } from './types.js';

/**
 * Shared mutable state between the harness and the fake adapter instance.
 * The harness writes to it (via mockScenario/cleanup), the adapter reads it
 * during stream() / listAvailableModels() to decide what to produce.
 */
interface FakeState {
  scenario: ContractScenario | null;
  captured: CapturedRequest | null;
}

/**
 * Reference fake adapter used by the test-kit to verify itself.
 *
 * Produces canned events for each `ContractScenario`. Does not talk to any
 * real vendor. Used by `test/test-kit/self-check.test.ts` to prove that a
 * correctly-behaving adapter passes all 20 contract checks.
 *
 * Anybody implementing a real adapter can read this as a minimal reference —
 * it shows exactly what the library expects on the wire.
 */
export class FakeAdapter implements LlmAdapter<ApiKeyAuth> {
  readonly vendor = fakeManifest.vendor;
  readonly acceptedAuth = ['apiKey'] as const;
  private initialized = false;

  constructor(private readonly state: FakeState) {}

  init(auth: ApiKeyAuth, _client?: ClientOptions): void {
    if (auth.kind !== 'apiKey') {
      throw new Error(`FakeAdapter: unsupported auth kind '${(auth as AuthSpec).kind}'`);
    }
    if (!auth.apiKey) {
      throw new Error('FakeAdapter: apiKey is required');
    }
    this.initialized = true;
  }

  async *stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    this.ensureInitialized();
    assertValidRequest(req);
    this.capture(req);

    const scenario = this.state.scenario ?? 'simple-stream';

    if (req.signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }

    switch (scenario) {
      case 'simple-stream':
        yield* simpleStream(req.signal);
        return;
      case 'tool-call':
        yield* toolCallOnly(req.signal);
        return;
      case 'tool-call-after-tokens':
        yield* toolCallAfterTokens(req.signal);
        return;
      case 'long-stream':
        yield* longStream(req.signal);
        return;
      case 'long-stream-with-pending-tool':
        yield* longStreamWithPendingTool(req.signal);
        return;
      case 'list-models':
        // listAvailableModels handles this — stream just behaves like simple.
        yield* simpleStream(req.signal);
        return;
      default:
        throw new Error(`FakeAdapter: unknown scenario '${scenario}'`);
    }
  }

  appendAssistantToolCall(
    history: Message[],
    toolCalls: ReadonlyArray<ToolCallEvent>,
  ): Message[] {
    return [
      ...history,
      {
        role: 'assistant',
        content: '',
        vendorRaw: {
          role: 'assistant',
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        },
      },
    ];
  }

  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[] {
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    return [
      ...history,
      {
        role: 'tool',
        content,
        vendorRaw: { tool_call_id: toolCallId },
      },
    ];
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    this.ensureInitialized();
    return fakeManifest.knownModels;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FakeAdapter: init() must be called before stream()/listAvailableModels()');
    }
  }

  private capture(req: PromptRequest): void {
    this.state.captured = {
      messageCount: req.messages.length,
      vendorRawHonored: req.messages.some((m) => m.vendorRaw !== undefined),
      ...(req.system !== undefined ? { system: req.system } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------

async function* simpleStream(signal: AbortSignal | undefined): AsyncIterable<LlmEvent> {
  const chunks = ['Hello', ', ', 'world', '!'];
  for (const text of chunks) {
    if (signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }
    yield { type: 'token', text };
  }
  yield { type: 'end', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 4 } };
}

async function* toolCallOnly(signal: AbortSignal | undefined): AsyncIterable<LlmEvent> {
  if (signal?.aborted) {
    yield { type: 'end', finishReason: 'aborted' };
    return;
  }
  yield { type: 'toolCallStart', id: 'call_fake_1', name: 'test_tool' };
  yield {
    type: 'toolCall',
    id: 'call_fake_1',
    name: 'test_tool',
    arguments: { foo: 'bar' },
  };
  yield { type: 'end', finishReason: 'tool' };
}

async function* toolCallAfterTokens(signal: AbortSignal | undefined): AsyncIterable<LlmEvent> {
  const tokens = ['Let ', 'me ', 'check'];
  for (const text of tokens) {
    if (signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }
    yield { type: 'token', text };
  }
  if (signal?.aborted) {
    yield { type: 'end', finishReason: 'aborted' };
    return;
  }
  yield { type: 'toolCallStart', id: 'call_fake_2', name: 'test_tool' };
  yield {
    type: 'toolCall',
    id: 'call_fake_2',
    name: 'test_tool',
    arguments: { q: 'hello' },
  };
  yield { type: 'end', finishReason: 'tool' };
}

async function* longStream(signal: AbortSignal | undefined): AsyncIterable<LlmEvent> {
  for (let i = 0; i < 12; i++) {
    if (signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }
    yield { type: 'token', text: `chunk-${i} ` };
    await sleep(20);
  }
  yield { type: 'end', finishReason: 'stop' };
}

async function* longStreamWithPendingTool(
  signal: AbortSignal | undefined,
): AsyncIterable<LlmEvent> {
  for (let i = 0; i < 5; i++) {
    if (signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }
    yield { type: 'token', text: `chunk-${i} ` };
    await sleep(25);
  }
  // Would emit a tool call next, but check abort first — on abort, the tool
  // call is NOT emitted. That's the contract check 10 verifies.
  if (signal?.aborted) {
    yield { type: 'end', finishReason: 'aborted' };
    return;
  }
  yield { type: 'toolCallStart', id: 'call_fake_3', name: 'test_tool' };
  yield {
    type: 'toolCall',
    id: 'call_fake_3',
    name: 'test_tool',
    arguments: { q: 'never-reached' },
  };
  yield { type: 'end', finishReason: 'tool' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const fakeManifest: AdapterManifest = {
  vendor: 'fake',
  displayName: 'Fake (test-kit reference)',
  authKinds: [
    {
      kind: 'apiKey',
      displayName: 'API Key',
      fields: [
        { name: 'apiKey', label: 'API Key', type: 'password', required: true },
      ],
    },
  ],
  knownModels: [
    {
      id: 'fake-tool-model',
      displayName: 'Fake Tool-Capable Model',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 8_000,
      },
    },
    {
      id: 'fake-plain-model',
      displayName: 'Fake Plain Model (no tools)',
      capabilities: {
        streaming: true,
        tools: false,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 4_000,
      },
    },
  ],
  supportsModelListing: true,
};

// ---------------------------------------------------------------------------
// Factory + harness builder
// ---------------------------------------------------------------------------

export interface FakeHarness extends ContractHarness {
  /** Expose the factory so callers can register if needed. */
  factory: AdapterFactory;
}

/**
 * Build a ContractHarness for the fake adapter. Used by the kit's self-check
 * test. External contributors don't use this — they build their own harness
 * against their adapter.
 */
export function createFakeHarness(): FakeHarness {
  const state: FakeState = { scenario: null, captured: null };

  const factory: AdapterFactory<ApiKeyAuth> = {
    vendor: fakeManifest.vendor,
    manifest: fakeManifest,
    create: () => new FakeAdapter(state),
  };

  return {
    vendor: fakeManifest.vendor,
    factory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'apiKey') return { kind: 'apiKey', apiKey: 'sk-fake' };
      throw new Error(`FakeHarness: asked for unsupported authFor kind '${kind}'`);
    },
    unsupportedAuth: {
      kind: 'bedrockIam',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      region: 'us-east-1',
    },
    mockScenario(scenario) {
      state.scenario = scenario;
      state.captured = null;
    },
    cleanup() {
      state.scenario = null;
      state.captured = null;
    },
    getCapturedRequest() {
      return state.captured;
    },
    toolCapableModel: 'fake-tool-model',
    nonToolCapableModel: 'fake-plain-model',
    emitsToolCallStart: true,
  };
}
