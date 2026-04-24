import { afterAll, afterEach, beforeAll } from 'vitest';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from '@aws-sdk/client-bedrock';
import { mockClient } from 'aws-sdk-client-mock';
import { runContractTests } from '../../../src/test-kit/index.js';
import { createBedrockHarness } from './_mock-bedrock.js';

const bedrockMock = mockClient(BedrockRuntimeClient);
// testCredential uses the control-plane client. Stub ListFoundationModels
// once so adapter.testCredential() resolves without hitting real AWS.
const bedrockControlMock = mockClient(BedrockClient);
bedrockControlMock
  .on(ListFoundationModelsCommand)
  .resolves({ modelSummaries: [] });

beforeAll(() => {
  bedrockMock.reset();
});

afterEach(() => {
  bedrockMock.reset();
  bedrockControlMock.reset();
  bedrockControlMock
    .on(ListFoundationModelsCommand)
    .resolves({ modelSummaries: [] });
});

afterAll(() => {
  bedrockMock.restore();
  bedrockControlMock.restore();
});

runContractTests(createBedrockHarness(bedrockMock));
