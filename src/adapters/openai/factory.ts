import type { AdapterFactory, AdapterManifest, ApiKeyAuth } from '../../types.js';
import { OpenAIAdapter } from './adapter.js';
import { openAIManifest } from './manifest.js';

export const openAIFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: openAIManifest.vendor,
  manifest: openAIManifest,
  create: () => new OpenAIAdapter(),
};

/**
 * DeepSeek alias factory. Wraps the OpenAI adapter but advertises itself as
 * `deepseek` and ships a DeepSeek-specific manifest (different default
 * `baseURL`, different known models, different docsUrl).
 *
 * Consumers call `createLlm({vendor: 'deepseek', auth: {kind: 'apiKey', apiKey}})`
 * and get the OpenAI wire adapter pointed at the DeepSeek endpoint.
 */
const deepseekManifest: AdapterManifest = {
  vendor: 'deepseek',
  displayName: 'DeepSeek',
  authKinds: [
    {
      kind: 'apiKey',
      displayName: 'API Key',
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          help: 'Get an API key from https://platform.deepseek.com/api_keys',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.deepseek.com/v1',
          help: 'Override for self-hosted DeepSeek or proxy endpoints.',
        },
      ],
    },
  ],
  knownModels: [
    {
      id: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 1_000_000,
      },
    },
    {
      id: 'deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 1_000_000,
      },
    },
    {
      id: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 64_000,
      },
      deprecated: true,
    },
    {
      id: 'deepseek-reasoner',
      displayName: 'DeepSeek Reasoner',
      capabilities: {
        streaming: true,
        tools: false,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 64_000,
      },
      deprecated: true,
    },
  ],
  supportsModelListing: true,
  docsUrl: 'https://api-docs.deepseek.com/',
};

class DeepSeekAdapter extends OpenAIAdapter {
  readonly vendor = deepseekManifest.vendor;

  override init(auth: ApiKeyAuth, client?: Parameters<OpenAIAdapter['init']>[1]): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://api.deepseek.com/v1',
      },
      client,
    );
  }
}

export const deepseekFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: deepseekManifest.vendor,
  manifest: deepseekManifest,
  create: () => new DeepSeekAdapter(),
};
