import { beforeEach, describe, expect, it } from 'vitest';
import { pickAuthKind } from '../../src/pick-auth-kind.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../src/registry.js';
import { anthropicFactory } from '../../src/adapters/anthropic/index.js';
import { azureOpenAIFactory } from '../../src/adapters/azure-openai/index.js';
import { bedrockFactory } from '../../src/adapters/bedrock/index.js';
import { googleFactory } from '../../src/adapters/google/index.js';
import { deepseekFactory, openAIFactory } from '../../src/adapters/openai/index.js';
import { vertexGeminiFactory } from '../../src/adapters/vertex-gemini/index.js';
import { vertexOpenAIFactory } from '../../src/adapters/vertex-openai/index.js';

describe('pickAuthKind', () => {
  // Contract tests reset the registry in their afterEach, which can leave
  // this suite running against an empty registry depending on file order.
  // Re-register before each test so results don't depend on file ordering.
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(openAIFactory);
    registerAdapter(deepseekFactory);
    registerAdapter(anthropicFactory);
    registerAdapter(googleFactory);
    registerAdapter(vertexGeminiFactory);
    registerAdapter(vertexOpenAIFactory);
    registerAdapter(bedrockFactory);
    registerAdapter(azureOpenAIFactory);
  });

  describe('single-authKind vendors return that kind unconditionally', () => {
    it('openai returns apiKey regardless of body', () => {
      const kind = pickAuthKind('openai', { api_key: 'x' });
      expect(kind.kind).toBe('apiKey');
    });

    it('anthropic returns apiKey', () => {
      const kind = pickAuthKind('anthropic', { api_key: 'x' });
      expect(kind.kind).toBe('apiKey');
    });

    it('deepseek returns apiKey', () => {
      const kind = pickAuthKind('deepseek', { api_key: 'x' });
      expect(kind.kind).toBe('apiKey');
    });

    it('vertex-gemini returns vertexServiceAccount', () => {
      const kind = pickAuthKind('vertex-gemini', {});
      expect(kind.kind).toBe('vertexServiceAccount');
    });

    it('vertex-openai returns vertexServiceAccount', () => {
      const kind = pickAuthKind('vertex-openai', {});
      expect(kind.kind).toBe('vertexServiceAccount');
    });

    it('azure-openai returns azureOpenAIApiKey', () => {
      const kind = pickAuthKind('azure-openai', { api_key: 'x' });
      expect(kind.kind).toBe('azureOpenAIApiKey');
    });
  });

  describe('bedrock discriminates by presence of access_key_id + secret_access_key', () => {
    it('returns bedrockIam when both IAM fields are present', () => {
      const kind = pickAuthKind('bedrock', {
        access_key_id: 'AKIA',
        secret_access_key: 'secret',
        region: 'us-east-1',
      });
      expect(kind.kind).toBe('bedrockIam');
    });

    it('returns bedrockApiKey when only api_key is present', () => {
      const kind = pickAuthKind('bedrock', {
        api_key: 'bedrock-key',
        region: 'us-east-1',
      });
      expect(kind.kind).toBe('bedrockApiKey');
    });

    it('throws when neither IAM pair nor api_key is present', () => {
      expect(() => pickAuthKind('bedrock', { region: 'us-east-1' })).toThrowError(
        /missing both 'api_key' and/,
      );
    });
  });

  describe('google (single authKind today)', () => {
    // Google's manifest currently declares only `googleApiKey`. If/when
    // `googleServiceAccount` gets added as a second authKind, extend these
    // tests to cover the discriminator branch in pick-auth-kind.ts.
    it('returns googleApiKey for any body (single-authKind short-circuit)', () => {
      expect(pickAuthKind('google', { api_key: 'g-key' }).kind).toBe('googleApiKey');
      expect(pickAuthKind('google', {}).kind).toBe('googleApiKey');
    });
  });

  describe('unknown vendors', () => {
    it('throws when vendor is not registered', () => {
      expect(() => pickAuthKind('does-not-exist', {})).toThrow();
    });
  });
});
