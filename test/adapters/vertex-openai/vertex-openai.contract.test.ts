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

vi.mock('google-auth-library', () => {
  class MockGoogleAuth {
    constructor(_opts: unknown) {
      // no-op
    }
    async getClient() {
      return {
        async getAccessToken() {
          return { token: 'mock-bearer-token' };
        },
      };
    }
  }
  return { GoogleAuth: MockGoogleAuth };
});

import { runContractTests } from '../../../src/test-kit/index.js';
import { createVertexOpenAIHarness } from './_mock-vertex-openai.js';

runContractTests(createVertexOpenAIHarness(mocks));
