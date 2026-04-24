import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known third-party models available via Vertex AI's OpenAI-compatible
 * endpoint. This is NOT an exhaustive list — Vertex offers many publisher
 * models from Mistral, Meta, AI21, etc. — but it covers the common options
 * so the admin-UI dropdown is useful out of the box.
 */
const VERTEX_OPENAI_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'mistral-large',
    displayName: 'Mistral Large (on Vertex)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'mistral-small',
    displayName: 'Mistral Small (on Vertex)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 32_000,
    },
  },
  {
    id: 'meta/llama-3.3-70b-instruct-maas',
    displayName: 'Llama 3.3 70B Instruct (on Vertex)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'meta/llama-3.1-405b-instruct-maas',
    displayName: 'Llama 3.1 405B Instruct (on Vertex)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
];

export const vertexOpenAIManifest: AdapterManifest = {
  vendor: 'vertex-openai',
  displayName: 'Vertex AI — OpenAI-compatible',
  authKinds: [
    {
      kind: 'vertexServiceAccount',
      displayName: 'Service Account JSON',
      fields: [
        {
          name: 'credentials',
          label: 'Service Account Key (JSON)',
          type: 'json-file',
          required: true,
          help: 'Upload the service account key JSON from Google Cloud Console.',
        },
        {
          name: 'projectId',
          label: 'Project ID',
          type: 'text',
          required: true,
          help: 'GCP project that hosts the Vertex AI deployment.',
        },
        {
          name: 'location',
          label: 'Region',
          type: 'select',
          required: true,
          default: 'us-central1',
          // Same region set as vertex-gemini plus us-east5 (where Google
          // hosts Llama partner models). Partner-model availability varies
          // per region; Google's docs for each model are the source of truth.
          options: [
            { value: 'us-central1', label: 'us-central1' },
            { value: 'us-east1', label: 'us-east1' },
            { value: 'us-east4', label: 'us-east4' },
            { value: 'us-east5', label: 'us-east5' },
            { value: 'us-west1', label: 'us-west1' },
            { value: 'us-west4', label: 'us-west4' },
            { value: 'europe-west1', label: 'europe-west1' },
            { value: 'europe-west2', label: 'europe-west2' },
            { value: 'europe-west3', label: 'europe-west3' },
            { value: 'europe-west4', label: 'europe-west4' },
            { value: 'asia-east1', label: 'asia-east1' },
            { value: 'asia-northeast1', label: 'asia-northeast1' },
            { value: 'asia-southeast1', label: 'asia-southeast1' },
          ],
        },
      ],
    },
  ],
  knownModels: VERTEX_OPENAI_KNOWN_MODELS,
  // The OpenAI-compatible endpoint on Vertex does not expose a /models list.
  supportsModelListing: false,
  docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-openai',
};
