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
          options: [
            { value: 'us-central1', label: 'us-central1' },
            { value: 'us-east4', label: 'us-east4' },
            { value: 'europe-west1', label: 'europe-west1' },
            { value: 'europe-west4', label: 'europe-west4' },
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
