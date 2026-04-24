import { afterAll, afterEach, beforeAll } from 'vitest';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { runContractTests } from '../../../src/test-kit/index.js';
import { createBedrockHarness } from './_mock-bedrock.js';

const bedrockMock = mockClient(BedrockRuntimeClient);

beforeAll(() => {
  bedrockMock.reset();
});

afterEach(() => {
  bedrockMock.reset();
});

afterAll(() => {
  bedrockMock.restore();
});

runContractTests(createBedrockHarness(bedrockMock));
