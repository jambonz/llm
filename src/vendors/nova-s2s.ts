import type { AdapterManifest } from '../types.js';

/**
 * Amazon Nova Sonic (Bedrock) for the llm verb (speech-to-speech). Stored as
 * `{access_key_id, secret_access_key, region}`. Long-lived IAM user keys only:
 * a session token expires, so it cannot be stored.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const novaS2sManifest: AdapterManifest = {
  vendor: 'nova_s2s',
  displayName: 'Amazon Nova Sonic',
  authKinds: [
    {
      kind: 'bedrockIam',
      displayName: 'IAM Credentials',
      fields: [
        {
          name: 'accessKeyId',
          label: 'Access Key ID',
          type: 'text',
          required: true,
          help:
            'An IAM user access key allowed bedrock:InvokeModelWithBidirectionalStream on the Nova Sonic model.',
        },
        {
          name: 'secretAccessKey',
          label: 'Secret Access Key',
          type: 'password',
          required: true,
        },
        {
          name: 'region',
          label: 'Region',
          type: 'text',
          required: true,
          default: 'us-east-1',
          help: 'A Bedrock region where Nova Sonic is enabled for the account, e.g. us-east-1.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://docs.aws.amazon.com/nova/latest/userguide/speech.html',
  credentialOnly: true,
  category: 's2s',
};
