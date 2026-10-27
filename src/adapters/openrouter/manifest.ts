import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Curated OpenRouter models for the admin-UI dropdown: fast, tool-capable
 * models that suit a voice agent. OpenRouter's live catalog (~450 models,
 * churning weekly) is returned by `listAvailableModels()` with capability
 * flags taken from its own `/models` metadata, so any model id works — this
 * list only seeds the dropdown.
 */
const OPENROUTER_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'anthropic/claude-haiku-5.5',
    displayName: 'Claude Haiku 5.5 (OpenRouter)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    displayName: 'Claude Sonnet 5.5 (OpenRouter)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
  {
    id: 'openai/gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini (OpenRouter)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 400_000,
    },
  },
  {
    id: 'openai/gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini (OpenRouter)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_047_576,
    },
  },
  {
    id: 'google/gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash (OpenRouter)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_048_576,
    },
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    displayName: 'Llama 3.3 70B Instruct (OpenRouter)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 131_072,
    },
  },
];

export const openRouterManifest: AdapterManifest = {
  vendor: 'openrouter',
  displayName: 'OpenRouter',
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
          help: 'Get an API key from https://openrouter.ai/settings/keys',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://openrouter.ai/api/v1',
          help: 'Override only for proxies. Default points at OpenRouter\'s production endpoint.',
        },
      ],
    },
  ],
  knownModels: OPENROUTER_KNOWN_MODELS,
  // /models is public; the adapter enriches it with OpenRouter's own capability metadata.
  supportsModelListing: true,
  docsUrl: 'https://openrouter.ai/docs/api_reference/overview',
};
