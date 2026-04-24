import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known Bedrock models spanning the main publisher families available via the
 * Converse API. Model ids on Bedrock include a publisher prefix and version
 * suffix (e.g. `anthropic.claude-3-5-sonnet-20241022-v2:0`).
 *
 * Bedrock also supports cross-region inference profile ids (e.g.
 * `us.anthropic.claude-3-5-sonnet-20241022-v2:0`) — users should enter those
 * directly when needed; the adapter passes `model` through unchanged.
 *
 * Ordering matters: the first entry is used as the default probe model by
 * api-server's GET /LlmCredentials/:sid/test when `supportsModelListing` is
 * false. Amazon Nova Micro is first — AWS's own cheapest-per-token model,
 * broadly available across regions, and (unlike third-party Claude/Llama
 * models) not subject to provider-led "legacy" lifecycles that can revoke
 * access. Operators can override via `JAMBONZ_LLM_BEDROCK_PROBE_MODEL`.
 */
const BEDROCK_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'amazon.nova-micro-v1:0',
    displayName: 'Amazon Nova Micro',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'amazon.nova-lite-v1:0',
    displayName: 'Amazon Nova Lite',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 300_000,
    },
  },
  {
    id: 'amazon.nova-pro-v1:0',
    displayName: 'Amazon Nova Pro',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 300_000,
    },
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    displayName: 'Claude 3.5 Haiku (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    displayName: 'Claude 3.5 Sonnet (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    displayName: 'Claude 3.5 Sonnet v2 (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    displayName: 'Claude 3.7 Sonnet (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'meta.llama3-3-70b-instruct-v1:0',
    displayName: 'Llama 3.3 70B Instruct (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'mistral.mistral-large-2407-v1:0',
    displayName: 'Mistral Large (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
];

// Common Bedrock regions. Not exhaustive — users can enter others via 'Other'
// or (later) a free-text region field. The library does not validate against
// this list; it's purely a UI aid.
const BEDROCK_REGIONS: Array<{ value: string; label: string }> = [
  { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
  { value: 'us-east-2', label: 'us-east-2 (Ohio)' },
  { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
  { value: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
  { value: 'eu-west-3', label: 'eu-west-3 (Paris)' },
  { value: 'eu-central-1', label: 'eu-central-1 (Frankfurt)' },
  { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
  { value: 'ap-south-1', label: 'ap-south-1 (Mumbai)' },
  { value: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
  { value: 'ap-southeast-2', label: 'ap-southeast-2 (Sydney)' },
  { value: 'ca-central-1', label: 'ca-central-1 (Canada)' },
];

export const bedrockManifest: AdapterManifest = {
  vendor: 'bedrock',
  displayName: 'AWS Bedrock',
  authKinds: [
    {
      kind: 'bedrockApiKey',
      displayName: 'API Key',
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          help: 'Bedrock API key (bearer token). Create one in the AWS console under Amazon Bedrock → API keys.',
        },
        {
          name: 'region',
          label: 'Region',
          type: 'select',
          required: true,
          default: 'us-east-1',
          options: BEDROCK_REGIONS,
        },
      ],
    },
    {
      kind: 'bedrockIam',
      displayName: 'IAM Credentials',
      fields: [
        {
          name: 'accessKeyId',
          label: 'Access Key ID',
          type: 'text',
          required: true,
        },
        {
          name: 'secretAccessKey',
          label: 'Secret Access Key',
          type: 'password',
          required: true,
        },
        {
          name: 'sessionToken',
          label: 'Session Token',
          type: 'password',
          required: false,
          help: 'Only required when using temporary credentials (e.g., STS).',
        },
        {
          name: 'region',
          label: 'Region',
          type: 'select',
          required: true,
          default: 'us-east-1',
          options: BEDROCK_REGIONS,
        },
      ],
    },
  ],
  knownModels: BEDROCK_KNOWN_MODELS,
  // The Bedrock runtime client does not expose a `/models` listing — model
  // enumeration lives in `@aws-sdk/client-bedrock` (control plane), which we
  // don't pull in. Return the curated set from the manifest.
  supportsModelListing: false,
  docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html',
};
