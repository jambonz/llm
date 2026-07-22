import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.mock must be hoisted before any imports that resolve the 'openai' module.
// Groq uses the openai SDK with a custom baseURL — same mock pattern as all
// openai-wire adapters.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
  openaiConstructorSpy: vi.fn(),
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
import { openAIFactory } from '../../../src/adapters/openai/index.js';
import type { LlmAdapter, PromptRequest } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal async-iterable stream accepted by streamFromOpenAI. */
function minimalStream(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    },
  };
}

/** Drain the stream so the adapter finishes building its body. */
async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<void> {
   
  for await (const _ of adapter.stream(req)) {
    // drain only; body-shape assertions are on the captured create() call
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Groq adapter — cacheKey opt-out', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    // Register both adapters: tests below cover Groq (primary) and OpenAI
    // (regression guard that the opt-out didn't break the default path).
    registerAdapter(groqFactory);
    registerAdapter(openAIFactory);
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    for (const spy of Object.values(mocks)) spy.mockReset();
  });

  // -------------------------------------------------------------------------
  // Class 1 (primary contract): Groq + cacheKey set → prompt_cache_key ABSENT
  //
  // Production bug caught: the Groq adapter forwards prompt_cache_key to the
  // Groq API, which does not accept that parameter and returns an error (or
  // silently ignores/corrupts the request).
  // -------------------------------------------------------------------------
  it(
    'does NOT send prompt_cache_key to Groq even when cacheKey is set',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());

      const groq = await createLlm({
        vendor: 'groq',
        auth: { kind: 'apiKey', apiKey: 'gsk-test' },
      });
      await drain(groq, {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'k1',
      });

      const [body] = mocks.create.mock.calls[0]!;
      expect(body).not.toHaveProperty('prompt_cache_key');
    },
    3000,
  );

  // -------------------------------------------------------------------------
  // Class 2 (body well-formed after opt-out): Groq + cacheKey → model,
  // messages, stream still present.
  //
  // Production bug caught: the opt-out code accidentally strips unrelated
  // fields, producing a malformed request (missing model or messages) that
  // the Groq API rejects with a 400.
  // -------------------------------------------------------------------------
  it(
    'still sends model, messages, and stream:true to Groq when cacheKey is set',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());

      const groq = await createLlm({
        vendor: 'groq',
        auth: { kind: 'apiKey', apiKey: 'gsk-test' },
      });
      await drain(groq, {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'k1',
      });

      const [body] = mocks.create.mock.calls[0]!;
      expect(body.model).toBe('llama-3.3-70b-versatile');
      expect(Array.isArray(body.messages)).toBe(true);
      expect((body.messages as unknown[]).length).toBeGreaterThan(0);
      expect(body.stream).toBe(true);
    },
    3000,
  );

  // -------------------------------------------------------------------------
  // Class 3 (regression guard): OpenAI + cacheKey set → prompt_cache_key
  // IS present with the correct value.
  //
  // Production bug caught: the opt-out mechanism (includeCacheKey:false)
  // accidentally flips the default, so the OpenAI adapter silently stops
  // forwarding cacheKey and users lose prompt caching on OpenAI.
  // -------------------------------------------------------------------------
  it(
    'OpenAI default path still forwards cacheKey as prompt_cache_key (regression guard)',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());

      const openai = await createLlm({
        vendor: 'openai',
        auth: { kind: 'apiKey', apiKey: 'sk-test' },
      });
      await drain(openai, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'k1',
      });

      const [body] = mocks.create.mock.calls[0]!;
      expect(body.prompt_cache_key).toBe('k1');
    },
    3000,
  );
});
