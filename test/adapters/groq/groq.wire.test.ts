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
import { groqFactory } from '../../../src/adapters/groq/index.js';

describe('GroqAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(groqFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  it('defaults baseURL to https://api.groq.com/openai/v1', async () => {
    await createLlm({ vendor: 'groq', auth: { kind: 'apiKey', apiKey: 'gsk-test' } });
    expect(mocks.openaiConstructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://api.groq.com/openai/v1');
    expect(opts.apiKey).toBe('gsk-test');
  });

  it('caller-supplied baseURL overrides the default (proxy use case)', async () => {
    await createLlm({
      vendor: 'groq',
      auth: {
        kind: 'apiKey',
        apiKey: 'gsk-test',
        baseURL: 'https://my-proxy.example.com/groq/v1',
      },
    });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe('https://my-proxy.example.com/groq/v1');
  });

  it('passes through timeout and maxRetries from ClientOptions', async () => {
    await createLlm({
      vendor: 'groq',
      auth: { kind: 'apiKey', apiKey: 'gsk-test' },
      client: { timeout: 15_000, maxRetries: 3 },
    });
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.timeout).toBe(15_000);
    expect(opts.maxRetries).toBe(3);
  });

  it('rejects missing apiKey', async () => {
    await expect(
      createLlm({
        vendor: 'groq',
        auth: { kind: 'apiKey', apiKey: '' },
      }),
    ).rejects.toThrowError(/apiKey is required/);
  });

  it('reports vendor id as "groq" on the resulting adapter', async () => {
    const llm = await createLlm({
      vendor: 'groq',
      auth: { kind: 'apiKey', apiKey: 'gsk-test' },
    });
    expect(llm.vendor).toBe('groq');
  });

  it('extracts request_id, region, processing_ms, and ratelimit headers into vendorMetadata', async () => {
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
            'x-request-id': 'req_01abc',
            'x-groq-region': 'msp',
            'openai-processing-ms': '87',
            'x-ratelimit-remaining-requests': '999',
            'x-ratelimit-remaining-tokens': '11803',
          }),
        },
      }),
      then: (onFulfilled: (s: typeof streamObj) => unknown) =>
        Promise.resolve(streamObj).then(onFulfilled),
    };
    mocks.create.mockReturnValueOnce(fakeApiPromise);

    const llm = await createLlm({
      vendor: 'groq',
      auth: { kind: 'apiKey', apiKey: 'gsk-test' },
    });
    const events = [];
    for await (const e of llm.stream({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(e);
    }
    const end = events.find((e) => e.type === 'end') as Extract<
      typeof events[number],
      { type: 'end' }
    >;
    expect(end.vendorMetadata).toEqual({
      request_id: 'req_01abc',
      region: 'msp',
      processing_ms: 87,
      requests_remaining: 999,
      tokens_remaining: 11803,
    });
  });
});
