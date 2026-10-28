import type { AdapterManifest } from '../types.js';

/**
 * The harness vendor: a customer-run WebSocket endpoint that takes the agent's
 * "think" step (jambonz keeps telephony, STT, turn-taking and TTS).
 *
 * Credential-only: there is no adapter here, because feature-server speaks the
 * harness protocol itself. The manifest exists so api-server can validate and
 * store the credential and the portal can render its form. Stored as
 * `{url, api_key}`; feature-server reads exactly those two fields.
 */
export const harnessManifest: AdapterManifest = {
  vendor: 'harness',
  displayName: 'Harness',
  authKinds: [
    {
      // Only the form schema matters for a credential-only vendor; no
      // AuthSpec is ever built from it.
      kind: 'apiKey',
      displayName: 'API Key',
      fields: [
        {
          name: 'url',
          label: 'WebSocket URL',
          type: 'url',
          required: true,
          help:
            'wss:// URL of your harness. ws:// is accepted only for a private or localhost address.',
        },
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          help: 'Sent to the harness as "Authorization: Bearer <key>" when each call connects.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  credentialOnly: true,
  category: 'llm',
};
