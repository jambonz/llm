import type { Mock } from 'vitest';
import { openRouterFactory } from '../../../src/adapters/openrouter/index.js';
import type { AuthKind, AuthSpec } from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';
import { makeMockStream } from '../openai/_mock-openai.js';

export interface OpenRouterMockSpies {
  create: Mock;
  modelsList: Mock;
  get: Mock;
}

export function createOpenRouterHarness(mocks: OpenRouterMockSpies): ContractHarness {
  let lastRequestBody: Record<string, unknown> | null = null;

  function programMock(scenario: ContractScenario): void {
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
    mocks.get.mockReset();

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
        { id: 'anthropic/claude-haiku-5.5', object: 'model' },
        { id: 'meta-llama/llama-3.3-70b-instruct', object: 'model' },
        { id: 'qwen/qwen3-32b', object: 'model', supported_parameters: ['tools'] },
      ],
    });
    // GET /key — OpenRouter's authenticated credential probe.
    mocks.get.mockResolvedValue({ data: { label: 'test' } });
  }

  return {
    vendor: 'openrouter',
    factory: openRouterFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'apiKey') return { kind: 'apiKey', apiKey: 'sk-or-v1-test' };
      throw new Error(`OpenRouter harness does not provide auth for kind '${kind}'`);
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
      mocks.get.mockReset();
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
    toolCapableModel: 'meta-llama/llama-3.3-70b-instruct',
    nonToolCapableModel: null,
    emitsToolCallStart: true,
  };
}
