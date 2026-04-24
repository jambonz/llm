import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContentStream: mocks.generateContentStream,
      list: mocks.modelsList,
    };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

import { runContractTests } from '../../../src/test-kit/index.js';
import { createVertexGeminiHarness } from './_mock-vertex-gemini.js';

runContractTests(createVertexGeminiHarness(mocks));
