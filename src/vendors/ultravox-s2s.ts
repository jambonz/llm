import type { AdapterManifest } from '../types.js';

/**
 * Ultravox for the llm verb (speech-to-speech). Its own credential, like
 * `openai_s2s`: someone adds it on purpose for Ultravox.
 *
 * Credential-only: feature-server creates the Ultravox call and runs the
 * session itself (through the media server). Stored as `{api_key}`; the llm
 * verb reads it when the verb names no `auth`.
 */
export const ultravoxS2sManifest: AdapterManifest = {
  vendor: 'ultravox_s2s',
  displayName: 'Ultravox',
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
          help: 'An Ultravox API key (Ultravox console: Settings, API keys).',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://docs.ultravox.ai/apps/websockets',
  credentialOnly: true,
  category: 's2s',
};
