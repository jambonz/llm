import type { AdapterManifest } from '../types.js';

/**
 * ElevenLabs Agents for the llm verb (speech-to-speech). Its own credential,
 * like `openai_s2s`: someone adds it on purpose for ElevenLabs Agents.
 *
 * Credential-only: feature-server runs the agent's conversation itself
 * (through the media server). Stored as `{api_key}`; the agent is named on
 * the verb (`auth.agent_id`), so one key serves every agent on the account.
 * The llm verb reads the key when the verb's `auth` carries none.
 */
export const elevenlabsS2sManifest: AdapterManifest = {
  vendor: 'elevenlabs_s2s',
  displayName: 'ElevenLabs Agents',
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
          help: 'An ElevenLabs API key (ElevenLabs: Developers, API keys).',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://elevenlabs.io/docs/agents-platform/overview',
  credentialOnly: true,
  category: 's2s',
};
