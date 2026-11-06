import type { AdapterManifest } from '../types.js';

/**
 * Google Gemini Live for the llm verb (speech-to-speech), on the Gemini
 * Developer API (an API key) or on Vertex AI (a service account). Stored as
 * `{api_key}`, or `{service_key, project_id, location}`.
 *
 * Vertex takes only short-lived OAuth tokens, so feature-server mints one from
 * the service account when a session starts.
 */
export const googleS2sManifest: AdapterManifest = {
  vendor: 'google_s2s',
  displayName: 'Google Gemini Live',
  authKinds: [
    {
      kind: 'googleApiKey',
      displayName: 'API Key (Gemini Developer API)',
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          help: 'A Gemini API key from https://aistudio.google.com/apikey',
        },
      ],
    },
    {
      kind: 'vertexServiceAccount',
      displayName: 'Service Account JSON (Vertex AI)',
      fields: [
        {
          name: 'credentials',
          label: 'Service Account Key (JSON)',
          type: 'json-file',
          required: true,
          help: 'The key of a service account with the Vertex AI User role in the project.',
        },
        {
          name: 'projectId',
          label: 'Project ID',
          type: 'text',
          required: false,
          help: "The Google Cloud project to run in. Empty: the service account's own project.",
        },
        {
          name: 'location',
          label: 'Region',
          type: 'text',
          required: true,
          default: 'us-central1',
          help: 'A Vertex AI region that serves the Gemini Live API, e.g. us-central1.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://ai.google.dev/gemini-api/docs/live',
  credentialOnly: true,
  category: 's2s',
};
