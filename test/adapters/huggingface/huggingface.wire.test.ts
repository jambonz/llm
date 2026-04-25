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

import { createLlm, normalizeAuth } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { huggingfaceFactory } from '../../../src/adapters/huggingface/index.js';

describe('HuggingfaceAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(huggingfaceFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  it('defaults baseURL to https://router.huggingface.co/v1', async () => {
    await createLlm({ vendor: 'huggingface', auth: { kind: 'apiKey', apiKey: 'hf_test' } });
    expect(mocks.openaiConstructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://router.huggingface.co/v1');
    expect(opts.apiKey).toBe('hf_test');
  });

  it('caller-supplied baseURL overrides the default (proxy use case)', async () => {
    await createLlm({
      vendor: 'huggingface',
      auth: {
        kind: 'apiKey',
        apiKey: 'hf_test',
        baseURL: 'https://my-proxy.example.com/hf/v1',
      },
    });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://my-proxy.example.com/hf/v1');
  });

  it('passes through timeout and maxRetries from ClientOptions', async () => {
    await createLlm({
      vendor: 'huggingface',
      auth: { kind: 'apiKey', apiKey: 'hf_test' },
      client: { timeout: 15_000, maxRetries: 3 },
    });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.timeout).toBe(15_000);
    expect(opts.maxRetries).toBe(3);
  });

  it('rejects missing apiKey', async () => {
    await expect(
      createLlm({
        vendor: 'huggingface',
        auth: { kind: 'apiKey', apiKey: '' },
      }),
    ).rejects.toThrowError(/apiKey is required/);
  });

  it('reports vendor id as "huggingface" on the resulting adapter', async () => {
    const llm = await createLlm({
      vendor: 'huggingface',
      auth: { kind: 'apiKey', apiKey: 'hf_test' },
    });
    expect(llm.vendor).toBe('huggingface');
  });

  it('normalizeAuth maps DB-shape api_key to ApiKeyAuth (no forced baseURL)', () => {
    expect(normalizeAuth('huggingface', { api_key: 'hf_test' })).toEqual({
      kind: 'apiKey',
      apiKey: 'hf_test',
    });
  });

  it('normalizeAuth passes through caller-supplied api_url', () => {
    expect(
      normalizeAuth('huggingface', { api_key: 'hf_test', api_url: 'https://my-proxy/v1' }),
    ).toEqual({
      kind: 'apiKey',
      apiKey: 'hf_test',
      baseURL: 'https://my-proxy/v1',
    });
  });

  it('end event carries vendorMetadata with x-inference-provider when present', async () => {
    // Mock the SDK's APIPromise pattern: create returns an object that has
    // both `.withResponse()` AND is awaitable to the stream directly.
    const streamObj = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] };
        yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      },
    };
    const fakeApiPromise = {
      withResponse: async () => ({
        data: streamObj,
        response: {
          headers: new Headers({
            'x-inference-provider': 'groq',
            'x-request-id': 'req-abc-123',
          }),
        },
      }),
      then: (onFulfilled: (s: typeof streamObj) => unknown) => Promise.resolve(streamObj).then(onFulfilled),
    };
    mocks.create.mockReturnValueOnce(fakeApiPromise);

    const llm = await createLlm({
      vendor: 'huggingface',
      auth: { kind: 'apiKey', apiKey: 'hf_test' },
    });
    const events = [];
    for await (const e of llm.stream({
      model: 'meta-llama/Llama-3.3-70B-Instruct',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(e);
    }
    const end = events.find((e) => e.type === 'end') as Extract<
      (typeof events)[number],
      { type: 'end' }
    >;
    expect(end.vendorMetadata).toEqual({
      provider: 'groq',
      request_id: 'req-abc-123',
    });
  });

  it('end event omits vendorMetadata when no allowlisted headers are present', async () => {
    const streamObj = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      },
    };
    const fakeApiPromise = {
      withResponse: async () => ({
        data: streamObj,
        response: {
          headers: new Headers({ 'content-type': 'application/json' }),
        },
      }),
      then: (onFulfilled: (s: typeof streamObj) => unknown) => Promise.resolve(streamObj).then(onFulfilled),
    };
    mocks.create.mockReturnValueOnce(fakeApiPromise);

    const llm = await createLlm({
      vendor: 'huggingface',
      auth: { kind: 'apiKey', apiKey: 'hf_test' },
    });
    const events = [];
    for await (const e of llm.stream({
      model: 'meta-llama/Llama-3.3-70B-Instruct',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(e);
    }
    const end = events.find((e) => e.type === 'end') as Extract<
      (typeof events)[number],
      { type: 'end' }
    >;
    expect(end.vendorMetadata).toBeUndefined();
  });
});
