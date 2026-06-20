/**
 * Regression guard: Google adapter must silently ignore PromptRequest.cacheKey.
 *
 * Production bug this catches: a dev plumbs cacheKey into a `cachedContent`
 * field on the SDK call, causing Gemini API errors for callers who set cacheKey
 * (which works on other adapters). The contract: cacheKey must NOT alter the
 * config object sent to @google/genai in any way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContentStream: mocks.generateContentStream,
      list: mocks.modelsList,
    };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { googleFactory } from '../../../src/adapters/google/index.js';
import type { LlmAdapter, LlmEvent, PromptRequest } from '../../../src/types.js';

function minimalAsyncIterable(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] };
      yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of adapter.stream(req)) out.push(e);
  return out;
}

async function buildAdapter(): Promise<LlmAdapter> {
  return createLlm({ vendor: 'google', auth: { kind: 'googleApiKey', apiKey: 'AIza-test' } });
}

/** Shared base request — no cacheKey, no signal. */
const BASE_REQUEST: PromptRequest = {
  model: 'gemini-2.5-flash',
  system: 'You are a test agent.',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [
    {
      name: 'lookup_order',
      description: 'Find an order',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  ],
};

describe('Google adapter — cacheKey is silently ignored', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(googleFactory);
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();
  });

  it(
    'config is deep-equal with and without cacheKey, and never contains cachedContent',
    async () => {
      // --- Run A: without cacheKey ---
      mocks.generateContentStream.mockResolvedValueOnce(minimalAsyncIterable());
      const adapterA = await buildAdapter();
      await drain(adapterA, BASE_REQUEST);
      const [argA] = mocks.generateContentStream.mock.calls[0]!;
      const configA = argA.config as Record<string, unknown>;

      // Reset captures for run B
      mocks.generateContentStream.mockReset();

      // --- Run B: with cacheKey set ---
      mocks.generateContentStream.mockResolvedValueOnce(minimalAsyncIterable());
      const adapterB = await buildAdapter();
      await drain(adapterB, { ...BASE_REQUEST, cacheKey: 'conv-1' });
      const [argB] = mocks.generateContentStream.mock.calls[0]!;
      const configB = argB.config as Record<string, unknown>;

      // Contract assertions
      expect(configB).toEqual(configA);
      expect(configB).not.toHaveProperty('cachedContent');
      expect(configA).not.toHaveProperty('cachedContent');
    },
    3000,
  );
});
