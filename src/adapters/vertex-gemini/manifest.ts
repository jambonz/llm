import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known Gemini models available on Vertex AI.
 *
 * Vertex-hosted Gemini models often use the `-001` / `-002` versioning
 * suffix (vs AI Studio's bare id). We list both conventions so the admin-UI
 * dropdown covers common deployments.
 */
const VERTEX_GEMINI_KNOWN_MODELS: ModelInfo[] = [
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

export const vertexGeminiManifest: AdapterManifest = {
  vendor: 'vertex-gemini',
  displayName: 'Vertex AI — Gemini',
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
            { value: 'us-east1', label: 'us-east1' },
            { value: 'us-east4', label: 'us-east4' },
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
  knownModels: VERTEX_GEMINI_KNOWN_MODELS,
  supportsModelListing: true,
  docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs',
};
