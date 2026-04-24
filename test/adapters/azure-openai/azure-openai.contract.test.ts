import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('openai', () => {
  class MockAzureOpenAI {
    chat = { completions: { create: mocks.create } };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { AzureOpenAI: MockAzureOpenAI, default: MockAzureOpenAI };
});

import { runContractTests } from '../../../src/test-kit/index.js';
import { createAzureOpenAIHarness } from './_mock-azure-openai.js';

runContractTests(createAzureOpenAIHarness(mocks));
