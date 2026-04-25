import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Curated HuggingFace Inference Providers `knownModels`.
 *
 * Keyed by canonical HF model id (`<org>/<model>`). Customers can append a
 * `:provider-name` (`:fireworks-ai`, `:cerebras`, `:nebius`, etc.) or
 * `:fastest` suffix at request time to influence routing — those suffixed
 * variants are NOT enumerated here because the suffixed id is just a
 * routing hint, not a different model. The library's
 * `defaultCapabilitiesForUnknown` returns sensible defaults for any
 * suffixed id the heuristic doesn't recognize.
 *
 * The full live catalog is available via `listAvailableModels()` against
 * `/v1/models` — this list seeds the admin-UI dropdown with the most
 * common picks.
 */
const HF_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    displayName: 'Llama 3.3 70B Instruct (HF Providers)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    displayName: 'Llama 3.1 8B Instruct (HF Providers)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct',
    displayName: 'Qwen 2.5 72B Instruct (HF Providers)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.3',
    displayName: 'Mistral 7B Instruct v0.3 (HF Providers)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 32_000,
    },
  },
  {
    id: 'deepseek-ai/DeepSeek-V3',
    displayName: 'DeepSeek V3 (HF Providers)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 64_000,
    },
  },
];

export const huggingfaceManifest: AdapterManifest = {
  vendor: 'huggingface',
  displayName: 'HuggingFace Inference Providers',
  authKinds: [
    {
      kind: 'apiKey',
      displayName: 'API Key',
      fields: [
        {
          name: 'apiKey',
          label: 'HuggingFace Token',
          type: 'password',
          required: true,
          help:
            'Get a token from https://huggingface.co/settings/tokens (Read scope is sufficient). ' +
            'Inference Providers requires a credit balance — claim the free monthly tier or attach ' +
            'a payment method at https://huggingface.co/billing.',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://router.huggingface.co/v1',
          help: 'Override only for proxies. Default is the HF Providers router endpoint.',
        },
      ],
    },
  ],
  knownModels: HF_KNOWN_MODELS,
  // The HF router exposes /v1/models with the same Bearer auth.
  supportsModelListing: true,
  docsUrl: 'https://huggingface.co/docs/inference-providers',
};
