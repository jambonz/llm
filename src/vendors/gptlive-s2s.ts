import type { AdapterManifest } from '../types.js';

/**
 * OpenAI GPT-Live for the llm verb (speech-to-speech). A different API from
 * OpenAI Realtime (v1/live/sessions), so its own credential, like
 * `openai_s2s`: someone adds it on purpose for GPT-Live.
 *
 * Credential-only: feature-server runs the GPT-Live session itself (through
 * the media server). Stored as `{api_key, api_url?}`; the llm verb reads it
 * when the verb names no `auth`. A base URL points it at another provider of
 * the same API.
 */
export const gptliveS2sManifest: AdapterManifest = {
  vendor: 'gptlive_s2s',
  displayName: 'OpenAI GPT-Live',
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
          help: 'An OpenAI API key for a project with access to GPT-Live (a paid usage tier), or the key of the provider in Base URL.',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          help: 'Leave empty for OpenAI. For another provider of the GPT-Live API, its base URL, e.g. https://api.kugelaudio.com/v1 for KugelAudio Fluid.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://developers.openai.com/api/docs/models/gpt-live-1',
  credentialOnly: true,
  category: 's2s',
};
