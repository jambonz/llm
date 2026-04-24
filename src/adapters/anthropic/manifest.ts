import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known Claude models. Model listing via `listAvailableModels()` hits
 * Anthropic's live `/v1/models` endpoint; this curated list drives the
 * admin-UI dropdown and capability validation.
 *
 * All Claude models in this list support tools, streaming, system prompts,
 * and vision. There is no reasoning-only / tool-less variant to special-case
 * the way OpenAI's o1 family does.
 */
const ANTHROPIC_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    displayName: 'Claude 3.7 Sonnet',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
];

export const anthropicManifest: AdapterManifest = {
  vendor: 'anthropic',
  displayName: 'Anthropic Claude',
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
          help: 'Get an API key from https://console.anthropic.com/settings/keys',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.anthropic.com',
          help: 'Override for proxies or enterprise deployments.',
        },
      ],
    },
  ],
  knownModels: ANTHROPIC_KNOWN_MODELS,
  supportsModelListing: true,
  docsUrl: 'https://docs.anthropic.com/en/api/overview',
};
