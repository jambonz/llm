import type { Mock } from 'vitest';
import { groqFactory } from '../../../src/adapters/groq/index.js';
import type { AuthKind, AuthSpec } from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';
import { makeMockStream } from '../openai/_mock-openai.js';

export interface GroqMockSpies {
  create: Mock;
  modelsList: Mock;
}

export function createGroqHarness(mocks: GroqMockSpies): ContractHarness {
  let lastRequestBody: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.create.mockReset();
    mocks.modelsList.mockReset();

    mocks.create.mockImplementation(
      async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
        lastRequestBody = body;
        if (options?.signal?.aborted) {
          const err = new Error('Request aborted.');
          err.name = 'APIUserAbortError';
          throw err;
        }
        return makeMockStream(scenario, options?.signal);
      },
    );

    mocks.modelsList.mockResolvedValue({
      data: [
        { id: 'llama-3.3-70b-versatile', object: 'model' },
        { id: 'llama-3.1-8b-instant', object: 'model' },
        { id: 'gemma2-9b-it', object: 'model' },
      ],
    });
  }

  return {
    vendor: 'groq',
    factory: groqFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'apiKey') return { kind: 'apiKey', apiKey: 'gsk-test' };
      throw new Error(`Groq harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: {
      kind: 'bedrockIam',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      region: 'us-east-1',
    },
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
    toolCapableModel: 'llama-3.3-70b-versatile',
    nonToolCapableModel: null,
    emitsToolCallStart: true,
  };
}
