import type { AdapterManifest } from '../types.js';

/**
 * Dialogflow CES (Conversational Agents) for the dialogflow verb. Its own
 * credential, never a Google speech credential: a service account that works
 * for speech-to-text or text-to-speech need not have CES access, and the
 * other way round.
 *
 * Credential-only: feature-server runs the CES session itself. Stored as
 * `{service_key}` (the key JSON as a string); the dialogflow verb reads it
 * when its `credentials` is a reference `{vendor: 'dialogflow_ces', label}`.
 */
export const dialogflowCesManifest: AdapterManifest = {
  vendor: 'dialogflow_ces',
  displayName: 'Dialogflow CES',
  authKinds: [
    {
      kind: 'googleServiceAccount',
      displayName: 'Service Account JSON',
      fields: [
        {
          name: 'credentials',
          label: 'Service Account Key (JSON)',
          type: 'json-file',
          required: true,
          help: 'The key of a service account allowed to run your CES agents (Customer Engagement Suite).',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://cloud.google.com/customer-engagement-ai/conversational-agents/ps',
  credentialOnly: true,
  category: 'hosted',
};
