import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* OpenRouter's automatic prompt caching for Anthropic models: a top-level
   `cache_control` on the request. Anthropic models ignore `prompt_cache_key`,
   so without it nothing is cached when Claude is reached through OpenRouter.
   Mock pattern copied from openai.cache-key.test.ts in this directory. */
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
import { _resetRegistryForTests, registerAdapter } from '../../../src/registry.js';
import { openAIFactory } from '../../../src/adapters/openai/index.js';
import type { LlmAdapter, PromptRequest } from '../../../src/types.js';

const OPENROUTER = 'https://openrouter.ai/api/v1';

function minimalStream(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    },
  };
}

async function bodyFor(baseURL: string | undefined, req: PromptRequest): Promise<Record<string, unknown>> {
  mocks.create.mockResolvedValue(minimalStream());
  const adapter: LlmAdapter = await createLlm({
    vendor: 'openai',
    auth: { kind: 'apiKey', apiKey: 'sk-test', ...(baseURL ? { baseURL } : {}) },
  });
  for await (const _ of adapter.stream(req)) {
    // drain
  }
  return mocks.create.mock.calls[0]![0] as Record<string, unknown>;
}

const req = (model: string, cacheKey?: string): PromptRequest => ({
  model,
  system: 'You are Jenny.',
  messages: [{ role: 'user', content: 'hola' }],
  ...(cacheKey ? { cacheKey } : {}),
});

describe('OpenAI adapter — OpenRouter automatic prompt caching for Anthropic models', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(openAIFactory);
    mocks.create.mockReset();
  });
  afterEach(() => {
    _resetRegistryForTests();
    mocks.create.mockReset();
  });

  it('adds top-level cache_control for an anthropic/ model on OpenRouter with a cacheKey', async () => {
    const body = await bodyFor(OPENROUTER, req('anthropic/claude-haiku-4.5', 'app-sid'));
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.prompt_cache_key).toBe('app-sid');          // unchanged alongside it
  });

  it('accepts OpenRouter\'s ~anthropic/ "latest" alias too', async () => {
    const body = await bodyFor(OPENROUTER, req('~anthropic/claude-sonnet-latest', 'app-sid'));
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does not add it without a cacheKey', async () => {
    const body = await bodyFor(OPENROUTER, req('anthropic/claude-haiku-4.5'));
    expect(body).not.toHaveProperty('cache_control');
  });

  it('does not add it for a non-Anthropic model on OpenRouter', async () => {
    for (const model of ['openai/gpt-4o', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct']) {
      mocks.create.mockReset();
      const body = await bodyFor(OPENROUTER, req(model, 'app-sid'));
      expect(body, model).not.toHaveProperty('cache_control');
    }
  });

  it('does not add it on OpenAI itself or any other base URL, even with an anthropic-looking model', async () => {
    for (const baseURL of [undefined, 'https://api.openai.com/v1', 'https://litellm.example.com/v1',
      'https://openrouter.ai.evil.example.com/v1']) {
      mocks.create.mockReset();
      const body = await bodyFor(baseURL, req('anthropic/claude-haiku-4.5', 'app-sid'));
      expect(body, String(baseURL)).not.toHaveProperty('cache_control');
    }
  });

  it('recognises OpenRouter base URLs with or without a path or port', async () => {
    for (const baseURL of ['https://openrouter.ai/api/v1', 'https://openrouter.ai', 'https://OpenRouter.ai/api/v1/']) {
      mocks.create.mockReset();
      const body = await bodyFor(baseURL, req('anthropic/claude-haiku-4.5', 'app-sid'));
      expect(body.cache_control, baseURL).toEqual({ type: 'ephemeral' });
    }
  });
});
