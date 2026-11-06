import type { AdapterManifest } from '../types.js';

/**
 * Azure Voice Live for the llm verb (speech-to-speech). Stored as `{api_key, host}`. API keys
 * only: Entra tokens expire, so they cannot be stored.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const voiceliveS2sManifest: AdapterManifest = {
  vendor: 'voicelive_s2s',
  displayName: 'Azure Voice Live',
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
          help: 'A key of the Azure AI Foundry (AI Services) resource: Keys and Endpoint.',
        },
        {
          name: 'host',
          label: 'Resource host',
          type: 'text',
          required: true,
          help: 'The resource host, e.g. my-resource.services.ai.azure.com. A full endpoint URL is accepted; only the host is used.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://learn.microsoft.com/azure/ai-services/speech-service/voice-live',
  credentialOnly: true,
  category: 's2s',
};
