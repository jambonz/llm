import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.mock must be hoisted to the top of the file (before imports).
// Pattern copied from openai.cache-key.test.ts in this directory.
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
import {
  openAIFactory,
  deepseekFactory,
  basetenFactory,
  moonshotFactory,
  zaiFactory,
  xaiFactory,
} from '../../../src/adapters/openai/index.js';
import { huggingfaceFactory } from '../../../src/adapters/huggingface/index.js';
import type { AdapterFactory, LlmAdapter, PromptRequest } from '../../../src/types.js';

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

async function requestBodyFor(factory: AdapterFactory, vendor: string): Promise<Record<string, unknown>> {
  registerAdapter(factory);
  mocks.create.mockResolvedValue(minimalStream());
  const adapter = await createLlm({ vendor, auth: { kind: 'apiKey', apiKey: 'sk-test' } });
  await drain(adapter, {
    model: 'some-model',
    messages: [{ role: 'user', content: 'hi' }],
    cacheKey: 'app-sid-123',
  });
  return mocks.create.mock.calls[0]![0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// prompt_cache_key must reach only endpoints VERIFIED to accept it. A strict
// OpenAI-compat backend rejects the whole request on an unknown body param,
// so the failure mode of over-forwarding is every LLM call failing.
// ---------------------------------------------------------------------------

describe('OpenAI-compatible adapters — prompt_cache_key gating', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  it.each([
    ['openai', openAIFactory],
    ['baseten', basetenFactory],
  ] as Array<[string, AdapterFactory]>)(
    '%s forwards cacheKey as prompt_cache_key (verified endpoint)',
    async (vendor, factory) => {
      const body = await requestBodyFor(factory, vendor);
      expect(body.prompt_cache_key).toBe('app-sid-123');
    },
  );

  it.each([
    ['deepseek', deepseekFactory],
    ['moonshot', moonshotFactory],
    ['zai', zaiFactory],
    ['xai', xaiFactory],
    ['huggingface', huggingfaceFactory],
  ] as Array<[string, AdapterFactory]>)(
    '%s does NOT forward prompt_cache_key (unverified endpoint)',
    async (vendor, factory) => {
      const body = await requestBodyFor(factory, vendor);
      expect(Object.prototype.hasOwnProperty.call(body, 'prompt_cache_key')).toBe(false);
    },
  );
});
