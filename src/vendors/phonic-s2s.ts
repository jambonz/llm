import type { AdapterManifest } from '../types.js';

/**
 * Phonic speech-to-speech for the llm verb. Stored as `{api_key}`.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const phonicS2sManifest: AdapterManifest = {
  vendor: 'phonic_s2s',
  displayName: 'Phonic',
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
          help: 'A Phonic API key (starts with ph_). Phonic uses the same keys for text-to-speech.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://docs.phonic.ai/docs/get-started/overview',
  credentialOnly: true,
  category: 's2s',
};
