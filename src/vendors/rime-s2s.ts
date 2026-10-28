import type { AdapterManifest } from '../types.js';

/**
 * Rime Prism for the llm verb (speech-to-speech). Its own credential, like
 * `openai_s2s`: someone adds it on purpose for Prism.
 *
 * Credential-only: feature-server runs the Prism session itself (through the
 * media server). Stored as `{api_key}`; the llm verb reads it when the verb
 * names no `auth`.
 */
export const rimeS2sManifest: AdapterManifest = {
  vendor: 'rime_s2s',
  displayName: 'Rime Prism',
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
          help: 'A Rime API key. Prism uses the same keys as Rime text-to-speech.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://docs.rime.ai/docs/prism/overview',
  credentialOnly: true,
  category: 's2s',
};
