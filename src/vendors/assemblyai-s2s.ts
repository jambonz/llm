import type { AdapterManifest } from '../types.js';

/**
 * AssemblyAI voice agent for the llm verb (speech-to-speech). Stored as `{api_key}`.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const assemblyaiS2sManifest: AdapterManifest = {
  vendor: 'assemblyai_s2s',
  displayName: 'AssemblyAI Voice Agent',
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
          help: 'An AssemblyAI API key (assemblyai.com dashboard: API Keys).',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://www.assemblyai.com/docs',
  credentialOnly: true,
  category: 's2s',
};
