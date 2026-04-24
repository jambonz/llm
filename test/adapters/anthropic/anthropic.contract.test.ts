import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mocks.create };
    models = { list: mocks.modelsList };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { default: MockAnthropic };
});

import { runContractTests } from '../../../src/test-kit/index.js';
import { createAnthropicHarness } from './_mock-anthropic.js';

runContractTests(createAnthropicHarness(mocks));
