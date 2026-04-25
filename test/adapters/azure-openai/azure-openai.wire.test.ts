import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  azureConstructorSpy: vi.fn(),
  create: vi.fn(),
}));

vi.mock('openai', () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mocks.create } };
    constructor(opts: unknown) {
      mocks.azureConstructorSpy(opts);
    }
  }
  return { AzureOpenAI: MockAzureOpenAI, default: MockAzureOpenAI };
});

import { createLlm, normalizeAuth } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { azureOpenAIFactory } from '../../../src/adapters/azure-openai/index.js';
import type { AzureOpenAIApiKeyAuth } from '../../../src/types.js';

const validAuth: AzureOpenAIApiKeyAuth = {
  kind: 'azureOpenAIApiKey',
  apiKey: 'test-key',
  endpoint: 'https://my-resource.openai.azure.com',
  deployment: 'prod-gpt-4o',
  apiVersion: '2024-10-21',
};

describe('AzureOpenAIAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(azureOpenAIFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  it('constructs AzureOpenAI with the four required fields', async () => {
    await createLlm({ vendor: 'azure-openai', auth: validAuth });
    expect(mocks.azureConstructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.azureConstructorSpy.mock.calls[0]!;
    expect(opts.apiKey).toBe('test-key');
    expect(opts.endpoint).toBe('https://my-resource.openai.azure.com');
    expect(opts.deployment).toBe('prod-gpt-4o');
    expect(opts.apiVersion).toBe('2024-10-21');
  });

  it('passes through timeout and maxRetries from ClientOptions', async () => {
    await createLlm({
      vendor: 'azure-openai',
      auth: validAuth,
      client: { timeout: 15_000, maxRetries: 3 },
    });
    const [opts] = mocks.azureConstructorSpy.mock.calls[0]!;
    expect(opts.timeout).toBe(15_000);
    expect(opts.maxRetries).toBe(3);
  });

  it('rejects missing apiKey', async () => {
    await expect(
      createLlm({
        vendor: 'azure-openai',
        auth: { ...validAuth, apiKey: '' },
      }),
    ).rejects.toThrowError(/apiKey is required/);
  });

  it('rejects missing endpoint', async () => {
    await expect(
      createLlm({
        vendor: 'azure-openai',
        auth: { ...validAuth, endpoint: '' },
      }),
    ).rejects.toThrowError(/endpoint is required/);
  });

  it('rejects missing deployment', async () => {
    await expect(
      createLlm({
        vendor: 'azure-openai',
        auth: { ...validAuth, deployment: '' },
      }),
    ).rejects.toThrowError(/deployment is required/);
  });

  it('rejects missing apiVersion', async () => {
    await expect(
      createLlm({
        vendor: 'azure-openai',
        auth: { ...validAuth, apiVersion: '' },
      }),
    ).rejects.toThrowError(/apiVersion is required/);
  });

  it('rejects unsupported auth kind at createLlm boundary', async () => {
    // createLlm validates auth.kind against manifest.authKinds before init()
    // runs. That guard should fire for anything other than azureOpenAIApiKey.
    await expect(
      createLlm({
        vendor: 'azure-openai',
        auth: { kind: 'apiKey', apiKey: 'sk-test' } as never,
      }),
    ).rejects.toThrowError(/does not accept auth kind/);
  });

  it('testCredential issues a minimal chat.completions.create probe', async () => {
    mocks.create.mockResolvedValueOnce({
      id: 'chatcmpl-probe',
      object: 'chat.completion',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
      ],
    });
    const llm = await createLlm({ vendor: 'azure-openai', auth: validAuth });
    await llm.testCredential();
    expect(mocks.create).toHaveBeenCalledOnce();
    const [body] = mocks.create.mock.calls[0]!;
    // gpt-5 family and o-series reasoning models reject `max_tokens`; the
    // probe uses the newer `max_completion_tokens` which is a superset
    // accepted by all current Azure deployments. The cap is generous (256)
    // so reasoning models have room for their internal reasoning tokens
    // plus a tiny visible reply — a smaller cap (we shipped with 1 in
    // 0.4.1) caused Azure to return 400 because reasoning consumed the
    // entire budget before any output could be produced.
    expect(body.max_completion_tokens).toBe(256);
    expect(body.max_tokens).toBeUndefined();
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }]);
  });

  it('testCredential surfaces vendor errors (bad key / wrong deployment)', async () => {
    mocks.create.mockRejectedValueOnce(
      Object.assign(new Error('401 Unauthorized — invalid api key'), { status: 401 }),
    );
    const llm = await createLlm({ vendor: 'azure-openai', auth: validAuth });
    await expect(llm.testCredential()).rejects.toThrowError(/invalid api key/);
  });

  it('listAvailableModels returns the curated manifest set without calling the SDK', async () => {
    const llm = await createLlm({ vendor: 'azure-openai', auth: validAuth });
    const models = await llm.listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    // chat.completions.create should NOT be called — manifest-only list.
    expect(mocks.create).not.toHaveBeenCalled();
    // Sanity: gpt-4o should be in the list.
    expect(models.some((m) => m.id === 'gpt-4o')).toBe(true);
  });

  it('normalizeAuth builds AzureOpenAIApiKeyAuth from DB-shape snake_case fields', () => {
    const spec = normalizeAuth('azure-openai', {
      api_key: 'k',
      endpoint: 'https://x.openai.azure.com',
      deployment: 'd',
      api_version: '2024-10-21',
    });
    expect(spec).toEqual({
      kind: 'azureOpenAIApiKey',
      apiKey: 'k',
      endpoint: 'https://x.openai.azure.com',
      deployment: 'd',
      apiVersion: '2024-10-21',
    });
  });

  it('normalizeAuth rejects azure-openai credentials missing any required field', () => {
    expect(() =>
      normalizeAuth('azure-openai', {
        api_key: 'k',
        endpoint: 'https://x.openai.azure.com',
        deployment: 'd',
        // api_version missing
      }),
    ).toThrowError(/api_version/);
  });

  it('stream() forwards maxTokens as max_completion_tokens (gpt-5 / o-series compatibility)', async () => {
    mocks.create.mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      },
    });
    const llm = await createLlm({ vendor: 'azure-openai', auth: validAuth });
    const events = [];
    for await (const e of llm.stream({
      model: 'prod-gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 128,
    })) {
      events.push(e);
    }
    expect(mocks.create).toHaveBeenCalledOnce();
    const [body] = mocks.create.mock.calls[0]!;
    // Azure deployment names are arbitrary; the adapter pins
    // max_completion_tokens so gpt-5 / o-series deployments work regardless
    // of what the user named them.
    expect(body.max_completion_tokens).toBe(128);
    expect(body.max_tokens).toBeUndefined();
  });
});
