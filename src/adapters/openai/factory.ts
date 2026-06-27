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

  protected override knownModels() {
    return deepseekManifest.knownModels;
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
        maxContextTokens: 163_840,
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
        maxContextTokens: 131_072,
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
        maxContextTokens: 202_800,
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
      displayName: 'Nemotron Super',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 202_800,
      },
    },
    {
      id: 'openai/gpt-oss-120b',
      displayName: 'OpenAI GPT 120B',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 128_072,
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

  protected override knownModels() {
    return basetenManifest.knownModels;
  }
}

export const basetenFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: basetenManifest.vendor,
  manifest: basetenManifest,
  create: () => new BasetenAdapter(),
};

/**
 * Moonshot (Kimi) alias factory. Moonshot exposes an OpenAI-compatible
 * Chat Completions surface; the only differences from OpenAI are the default
 * `baseURL` and the model catalog.
 *
 * Note: Moonshot serves a global endpoint (`api.moonshot.ai`) and a China
 * endpoint (`api.moonshot.cn`). We default to the global one; users override
 * `baseURL` for `.cn`. Moonshot only accepts the `tools` calling format (the
 * deprecated `functions` param is unsupported), which is what we already emit.
 *
 * Consumers call `createLlm({vendor: 'moonshot', auth: {kind: 'apiKey', apiKey}})`.
 */
const moonshotManifest: AdapterManifest = {
  vendor: 'moonshot',
  displayName: 'Moonshot (Kimi)',
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
          help: 'Get an API key from https://platform.moonshot.ai/console/api-keys',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.moonshot.ai/v1',
          help: 'Defaults to the global endpoint. Set to https://api.moonshot.cn/v1 for the China endpoint.',
        },
      ],
    },
  ],
  knownModels: [
    {
      id: 'kimi-k2.6',
      displayName: 'Kimi K2.6',
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        systemPrompt: true,
        maxContextTokens: 262_144,
      },
    },
    {
      id: 'kimi-k2.5',
      displayName: 'Kimi K2.5',
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        systemPrompt: true,
        maxContextTokens: 262_144,
      },
    },
  ],
  supportsModelListing: true,
  docsUrl: 'https://platform.moonshot.ai/docs',
};

class MoonshotAdapter extends OpenAIAdapter {
  readonly vendor = moonshotManifest.vendor;

  override init(auth: ApiKeyAuth, client?: Parameters<OpenAIAdapter['init']>[1]): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://api.moonshot.ai/v1',
      },
      client,
    );
  }

  protected override knownModels() {
    return moonshotManifest.knownModels;
  }
}

export const moonshotFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: moonshotManifest.vendor,
  manifest: moonshotManifest,
  create: () => new MoonshotAdapter(),
};

/**
 * Z.ai (GLM) alias factory. Z.ai's `/api/paas/v4` surface is OpenAI-compatible
 * for chat completions (it accepts the OpenAI request shape and is what the
 * OpenAI SDK should target as its baseURL). Note there is NO OpenAI-style
 * `/models` listing endpoint, so `supportsModelListing` is false and we serve
 * the static known-models list.
 *
 * Note: Coding-Plan subscriptions are served from a *different* endpoint
 * (`https://api.z.ai/api/coding/paas/v4`), not the general one. Users on a
 * Coding Plan must override `baseURL` accordingly.
 *
 * Consumers call `createLlm({vendor: 'zai', auth: {kind: 'apiKey', apiKey}})`.
 */
const zaiManifest: AdapterManifest = {
  vendor: 'zai',
  displayName: 'Z.ai (GLM)',
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
          help: 'Get an API key from https://z.ai/manage-apikey/apikey-list',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.z.ai/api/paas/v4',
          help: 'Defaults to the general API. Coding-Plan keys must use https://api.z.ai/api/coding/paas/v4.',
        },
      ],
    },
  ],
  knownModels: [
    {
      id: 'glm-5.2',
      displayName: 'GLM-5.2',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 1_000_000,
      },
    },
    {
      id: 'glm-4.7',
      displayName: 'GLM-4.7',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 200_000,
      },
    },
  ],
  supportsModelListing: false,
  docsUrl: 'https://docs.z.ai/',
};

class ZaiAdapter extends OpenAIAdapter {
  readonly vendor = zaiManifest.vendor;

  override init(auth: ApiKeyAuth, client?: Parameters<OpenAIAdapter['init']>[1]): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://api.z.ai/api/paas/v4',
      },
      client,
    );
  }

  protected override knownModels() {
    return zaiManifest.knownModels;
  }
}

export const zaiFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: zaiManifest.vendor,
  manifest: zaiManifest,
  create: () => new ZaiAdapter(),
};

/**
 * MiniMax alias factory. MiniMax exposes an OpenAI-compatible Chat Completions
 * surface at `https://api.minimax.io/v1`. Tool calling follows OpenAI's
 * function-calling format.
 *
 * Consumers call `createLlm({vendor: 'minimax', auth: {kind: 'apiKey', apiKey}})`.
 */
const minimaxManifest: AdapterManifest = {
  vendor: 'minimax',
  displayName: 'MiniMax',
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
          help: 'Get an API key from https://platform.minimax.io/user-center/basic-information/interface-key',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.minimax.io/v1',
          help: 'Override for proxies or the China endpoint.',
        },
      ],
    },
  ],
  knownModels: [
    {
      id: 'MiniMax-M3',
      displayName: 'MiniMax-M3',
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        systemPrompt: true,
        maxContextTokens: 1_000_000,
      },
    },
    {
      id: 'MiniMax-M2.5',
      displayName: 'MiniMax-M2.5',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 204_000,
      },
    },
  ],
  supportsModelListing: true,
  docsUrl: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
};

class MiniMaxAdapter extends OpenAIAdapter {
  readonly vendor = minimaxManifest.vendor;

  override init(auth: ApiKeyAuth, client?: Parameters<OpenAIAdapter['init']>[1]): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://api.minimax.io/v1',
      },
      client,
    );
  }

  protected override knownModels() {
    return minimaxManifest.knownModels;
  }
}

export const minimaxFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: minimaxManifest.vendor,
  manifest: minimaxManifest,
  create: () => new MiniMaxAdapter(),
};
