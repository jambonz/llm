import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known Gemini models. Model listing via `listAvailableModels()` hits the
 * live endpoint; this curated list drives the admin-UI dropdown.
 *
 * All Gemini models in this list support tools and streaming. Only the
 * `-lite` flash variants lose vision support.
 */
const GOOGLE_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
  {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
  {
    id: 'gemini-2.0-flash-lite',
    displayName: 'Gemini 2.0 Flash Lite',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
  {
    id: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 2_000_000,
    },
  },
  {
    id: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 1_000_000,
    },
  },
];

export const googleManifest: AdapterManifest = {
  vendor: 'google',
  displayName: 'Google Gemini',
  authKinds: [
    {
      kind: 'googleApiKey',
      displayName: 'API Key',
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          help: 'Get an API key from https://aistudio.google.com/apikey',
        },
      ],
    },
  ],
  knownModels: GOOGLE_KNOWN_MODELS,
  supportsModelListing: true,
  docsUrl: 'https://ai.google.dev/gemini-api/docs',
};

