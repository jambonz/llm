import type { Mock } from 'vitest';
import { bedrockMantleFactory } from '../../../src/adapters/openai/index.js';
import type { AuthKind, AuthSpec } from '../../../src/types.js';
import type {
  CapturedRequest,
  ContractHarness,
  ContractScenario,
} from '../../../src/test-kit/index.js';
import { makeMockStream } from '../openai/_mock-openai.js';

export interface BedrockMantleMockSpies {
  create: Mock;
  modelsList: Mock;
}

export function createBedrockMantleHarness(mocks: BedrockMantleMockSpies): ContractHarness {
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

    /* shape of a real GET /v1/models response from the Mantle endpoint: dotted
     * ids that carry the upstream provider, plus a per-model status */
    mocks.modelsList.mockResolvedValue({
      data: [
        { id: 'zai.glm-5', object: 'model', status: 'available' },
        { id: 'moonshotai.kimi-k2.5', object: 'model', status: 'available' },
        { id: 'deepseek.v3.2', object: 'model', status: 'available' },
      ],
    });
  }

  return {
    vendor: 'bedrock-mantle',
    factory: bedrockMantleFactory,
    authFor: (kind: AuthKind): AuthSpec => {
      if (kind === 'apiKey') return { kind: 'apiKey', apiKey: 'bedrock-test-key' };
      throw new Error(`Bedrock Mantle harness does not provide auth for kind '${kind}'`);
    },
    /* the native `bedrock` adapter owns IAM/SigV4; the Mantle surface is
     * api-key only, so bedrockIam must be rejected here */
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
    toolCapableModel: 'zai.glm-5',
    nonToolCapableModel: null,
    emitsToolCallStart: true,
  };
}
