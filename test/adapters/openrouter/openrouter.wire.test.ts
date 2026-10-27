import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openaiConstructorSpy: vi.fn(),
  create: vi.fn(),
  modelsList: vi.fn(),
  get: vi.fn(),
  withOptions: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    models = { list: mocks.modelsList };
    get = mocks.get;
    withOptions(opts: unknown) {
      mocks.withOptions(opts);
      return this;
    }
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
import { openRouterFactory } from '../../../src/adapters/openrouter/index.js';

const auth = { kind: 'apiKey' as const, apiKey: 'sk-or-v1-test' };

function minimalStream(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    },
  };
}

describe('OpenRouterAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(openRouterFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  it('defaults baseURL to https://openrouter.ai/api/v1', async () => {
    await createLlm({ vendor: 'openrouter', auth });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(opts.apiKey).toBe('sk-or-v1-test');
  });

  it('caller-supplied baseURL overrides the default (proxy use case)', async () => {
    await createLlm({
      vendor: 'openrouter',
      auth: { ...auth, baseURL: 'https://my-proxy.example.com/openrouter/v1' },
    });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://my-proxy.example.com/openrouter/v1');
  });

  it('sends jambonz app-attribution headers on every request', async () => {
    await createLlm({ vendor: 'openrouter', auth });
    expect(mocks.withOptions).toHaveBeenCalledWith({
      defaultHeaders: {
        'HTTP-Referer': 'https://jambonz.org',
        'X-OpenRouter-Title': 'jambonz',
      },
    });
  });

  it('reports vendor id as "openrouter" on the resulting adapter', async () => {
    const llm = await createLlm({ vendor: 'openrouter', auth });
    expect(llm.vendor).toBe('openrouter');
  });

  it('testCredential probes the authenticated /key endpoint, not the public /models', async () => {
    mocks.get.mockResolvedValue({ data: { label: 'k' } });
    const llm = await createLlm({ vendor: 'openrouter', auth });
    await llm.testCredential();
    expect(mocks.get).toHaveBeenCalledWith('/key');
    expect(mocks.modelsList).not.toHaveBeenCalled();
  });

  it('testCredential rejects when /key rejects (bad key → 401)', async () => {
    mocks.get.mockRejectedValue(new Error('401 User not found.'));
    const llm = await createLlm({ vendor: 'openrouter', auth });
    await expect(llm.testCredential()).rejects.toThrow(/401/);
  });

  it('listAvailableModels uses OpenRouter capability metadata and drops :batch and non-text models', async () => {
    mocks.modelsList.mockResolvedValue({
      data: [
        {
          id: 'qwen/qwen3-vl-8b-instruct',
          name: 'Qwen: Qwen3 VL 8B Instruct',
          context_length: 262144,
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          supported_parameters: ['tools', 'max_tokens'],
        },
        {
          id: 'meta-llama/llama-3.2-3b-instruct',
          name: 'Meta: Llama 3.2 3B Instruct',
          context_length: 131072,
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          supported_parameters: ['max_tokens'],
        },
        {
          id: 'openai/gpt-4o-mini:batch',
          architecture: { output_modalities: ['text'] },
          supported_parameters: ['tools'],
        },
        {
          id: 'google/gemini-2.5-flash-image',
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] },
          supported_parameters: [],
        },
        {
          id: 'openai/gpt-5-image',
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
          supported_parameters: [],
        },
        { id: 'anthropic/claude-haiku-5.5', architecture: { output_modalities: ['text'] } },
      ],
    });
    const llm = await createLlm({ vendor: 'openrouter', auth });
    const models = await llm.listAvailableModels();
    expect(models.map((m) => m.id)).toEqual([
      'qwen/qwen3-vl-8b-instruct',
      'meta-llama/llama-3.2-3b-instruct',
      'google/gemini-2.5-flash-image',
      'anthropic/claude-haiku-5.5',
    ]);
    expect(models[0]).toEqual({
      id: 'qwen/qwen3-vl-8b-instruct',
      displayName: 'Qwen: Qwen3 VL 8B Instruct',
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        systemPrompt: true,
        maxContextTokens: 262144,
      },
    });
    expect(models[1]!.capabilities.tools).toBe(false);
    // Curated entries come from the manifest.
    expect(models[3]!.displayName).toBe('Claude Haiku 5.5 (OpenRouter)');
  });

  it('adds cache_control and prompt_cache_key for an Anthropic model with a cacheKey', async () => {
    mocks.create.mockResolvedValue(minimalStream());
    const llm = await createLlm({ vendor: 'openrouter', auth });
    for await (const _ of llm.stream({
      model: 'anthropic/claude-haiku-5.5',
      messages: [{ role: 'user', content: 'hi' }],
      cacheKey: 'app-sid',
    })) {
      // drain
    }
    const body = mocks.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.prompt_cache_key).toBe('app-sid');
  });

  it('extracts x-generation-id into vendorMetadata.request_id', async () => {
    const streamObj = minimalStream();
    mocks.create.mockReturnValueOnce({
      withResponse: async () => ({
        data: streamObj,
        response: { headers: new Headers({ 'x-generation-id': 'gen-123-abc' }) },
      }),
      then: (onFulfilled: (s: typeof streamObj) => unknown) =>
        Promise.resolve(streamObj).then(onFulfilled),
    });
    const llm = await createLlm({ vendor: 'openrouter', auth });
    const events = [];
    for await (const e of llm.stream({
      model: 'meta-llama/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(e);
    }
    const end = events.find((e) => e.type === 'end') as Extract<
      typeof events[number],
      { type: 'end' }
    >;
    expect(end.vendorMetadata).toEqual({ request_id: 'gen-123-abc' });
  });
});
