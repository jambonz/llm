import type { AdapterManifest } from '../types.js';

/**
 * OpenAI Realtime for the llm verb (speech-to-speech). Its own credential,
 * separate from the `openai` language-model credential even though OpenAI
 * accepts the same kind of key for both: someone adds it on purpose, and may
 * use a different project or key for Realtime.
 *
 * Credential-only: feature-server runs the Realtime session itself. Stored as
 * `{api_key}`; the llm verb reads it when the verb names no `auth`.
 */
export const openaiS2sManifest: AdapterManifest = {
  vendor: 'openai_s2s',
  displayName: 'OpenAI Realtime',
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
          help: 'An OpenAI API key with access to the Realtime API.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://platform.openai.com/docs/guides/realtime',
  credentialOnly: true,
  category: 's2s',
};
