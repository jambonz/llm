import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openaiConstructorSpy: vi.fn(),
  create: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    models = { list: mocks.modelsList };
    constructor(opts: unknown) {
      mocks.openaiConstructorSpy(opts);
    }
  }
  return { default: MockOpenAI };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { bedrockMantleFactory } from '../../../src/adapters/openai/index.js';
import type { LlmAdapter, PromptRequest } from '../../../src/types.js';

function minimalStream(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<void> {
  // eslint-disable-next-line no-empty
  for await (const _ of adapter.stream(req)) {
  }
}

describe('BedrockMantleAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(bedrockMantleFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  it('defaults baseURL to the us-east-1 Mantle endpoint', async () => {
    await createLlm({
      vendor: 'bedrock-mantle',
      auth: { kind: 'apiKey', apiKey: 'bedrock-test-key' },
    });
    expect(mocks.openaiConstructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://bedrock-mantle.us-east-1.api.aws/v1');
    expect(opts.apiKey).toBe('bedrock-test-key');
  });

  it('caller-supplied baseURL overrides the default (xAI /openai/v1 path, other regions)', async () => {
    await createLlm({
      vendor: 'bedrock-mantle',
      auth: {
        kind: 'apiKey',
        apiKey: 'bedrock-test-key',
        baseURL: 'https://bedrock-mantle.us-west-2.api.aws/openai/v1',
      },
    });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://bedrock-mantle.us-west-2.api.aws/openai/v1');
  });

  // The whole point of this adapter: Bedrock adds OpenAI-compatible models
  // continuously, and a newly-launched one must be usable by id alone. If this
  // ever regresses into an allowlist, every new model needs a library release.
  it('streams a model id absent from knownModels, passed through verbatim', async () => {
    mocks.create.mockResolvedValue(minimalStream());
    const adapter = await createLlm({
      vendor: 'bedrock-mantle',
      auth: { kind: 'apiKey', apiKey: 'bedrock-test-key' },
    });
    await drain(adapter, {
      model: 'deepseek.v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const body = mocks.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('deepseek.v4-flash');
  });

  it('listAvailableModels returns live ids, enriched from the manifest where curated', async () => {
    mocks.modelsList.mockResolvedValue({
      data: [
        { id: 'moonshotai.kimi-k2.5' },
        { id: 'zai.glm-5' },
        { id: 'some.brand-new-model' },
      ],
    });
    const adapter = await createLlm({
      vendor: 'bedrock-mantle',
      auth: { kind: 'apiKey', apiKey: 'bedrock-test-key' },
    });
    const models = await adapter.listAvailableModels();

    const kimi = models.find((m) => m.id === 'moonshotai.kimi-k2.5')!;
    expect(kimi.capabilities.vision).toBe(true);
    expect(kimi.capabilities.maxContextTokens).toBe(262_144);

    const glm5 = models.find((m) => m.id === 'zai.glm-5')!;
    expect(glm5.capabilities.maxContextTokens).toBe(202_800);

    // uncurated ids still surface — they are usable, just without metadata
    const fresh = models.find((m) => m.id === 'some.brand-new-model')!;
    expect(fresh).toBeDefined();
    expect(fresh.capabilities.maxContextTokens).toBeUndefined();
  });
});
