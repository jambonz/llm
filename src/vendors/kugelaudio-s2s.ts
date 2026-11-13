import type { AdapterManifest } from '../types.js';

/**
 * KugelAudio Fluid for the llm verb (speech-to-speech). Stored as
 * `{api_key, region}`; the region picks the KugelAudio host.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const kugelaudioS2sManifest: AdapterManifest = {
  vendor: 'kugelaudio_s2s',
  displayName: 'KugelAudio Fluid',
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
          help: 'A KugelAudio API key with Realtime sessions allowed. Keys with a region prefix (eu-) are not accepted here; pick the region below.',
        },
        {
          name: 'region',
          label: 'Region',
          type: 'select',
          required: true,
          default: 'global',
          options: [
            { value: 'global', label: 'Global (api.kugelaudio.com)' },
            { value: 'eu', label: 'EU (api.eu.kugelaudio.com)' },
            { value: 'us', label: 'US (api.us.kugelaudio.com)' },
          ],
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://docs.kugelaudio.com/speech-to-speech/overview',
  credentialOnly: true,
  category: 's2s',
};
