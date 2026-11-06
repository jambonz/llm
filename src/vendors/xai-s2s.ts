import type { AdapterManifest } from '../types.js';

/**
 * xAI Grok voice agent for the llm verb (speech-to-speech). Stored as `{api_key}`.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const xaiS2sManifest: AdapterManifest = {
  vendor: 'xai_s2s',
  displayName: 'xAI Grok Voice',
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
          help: 'An xAI API key (console.x.ai: API Keys).',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://docs.x.ai/docs/guides/voice/agent',
  credentialOnly: true,
  category: 's2s',
};
