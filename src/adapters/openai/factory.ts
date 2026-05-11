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

/**
 * Baseten alias factory. Wraps the OpenAI adapter but advertises itself as
 * `baseten` and ships a Baseten-specific manifest (different default
 * `baseURL`, different known models, different docsUrl).
 *
 * Baseten exposes two OpenAI-compatible surfaces:
 *   - Model APIs (default): `https://inference.baseten.co/v1` — shared,
 *     curated catalog (DeepSeek, GLM, Kimi, GPT-OSS, etc.). `/v1/models`
 *     returns the live catalog.
 *   - Bridge / Direct: `https://bridge.baseten.co/v1/direct` — routes to a
 *     user's dedicated deployment. Users override `baseURL` for this case.
 *
 * Consumers call `createLlm({vendor: 'baseten', auth: {kind: 'apiKey', apiKey}})`
 * and get the OpenAI wire adapter pointed at the Baseten endpoint.
 */
const basetenManifest: AdapterManifest = {
  vendor: 'baseten',
  displayName: 'Baseten',
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
          help: 'Get an API key from https://app.baseten.co/settings/api_keys',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://inference.baseten.co/v1',
          help: 'Defaults to Baseten Model APIs. Set to https://bridge.baseten.co/v1/direct to route to a dedicated deployment.',
        },
      ],
    },
  ],
  knownModels: [
    {
      id: 'deepseek-ai/DeepSeek-V3.1',
      displayName: 'DeepSeek V3.1',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 164_000,
      },
    },
    {
      id: 'deepseek-ai/DeepSeek-V4-Pro',
      displayName: 'DeepSeek V4 Pro',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 131_000,
      },
    },
    {
      id: 'zai-org/GLM-4.7',
      displayName: 'GLM 4.7',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 200_000,
      },
    },
    {
      id: 'zai-org/GLM-5',
      displayName: 'GLM 5',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 203_000,
      },
    },
    {
      id: 'moonshotai/Kimi-K2.5',
      displayName: 'Kimi K2.5',
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        systemPrompt: true,
        maxContextTokens: 262_000,
      },
    },
    {
      id: 'moonshotai/Kimi-K2.6',
      displayName: 'Kimi K2.6',
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        systemPrompt: true,
        maxContextTokens: 262_000,
      },
    },
    {
      id: 'MiniMaxAI/MiniMax-M2.5',
      displayName: 'MiniMax M2.5',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 204_000,
      },
    },
    {
      id: 'nvidia/Nemotron-120B-A12B',
      displayName: 'Nemotron Super 120B',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 203_000,
      },
    },
    {
      id: 'openai/gpt-oss-120b',
      displayName: 'GPT-OSS 120B',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 128_000,
      },
    },
  ],
  supportsModelListing: true,
  docsUrl: 'https://docs.baseten.co/inference/model-apis/overview',
};

class BasetenAdapter extends OpenAIAdapter {
  readonly vendor = basetenManifest.vendor;

  override init(auth: ApiKeyAuth, client?: Parameters<OpenAIAdapter['init']>[1]): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://inference.baseten.co/v1',
      },
      client,
    );
  }
}

export const basetenFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: basetenManifest.vendor,
  manifest: basetenManifest,
  create: () => new BasetenAdapter(),
};
