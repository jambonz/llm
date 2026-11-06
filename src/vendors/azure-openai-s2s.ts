import type { AdapterManifest } from '../types.js';

/**
 * Azure OpenAI Realtime for the llm verb (vendor `microsoft`). Stored as `{api_key, host}`. The
 * deployment name is the agent's model, not part of the credential.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const azureOpenaiS2sManifest: AdapterManifest = {
  vendor: 'azure_openai_s2s',
  displayName: 'Azure OpenAI Realtime',
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
          help: 'A key of the Azure OpenAI resource: Keys and Endpoint.',
        },
        {
          name: 'host',
          label: 'Resource host',
          type: 'text',
          required: true,
          help: 'The resource host, e.g. my-resource.openai.azure.com. A full endpoint URL is accepted; only the host is used.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://learn.microsoft.com/azure/ai-foundry/openai/how-to/realtime-audio-websockets',
  credentialOnly: true,
  category: 's2s',
};
