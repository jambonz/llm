import type { AdapterManifest } from '../types.js';

/**
 * Deepgram Voice Agent for the llm verb (speech-to-speech). Its own
 * credential, like `openai_s2s`: someone adds it on purpose for the Voice
 * Agent, apart from any Deepgram speech credential used for STT or TTS.
 *
 * Credential-only: feature-server runs the Voice Agent session itself
 * (through the media server). Stored as `{api_key}`; the llm verb reads it
 * when the verb names no `auth`.
 */
export const deepgramS2sManifest: AdapterManifest = {
  vendor: 'deepgram_s2s',
  displayName: 'Deepgram Voice Agent',
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
          help: 'A Deepgram API key (Deepgram console: API Keys).',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://developers.deepgram.com/docs/voice-agent',
  credentialOnly: true,
  category: 's2s',
};
