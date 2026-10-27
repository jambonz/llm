import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
  get: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    models = { list: mocks.modelsList };
    get = mocks.get;
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { default: MockOpenAI };
});

import { runContractTests } from '../../../src/test-kit/index.js';
import { createOpenRouterHarness } from './_mock-openrouter.js';

runContractTests(createOpenRouterHarness(mocks));
