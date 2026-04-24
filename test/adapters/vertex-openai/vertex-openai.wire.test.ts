import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openaiConstructorSpy: vi.fn(),
  googleAuthConstructorSpy: vi.fn(),
  getAccessTokenSpy: vi.fn(),
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

vi.mock('google-auth-library', () => {
  class MockGoogleAuth {
    constructor(opts: unknown) {
      mocks.googleAuthConstructorSpy(opts);
    }
    async getClient() {
      return {
        async getAccessToken() {
          return mocks.getAccessTokenSpy();
        },
      };
    }
  }
  return { GoogleAuth: MockGoogleAuth };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { vertexOpenAIFactory } from '../../../src/adapters/vertex-openai/index.js';
import type { LlmAdapter, LlmEvent, PromptRequest, ServiceAccountJson } from '../../../src/types.js';

function mockStream(chunks: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const e of adapter.stream(req)) events.push(e);
  return events;
}

const SERVICE_KEY: ServiceAccountJson = {
  type: 'service_account',
  project_id: 'test-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  client_email: 'svc@test-project.iam.gserviceaccount.com',
};

describe('VertexOpenAIAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(vertexOpenAIFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
    mocks.getAccessTokenSpy.mockResolvedValue({ token: 'fake-bearer-token' });
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  it('constructs OpenAI client with Vertex-AI baseURL built from projectId/location', async () => {
    await createLlm({
      vendor: 'vertex-openai',
      auth: {
        kind: 'vertexServiceAccount',
        credentials: SERVICE_KEY,
        projectId: 'my-gcp-project',
        location: 'us-east4',
      },
    });
    expect(mocks.openaiConstructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
    expect(opts.baseURL).toBe(
      'https://us-east4-aiplatform.googleapis.com/v1beta1/projects/my-gcp-project/locations/us-east4/endpoints/openapi',
    );
    expect(opts.apiKey).toBe('vertex-ai');
    expect(typeof opts.fetch).toBe('function');
  });

  it('sets up GoogleAuth with cloud-platform scope and the service-account credentials', async () => {
    await createLlm({
      vendor: 'vertex-openai',
      auth: {
        kind: 'vertexServiceAccount',
        credentials: SERVICE_KEY,
        projectId: 'p',
        location: 'us-central1',
      },
    });
    expect(mocks.googleAuthConstructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.googleAuthConstructorSpy.mock.calls[0]!;
    expect(opts.credentials).toEqual(SERVICE_KEY);
    expect(opts.scopes).toEqual(['https://www.googleapis.com/auth/cloud-platform']);
  });

  it('custom fetch injects Bearer <access token> on every request', async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => new Response('ok'));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await createLlm({
        vendor: 'vertex-openai',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: 'p',
          location: 'us-central1',
        },
      });
      const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
      const customFetch = opts.fetch as typeof fetch;
      await customFetch('https://example.com/path', { method: 'POST' });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const call = fetchSpy.mock.calls[0]! as unknown as [string, RequestInit];
      const [, init] = call;
      const headers = init.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer fake-bearer-token');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('non-2xx fetch response is rebuilt with body inlined as plain text', async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          '{"error":{"code":400,"message":"Request contains an invalid argument."}}',
          {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-encoding': 'gzip', 'content-type': 'application/json' },
          },
        ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await createLlm({
        vendor: 'vertex-openai',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: 'p',
          location: 'us-central1',
        },
      });
      const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
      const customFetch = opts.fetch as typeof fetch;
      const rebuilt = await customFetch('https://example.com/path', { method: 'POST' });
      // Body is readable (not locked by an earlier consumer).
      expect(await rebuilt.text()).toContain('Request contains an invalid argument');
      // content-encoding stripped so the SDK doesn't try to un-gzip plain text.
      expect(rebuilt.headers.get('content-encoding')).toBeNull();
      expect(rebuilt.status).toBe(400);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('Vertex array-wrapped error bodies are unwrapped so the OpenAI SDK can parse them', async () => {
    const origFetch = globalThis.fetch;
    // This is the exact shape Vertex returns on model-not-in-region 404s —
    // a single-element array with an {error: {...}} object inside.
    const arrayBody = JSON.stringify([
      {
        error: {
          code: 404,
          message:
            'Publisher Model ... was not found or your project does not have access to it.',
          status: 'NOT_FOUND',
        },
      },
    ]);
    const fetchSpy = vi.fn(
      async () =>
        new Response(arrayBody, {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await createLlm({
        vendor: 'vertex-openai',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: 'p',
          location: 'us-central1',
        },
      });
      const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
      const customFetch = opts.fetch as typeof fetch;
      const rebuilt = await customFetch('https://example.com/path', { method: 'POST' });
      const bodyText = await rebuilt.text();
      // Array unwrapped — body is the inner object, which the OpenAI SDK
      // will successfully read `.error.message` off of.
      const parsed = JSON.parse(bodyText);
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed.error.code).toBe(404);
      expect(parsed.error.message).toContain('not found or your project does not have access');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('empty 404 body gets an appended hint about regional model availability', async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn(
      async () => new Response('', { status: 404, statusText: 'Not Found' }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await createLlm({
        vendor: 'vertex-openai',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: 'p',
          location: 'us-central1',
        },
      });
      const [opts] = mocks.openaiConstructorSpy.mock.calls[0]!;
      const customFetch = opts.fetch as typeof fetch;
      const rebuilt = await customFetch('https://example.com/path', { method: 'POST' });
      const body = await rebuilt.text();
      expect(body).toContain('not hosted in this region');
      expect(rebuilt.status).toBe(404);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('rejects missing projectId', async () => {
    await expect(
      createLlm({
        vendor: 'vertex-openai',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: '',
          location: 'us-central1',
        },
      }),
    ).rejects.toThrowError(/projectId is required/);
  });

  it('rejects missing location', async () => {
    await expect(
      createLlm({
        vendor: 'vertex-openai',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: 'p',
          location: '',
        },
      }),
    ).rejects.toThrowError(/location is required/);
  });

  it('defaults max_tokens to 4096 when caller omits maxTokens (Vertex Llama MaaS quirk)', async () => {
    mocks.create.mockResolvedValue(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await createLlm({
      vendor: 'vertex-openai',
      auth: {
        kind: 'vertexServiceAccount',
        credentials: SERVICE_KEY,
        projectId: 'p',
        location: 'us-central1',
      },
    });
    await drain(adapter, {
      model: 'meta/llama-4-scout-17b-16e-instruct-maas',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_tokens).toBe(4096);
  });

  it('respects caller-provided maxTokens over the Vertex default', async () => {
    mocks.create.mockResolvedValue(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await createLlm({
      vendor: 'vertex-openai',
      auth: {
        kind: 'vertexServiceAccount',
        credentials: SERVICE_KEY,
        projectId: 'p',
        location: 'us-central1',
      },
    });
    await drain(adapter, {
      model: 'meta/llama-4-scout-17b-16e-instruct-maas',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 256,
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_tokens).toBe(256);
  });

  it('listAvailableModels returns the curated manifest set without calling the SDK', async () => {
    const llm = await createLlm({
      vendor: 'vertex-openai',
      auth: {
        kind: 'vertexServiceAccount',
        credentials: SERVICE_KEY,
        projectId: 'p',
        location: 'us-central1',
      },
    });
    const models = await llm.listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(mocks.modelsList).not.toHaveBeenCalled();
  });
});
