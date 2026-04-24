import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlm } from '../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../src/registry.js';
import type {
  AdapterFactory,
  AdapterManifest,
  ApiKeyAuth,
  ClientOptions,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
} from '../../src/types.js';

/**
 * Build a minimal mock factory + adapter with spies on init() so we can verify
 * createLlm's orchestration.
 */
function buildMock(options: { vendor?: string; authKinds?: AuthKindForManifest[] } = {}) {
  const vendor = options.vendor ?? 'mock';
  const authKinds: AuthKindForManifest[] = options.authKinds ?? [
    { kind: 'apiKey', displayName: 'API Key', fields: [] },
  ];
  const initSpy = vi.fn();

  const manifest: AdapterManifest = {
    vendor,
    displayName: 'Mock',
    authKinds,
    knownModels: [
      {
        id: 'mock-1',
        capabilities: { streaming: true, tools: true, vision: false, systemPrompt: true },
      },
    ],
    supportsModelListing: false,
  };

  const factory: AdapterFactory<ApiKeyAuth> = {
    vendor,
    manifest,
    create: (): LlmAdapter<ApiKeyAuth> => ({
      vendor,
      acceptedAuth: ['apiKey'] as const,
      init: (auth: ApiKeyAuth, client?: ClientOptions) => {
        initSpy(auth, client);
      },
      stream: async function* (_req: PromptRequest): AsyncIterable<LlmEvent> {
        yield { type: 'end', finishReason: 'stop' };
      },
      appendAssistantToolCall: (history: Message[]) => history,
      appendToolResult: (history: Message[]) => history,
      listAvailableModels: async (): Promise<ModelInfo[]> => manifest.knownModels,
      testCredential: async (): Promise<void> => undefined,
    }),
  };

  return { factory, initSpy };
}

// Local type alias matching the shape of manifest.authKinds entries, to keep
// test construction terse.
type AuthKindForManifest = AdapterManifest['authKinds'][number];

describe('createLlm', () => {
  beforeEach(() => _resetRegistryForTests());
  afterEach(() => _resetRegistryForTests());

  it('returns an initialized adapter for a registered vendor', async () => {
    const { factory, initSpy } = buildMock();
    registerAdapter(factory);

    const llm = await createLlm({
      vendor: 'mock',
      auth: { kind: 'apiKey', apiKey: 'sk-test' },
    });

    expect(llm.vendor).toBe('mock');
    expect(initSpy).toHaveBeenCalledOnce();
    expect(initSpy).toHaveBeenCalledWith(
      { kind: 'apiKey', apiKey: 'sk-test' },
      undefined,
    );
  });

  it('forwards ClientOptions to init()', async () => {
    const { factory, initSpy } = buildMock();
    registerAdapter(factory);

    const client = { timeout: 5_000, maxRetries: 2 };
    await createLlm({
      vendor: 'mock',
      auth: { kind: 'apiKey', apiKey: 'sk-test' },
      client,
    });

    expect(initSpy).toHaveBeenCalledWith(
      { kind: 'apiKey', apiKey: 'sk-test' },
      client,
    );
  });

  it('awaits async init() before returning', async () => {
    const order: string[] = [];
    const manifest: AdapterManifest = {
      vendor: 'async-mock',
      displayName: 'Async Mock',
      authKinds: [{ kind: 'apiKey', displayName: 'API Key', fields: [] }],
      knownModels: [
        {
          id: 'x',
          capabilities: { streaming: true, tools: false, vision: false, systemPrompt: true },
        },
      ],
      supportsModelListing: false,
    };
    const factory: AdapterFactory<ApiKeyAuth> = {
      vendor: 'async-mock',
      manifest,
      create: () => ({
        vendor: 'async-mock',
        acceptedAuth: ['apiKey'] as const,
        init: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('init-done');
        },
        stream: async function* () {
          yield { type: 'end', finishReason: 'stop' as const };
        },
        appendAssistantToolCall: (h: Message[]) => h,
        appendToolResult: (h: Message[]) => h,
        listAvailableModels: async () => [],
        testCredential: async () => undefined,
      }),
    };
    registerAdapter(factory);

    await createLlm({ vendor: 'async-mock', auth: { kind: 'apiKey', apiKey: 'x' } });
    order.push('create-returned');

    expect(order).toEqual(['init-done', 'create-returned']);
  });

  it('throws on unknown vendor', async () => {
    await expect(
      createLlm({ vendor: 'nope', auth: { kind: 'apiKey', apiKey: 'x' } }),
    ).rejects.toThrowError(/Unknown vendor 'nope'/);
  });

  it('throws when auth kind is not in the adapter manifest', async () => {
    const { factory } = buildMock({
      authKinds: [{ kind: 'apiKey', displayName: 'API Key', fields: [] }],
    });
    registerAdapter(factory);

    await expect(
      createLlm({
        vendor: 'mock',
        auth: { kind: 'bedrockIam', accessKeyId: 'x', secretAccessKey: 'y', region: 'us-east-1' },
      }),
    ).rejects.toThrowError(/does not accept auth kind 'bedrockIam'.*Accepted kinds: apiKey/);
  });

  it('accepts any auth kind declared in the manifest', async () => {
    const { factory } = buildMock({
      authKinds: [
        { kind: 'apiKey', displayName: 'API Key', fields: [] },
        { kind: 'bedrockApiKey', displayName: 'Bedrock API Key', fields: [] },
      ],
    });
    registerAdapter(factory);

    await expect(
      createLlm({
        vendor: 'mock',
        auth: { kind: 'bedrockApiKey', apiKey: 'x', region: 'us-east-1' },
      }),
    ).resolves.toBeDefined();
  });
});
