import type { AdapterManifest } from '../types.js';

/**
 * Qwen Omni realtime (Alibaba Cloud Model Studio / DashScope) for the llm verb. Stored as
 * `{api_key, host}`: keys are bound to a region and workspace, so the host is part of the
 * credential.
 *
 * Credential-only: feature-server runs the session itself (through the media
 * server). The llm verb reads it when the verb names no `auth`.
 */
export const qwenS2sManifest: AdapterManifest = {
  vendor: 'qwen_s2s',
  displayName: 'Qwen Omni Realtime',
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
          help: 'A Model Studio (DashScope) API key.',
        },
        {
          name: 'host',
          label: 'Workspace host',
          type: 'text',
          required: true,
          help: 'The realtime host of the workspace the key belongs to, e.g. ws-xxxx.ap-southeast-1.maas.aliyuncs.com, or dashscope-intl.aliyuncs.com for the international default. A full URL is accepted; only the host is used.',
        },
      ],
    },
  ],
  knownModels: [],
  supportsModelListing: false,
  docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/realtime',
  credentialOnly: true,
  category: 's2s',
};
