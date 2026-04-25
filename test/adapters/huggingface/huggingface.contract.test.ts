import { vi } from 'vitest';

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

import { runContractTests } from '../../../src/test-kit/index.js';
import { createHuggingfaceHarness } from './_mock-huggingface.js';

runContractTests(createHuggingfaceHarness(mocks));
