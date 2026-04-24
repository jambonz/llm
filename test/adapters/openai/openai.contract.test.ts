import { vi } from 'vitest';

// Hoisted by vitest so the mock factory (below) can reference these spies.
// `vi.hoisted` ensures this block runs before any imports.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    models = { list: mocks.modelsList };
    constructor(_opts: unknown) {
      // intentionally empty — the mock client has no real config state.
    }
  }
  return { default: MockOpenAI };
});

// Imports come AFTER vi.mock so the mocked openai is picked up by the adapter.
import { runContractTests } from '../../../src/test-kit/index.js';
import { createOpenAIHarness } from './_mock-openai.js';

runContractTests(createOpenAIHarness(mocks));
