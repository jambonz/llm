import type { Mock } from 'vitest';
import { vertexGeminiFactory } from '../../../src/adapters/vertex-gemini/index.js';
import type { AuthKind, AuthSpec, ServiceAccountJson } from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';
import { makeMockStream } from '../google/_mock-google.js';

export interface VertexGeminiMockSpies {
  generateContentStream: Mock;
  modelsList: Mock;
}

const TEST_SERVICE_KEY: ServiceAccountJson = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'test-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  client_email: 'svc@test-project.iam.gserviceaccount.com',
  client_id: '0',
};

export function createVertexGeminiHarness(mocks: VertexGeminiMockSpies): ContractHarness {
  let lastRequestArg: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();

    mocks.generateContentStream.mockImplementation(async (arg: Record<string, unknown>) => {
      lastRequestArg = arg;
      const signal = (arg.config as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
      if (signal?.aborted) {
        const err = new Error('Request aborted.');
        err.name = 'AbortError';
        throw err;
      }
      return makeMockStream(scenario, signal);
    });

    mocks.modelsList.mockImplementation(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' };
        yield { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' };
      },
    }));
  }

  return {
    vendor: 'vertex-gemini',
    factory: vertexGeminiFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'vertexServiceAccount') {
        return {
          kind: 'vertexServiceAccount',
          credentials: TEST_SERVICE_KEY,
          projectId: 'test-project',
          location: 'us-central1',
        };
      }
      throw new Error(`Vertex-Gemini harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: { kind: 'apiKey', apiKey: 'sk-test' },
    mockScenario(scenario) {
      lastRequestArg = null;
      programMock(scenario);
    },
    cleanup() {
      mocks.generateContentStream.mockReset();
      mocks.modelsList.mockReset();
      lastRequestArg = null;
    },
    getCapturedRequest(): CapturedRequest | null {
      if (!lastRequestArg) return null;
      const contents = (lastRequestArg.contents as Array<Record<string, unknown>>) ?? [];
      const vendorRawHonored = contents.some((c) => {
        const parts = c.parts as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(parts)) return false;
        return parts.some((p) => 'functionCall' in p || 'functionResponse' in p);
      });
      const result: CapturedRequest = {
        messageCount: contents.length,
        vendorRawHonored,
      };
      const sys = (lastRequestArg.config as { systemInstruction?: { parts?: Array<{ text?: string }> } } | undefined)
        ?.systemInstruction;
      if (sys && Array.isArray(sys.parts)) {
        const text = sys.parts.map((p) => p.text ?? '').join('');
        if (text) result.system = text;
      }
      return result;
    },
    toolCapableModel: 'gemini-2.5-flash',
    nonToolCapableModel: null,
    emitsToolCallStart: true,
  };
}
