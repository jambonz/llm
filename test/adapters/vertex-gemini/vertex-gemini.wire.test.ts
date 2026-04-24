import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructorSpy: vi.fn(),
  generateContentStream: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContentStream: mocks.generateContentStream,
      list: mocks.modelsList,
    };
    constructor(opts: unknown) {
      mocks.constructorSpy(opts);
    }
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { vertexGeminiFactory } from '../../../src/adapters/vertex-gemini/index.js';
import type { ServiceAccountJson } from '../../../src/types.js';

const SERVICE_KEY: ServiceAccountJson = {
  type: 'service_account',
  project_id: 'test-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  client_email: 'svc@test-project.iam.gserviceaccount.com',
};

describe('VertexGeminiAdapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(vertexGeminiFactory);
    mocks.constructorSpy.mockReset();
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.constructorSpy.mockReset();
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();
  });

  it('constructs GoogleGenAI in Vertex mode with project/location/service-account credentials', async () => {
    await createLlm({
      vendor: 'vertex-gemini',
      auth: {
        kind: 'vertexServiceAccount',
        credentials: SERVICE_KEY,
        projectId: 'my-gcp-project',
        location: 'europe-west4',
      },
    });
    expect(mocks.constructorSpy).toHaveBeenCalledOnce();
    const [opts] = mocks.constructorSpy.mock.calls[0]!;
    expect(opts).toMatchObject({
      vertexai: true,
      project: 'my-gcp-project',
      location: 'europe-west4',
      googleAuthOptions: { credentials: SERVICE_KEY },
    });
  });

  it('rejects missing projectId', async () => {
    await expect(
      createLlm({
        vendor: 'vertex-gemini',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: '',
          location: 'us-central1',
        },
      }),
    ).rejects.toThrowError(/projectId is required/);
  });

  it('rejects missing location', async () => {
    await expect(
      createLlm({
        vendor: 'vertex-gemini',
        auth: {
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY,
          projectId: 'p',
          location: '',
        },
      }),
    ).rejects.toThrowError(/location is required/);
  });

  it('rejects non-vertex auth kinds', async () => {
    await expect(
      createLlm({
        vendor: 'vertex-gemini',
        auth: { kind: 'apiKey', apiKey: 'x' },
      }),
    ).rejects.toThrow();
  });
});
