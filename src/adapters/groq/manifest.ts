import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Curated production-recommended Groq models. The live `/openai/v1/models`
 * endpoint returns the full catalog (which churns frequently); this list
 * seeds the admin-UI dropdown and capability flags.
 *
 * All entries here are tool-capable — Groq's catalog also includes
 * vision-only and safety-classifier models that we deliberately exclude
 * from the curated set because they don't make sense as the primary LLM
 * for a voice agent.
 */
const GROQ_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B Versatile (Groq)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'llama-3.1-8b-instant',
    displayName: 'Llama 3.1 8B Instant (Groq)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'gemma2-9b-it',
    displayName: 'Gemma 2 9B (Groq)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 8_192,
    },
  },
];

export const groqManifest: AdapterManifest = {
  vendor: 'groq',
  displayName: 'Groq',
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
          help: 'Get an API key from https://console.groq.com/keys.',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.groq.com/openai/v1',
          help:
            'Override only for proxies. Default points at Groq\'s production endpoint.',
        },
      ],
    },
  ],
  knownModels: GROQ_KNOWN_MODELS,
  // Groq exposes /openai/v1/models with the same auth as chat completions.
  supportsModelListing: true,
  docsUrl: 'https://console.groq.com/docs/api-reference',
};
