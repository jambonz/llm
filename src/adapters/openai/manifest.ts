import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known OpenAI models with capability flags.
 *
 * Model listing via `listAvailableModels()` hits the live `/v1/models` endpoint,
 * so this curated list is for the admin-UI dropdown and for capability
 * validation (e.g., rejecting tools on reasoning-only models).
 */
const OPENAI_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 16_385,
    },
  },
  {
    id: 'o1-preview',
    displayName: 'o1 preview (reasoning)',
    capabilities: {
      streaming: false,
      tools: false,
      vision: false,
      systemPrompt: false,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'o1-mini',
    displayName: 'o1 mini (reasoning)',
    capabilities: {
      streaming: false,
      tools: false,
      vision: false,
      systemPrompt: false,
      maxContextTokens: 128_000,
    },
  },
];

export const openAIManifest: AdapterManifest = {
  vendor: 'openai',
  displayName: 'OpenAI',
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
          help: 'Get an API key from https://platform.openai.com/api-keys',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.openai.com/v1',
          help: 'Override for OpenAI-compatible endpoints (LM Studio, Ollama, vLLM, proxies).',
        },
      ],
    },
  ],
  knownModels: OPENAI_KNOWN_MODELS,
  supportsModelListing: true,
  docsUrl: 'https://platform.openai.com/docs/api-reference',
};
