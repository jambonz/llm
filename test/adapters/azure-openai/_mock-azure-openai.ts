import type { Mock } from 'vitest';
import { azureOpenAIFactory } from '../../../src/adapters/azure-openai/index.js';
import type { AuthKind, AuthSpec } from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';
import { makeMockStream } from '../openai/_mock-openai.js';

export interface AzureOpenAIMockSpies {
  create: Mock;
}

export function createAzureOpenAIHarness(mocks: AzureOpenAIMockSpies): ContractHarness {
  let lastRequestBody: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.create.mockReset();

    mocks.create.mockImplementation(
      async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
        lastRequestBody = body;
        if (options?.signal?.aborted) {
          const err = new Error('Request aborted.');
          err.name = 'APIUserAbortError';
          throw err;
        }
        // testCredential() calls with stream:false and expects a ChatCompletion
        // (not an async iterable). Other scenarios are streaming.
        if (body.stream === false) {
          return {
            id: 'chatcmpl-probe',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'pong' },
                finish_reason: 'stop',
              },
            ],
          };
        }
        return makeMockStream(scenario, options?.signal);
      },
    );
  }

  return {
    vendor: 'azure-openai',
    factory: azureOpenAIFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'azureOpenAIApiKey') {
        return {
          kind: 'azureOpenAIApiKey',
          apiKey: 'test-key',
          endpoint: 'https://test-resource.openai.azure.com',
          deployment: 'prod-gpt-4o',
          apiVersion: '2024-10-21',
        };
      }
      throw new Error(`Azure OpenAI harness does not provide auth for kind '${kind}'`);
    },
    unsupportedAuth: { kind: 'apiKey', apiKey: 'sk-test' },
    mockScenario(scenario) {
      lastRequestBody = null;
      programMock(scenario);
    },
    cleanup() {
      mocks.create.mockReset();
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
    toolCapableModel: 'gpt-4o',
    nonToolCapableModel: 'o1-preview',
    emitsToolCallStart: true,
  };
}
