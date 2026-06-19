import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.mock must be hoisted to the top of the file (before imports).
// Pattern copied from openai.wire.test.ts in this directory.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    models = { list: mocks.modelsList };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { default: MockOpenAI };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { openAIFactory } from '../../../src/adapters/openai/index.js';
import type { LlmAdapter, PromptRequest } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal async-iterable stream: one content chunk + stop chunk. */
function minimalStream(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of adapter.stream(req)) {
    // drain only; do not assert events
  }
}

async function buildAdapter(): Promise<LlmAdapter> {
  return createLlm({ vendor: 'openai', auth: { kind: 'apiKey', apiKey: 'sk-test' } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAI adapter — cacheKey forwarding', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(openAIFactory);
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  // -------------------------------------------------------------------------
  // Class 1: cacheKey present → body.prompt_cache_key === the value
  // Production bug caught: developer omits the forwarding line; body never
  // receives prompt_cache_key, so the LLM provider ignores caching entirely.
  // -------------------------------------------------------------------------
  it(
    'forwards cacheKey to body.prompt_cache_key when present',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());

      const adapter = await buildAdapter();
      await drain(adapter, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'session-abc-123',
      });

      const [body] = mocks.create.mock.calls[0]!;
      expect(body.prompt_cache_key).toBe('session-abc-123');
    },
    3000,
  );

  // -------------------------------------------------------------------------
  // Class 2: cacheKey absent → body must NOT contain prompt_cache_key at all
  // Production bug caught: developer always sets prompt_cache_key (e.g. to
  // undefined), causing provider to reject or misbehave on the presence of the
  // key even with a null/undefined value.
  // -------------------------------------------------------------------------
  it(
    'does not include prompt_cache_key in body when cacheKey is absent',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());

      const adapter = await buildAdapter();
      await drain(adapter, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        // cacheKey deliberately omitted
      });

      const [body] = mocks.create.mock.calls[0]!;
      expect(body).not.toHaveProperty('prompt_cache_key');
    },
    3000,
  );

  // -------------------------------------------------------------------------
  // Class 3 (regression): gpt-5 model + cacheKey + maxTokens
  // prompt_cache_key must coexist with max_completion_tokens (not max_tokens).
  // Production bug caught: if cacheKey is inserted AFTER the max-tokens switch
  // block it could accidentally overwrite or shadow max_completion_tokens, or
  // if placed incorrectly in a conditional the two params might be mutually
  // exclusive.
  // -------------------------------------------------------------------------
  it(
    'coexists with max_completion_tokens on gpt-5 when both cacheKey and maxTokens are set',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());

      const adapter = await buildAdapter();
      await drain(adapter, {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'cache-key-for-regression',
        maxTokens: 256,
      });

      const [body] = mocks.create.mock.calls[0]!;
      // cacheKey forwarded
      expect(body.prompt_cache_key).toBe('cache-key-for-regression');
      // gpt-5 must use max_completion_tokens, not max_tokens
      expect(body.max_completion_tokens).toBe(256);
      expect(body).not.toHaveProperty('max_tokens');
    },
    3000,
  );
});
