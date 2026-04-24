import type { Mock } from 'vitest';
import { vertexOpenAIFactory } from '../../../src/adapters/vertex-openai/index.js';
import type {
  AuthKind,
  AuthSpec,
  LlmEvent,
  Message,
  ServiceAccountJson,
} from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';
import { makeMockStream } from '../openai/_mock-openai.js';

export interface VertexOpenAIMockSpies {
  create: Mock;
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

export function createVertexOpenAIHarness(mocks: VertexOpenAIMockSpies): ContractHarness {
  let lastRequestBody: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.create.mockReset();
    mocks.modelsList.mockReset();

    mocks.create.mockImplementation(async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      lastRequestBody = body;
      if (options?.signal?.aborted) {
        const err = new Error('Request aborted.');
        err.name = 'APIUserAbortError';
        throw err;
      }
      return makeMockStream(scenario, options?.signal);
    });

    // The Vertex OpenAI-compatible endpoint doesn't expose /models, but the
    // adapter's listAvailableModels() returns the manifest's curated list —
    // no SDK call is made. We still reset the spy for hygiene.
    mocks.modelsList.mockResolvedValue({ data: [] });
  }

  return {
    vendor: 'vertex-openai',
    factory: vertexOpenAIFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'vertexServiceAccount') {
        return {
          kind: 'vertexServiceAccount',
          credentials: TEST_SERVICE_KEY,
          projectId: 'test-project',
          location: 'us-central1',
        };
      }
      throw new Error(`Vertex-OpenAI harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: { kind: 'apiKey', apiKey: 'sk-test' },
    mockScenario(scenario) {
      lastRequestBody = null;
      programMock(scenario);
    },
    cleanup() {
      mocks.create.mockReset();
      mocks.modelsList.mockReset();
      lastRequestBody = null;
    },
    getCapturedRequest(): CapturedRequest | null {
      if (!lastRequestBody) return null;
      const messages = (lastRequestBody.messages as Array<{ role: string }>) ?? [];
      const systemMsg = messages.find((m) => m.role === 'system') as
        | { role: string; content: string }
        | undefined;
      const nonSystemCount = messages.filter((m) => m.role !== 'system').length;
      const vendorRawHonored = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray((m as unknown as { tool_calls?: unknown[] }).tool_calls),
      );
      const result: CapturedRequest = {
        messageCount: nonSystemCount,
        vendorRawHonored,
      };
      if (systemMsg) result.system = systemMsg.content;
      return result;
    },
    // The manifest advertises 4 third-party models, all tool-capable.
    toolCapableModel: 'mistral-large',
    nonToolCapableModel: null,
    emitsToolCallStart: true,
    buildAssistantWithToolCall(tc: Extract<LlmEvent, { type: 'toolCall' }>): Message {
      const argsString =
        typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments);
      return {
        role: 'assistant',
        content: '',
        vendorRaw: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: argsString },
            },
          ],
        },
      };
    },
  };
}
