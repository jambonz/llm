import { describe, expect, it } from 'vitest';
import { normalizeAuth } from '../../src/normalize-auth.js';

const SERVICE_KEY_JSON = {
  type: 'service_account',
  project_id: 'my-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  client_email: 'svc@my-project.iam.gserviceaccount.com',
};

describe('normalizeAuth', () => {
  describe('openai / anthropic (simple apiKey)', () => {
    it('maps api_key to apiKey', () => {
      expect(normalizeAuth('openai', { api_key: 'sk-xxx' })).toEqual({
        kind: 'apiKey',
        apiKey: 'sk-xxx',
      });
      expect(normalizeAuth('anthropic', { api_key: 'sk-ant' })).toEqual({
        kind: 'apiKey',
        apiKey: 'sk-ant',
      });
    });

    it('passes api_url through as baseURL when set', () => {
      expect(
        normalizeAuth('openai', { api_key: 'sk', api_url: 'https://proxy.example.com/v1' }),
      ).toEqual({
        kind: 'apiKey',
        apiKey: 'sk',
        baseURL: 'https://proxy.example.com/v1',
      });
    });

    it('throws when api_key is missing', () => {
      expect(() => normalizeAuth('openai', {})).toThrowError(/requires 'api_key'/);
    });
  });

  describe('groq', () => {
    it('maps api_key to ApiKeyAuth (no forced baseURL — adapter defaults it)', () => {
      expect(normalizeAuth('groq', { api_key: 'gsk' })).toEqual({
        kind: 'apiKey',
        apiKey: 'gsk',
      });
    });

    it('passes through caller-supplied api_url (for proxy use)', () => {
      expect(
        normalizeAuth('groq', { api_key: 'gsk', api_url: 'https://my-proxy/v1' }),
      ).toEqual({
        kind: 'apiKey',
        apiKey: 'gsk',
        baseURL: 'https://my-proxy/v1',
      });
    });

    it('throws when api_key is missing', () => {
      expect(() => normalizeAuth('groq', {})).toThrowError(/requires 'api_key'/);
    });
  });

  describe('deepseek', () => {
    it('defaults baseURL to deepseek hosted endpoint', () => {
      expect(normalizeAuth('deepseek', { api_key: 'sk' })).toEqual({
        kind: 'apiKey',
        apiKey: 'sk',
        baseURL: 'https://api.deepseek.com/v1',
      });
    });

    it('respects custom api_url for self-hosted', () => {
      expect(
        normalizeAuth('deepseek', { api_key: 'sk', api_url: 'http://localhost:8000/v1' }),
      ).toEqual({
        kind: 'apiKey',
        apiKey: 'sk',
        baseURL: 'http://localhost:8000/v1',
      });
    });
  });

  describe('google', () => {
    it('prefers service_key over api_key when both present', () => {
      const result = normalizeAuth('google', {
        api_key: 'ignored',
        service_key: JSON.stringify(SERVICE_KEY_JSON),
      });
      expect(result).toEqual({
        kind: 'googleServiceAccount',
        credentials: SERVICE_KEY_JSON,
      });
    });

    it('parses service_key when passed as a JSON string', () => {
      const result = normalizeAuth('google', {
        service_key: JSON.stringify(SERVICE_KEY_JSON),
      });
      expect(result).toMatchObject({ kind: 'googleServiceAccount' });
    });

    it('accepts service_key when passed as a parsed object', () => {
      const result = normalizeAuth('google', { service_key: SERVICE_KEY_JSON });
      expect(result).toEqual({
        kind: 'googleServiceAccount',
        credentials: SERVICE_KEY_JSON,
      });
    });

    it('falls back to api_key when no service_key', () => {
      expect(normalizeAuth('google', { api_key: 'AIza-xxx' })).toEqual({
        kind: 'googleApiKey',
        apiKey: 'AIza-xxx',
      });
    });

    it('throws when service_key is malformed JSON', () => {
      expect(() =>
        normalizeAuth('google', { service_key: '{not valid json' }),
      ).toThrowError(/not valid JSON/);
    });

    it('throws when neither api_key nor service_key present', () => {
      expect(() => normalizeAuth('google', {})).toThrowError(
        /requires either 'api_key' or 'service_key'/,
      );
    });
  });

  describe('vertex (all three aliases)', () => {
    for (const vendor of ['vertex', 'vertex-gemini', 'vertex-openai']) {
      it(`${vendor}: maps service_key + location to vertexServiceAccount`, () => {
        const result = normalizeAuth(vendor, {
          service_key: SERVICE_KEY_JSON,
          location: 'us-central1',
        });
        expect(result).toEqual({
          kind: 'vertexServiceAccount',
          credentials: SERVICE_KEY_JSON,
          projectId: 'my-project',
          location: 'us-central1',
        });
      });

      it(`${vendor}: uses explicit project_id over service_key.project_id`, () => {
        const result = normalizeAuth(vendor, {
          service_key: SERVICE_KEY_JSON,
          project_id: 'override-project',
          location: 'us-central1',
        });
        expect(result).toMatchObject({ projectId: 'override-project' });
      });

      it(`${vendor}: throws when service_key missing`, () => {
        expect(() =>
          normalizeAuth(vendor, { location: 'us-central1' }),
        ).toThrowError(/requires 'service_key'/);
      });

      it(`${vendor}: throws when location missing`, () => {
        expect(() =>
          normalizeAuth(vendor, { service_key: SERVICE_KEY_JSON }),
        ).toThrowError(/requires 'location'/);
      });

      it(`${vendor}: throws when project_id missing and service_key has no project_id`, () => {
        const noProject = { ...SERVICE_KEY_JSON };
        delete (noProject as Partial<typeof noProject>).project_id;
        expect(() =>
          normalizeAuth(vendor, { service_key: noProject, location: 'us-central1' }),
        ).toThrowError(/requires 'project_id'/);
      });
    }
  });

  describe('bedrock', () => {
    it('prefers IAM credentials over api_key when both present', () => {
      const result = normalizeAuth('bedrock', {
        access_key_id: 'AKIA',
        secret_access_key: 'secret',
        api_key: 'ignored',
        region: 'us-east-1',
      });
      expect(result).toEqual({
        kind: 'bedrockIam',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      });
    });

    it('includes sessionToken when provided', () => {
      const result = normalizeAuth('bedrock', {
        access_key_id: 'AKIA',
        secret_access_key: 'secret',
        session_token: 'token',
        region: 'us-east-1',
      });
      expect(result).toMatchObject({ kind: 'bedrockIam', sessionToken: 'token' });
    });

    it('uses bedrockApiKey when only api_key + region present', () => {
      expect(
        normalizeAuth('bedrock', { api_key: 'key', region: 'us-east-1' }),
      ).toEqual({
        kind: 'bedrockApiKey',
        apiKey: 'key',
        region: 'us-east-1',
      });
    });

    it('throws when region missing', () => {
      expect(() =>
        normalizeAuth('bedrock', { access_key_id: 'x', secret_access_key: 'y' }),
      ).toThrowError(/requires 'region'/);
    });

    it('throws when neither IAM nor api_key present', () => {
      expect(() => normalizeAuth('bedrock', { region: 'us-east-1' })).toThrowError(
        /requires either \(access_key_id \+ secret_access_key\) or api_key/,
      );
    });
  });

  describe('azure-openai', () => {
    const validRaw = {
      api_key: 'test-key',
      endpoint: 'https://r.openai.azure.com',
      deployment: 'prod',
      api_version: '2024-10-21',
    };

    it('maps all four fields to AzureOpenAIApiKeyAuth', () => {
      const result = normalizeAuth('azure-openai', validRaw);
      expect(result).toEqual({
        kind: 'azureOpenAIApiKey',
        apiKey: 'test-key',
        endpoint: 'https://r.openai.azure.com',
        deployment: 'prod',
        apiVersion: '2024-10-21',
      });
    });

    it.each(['api_key', 'endpoint', 'deployment', 'api_version'] as const)(
      'throws when %s is missing',
      (missing) => {
        const raw = { ...validRaw, [missing]: undefined };
        expect(() => normalizeAuth('azure-openai', raw)).toThrowError(
          new RegExp(missing),
        );
      },
    );
  });

  describe('unknown vendor', () => {
    it('throws a helpful error', () => {
      expect(() => normalizeAuth('unknown-vendor', { api_key: 'x' })).toThrowError(
        /unknown vendor 'unknown-vendor'/,
      );
    });
  });
});
