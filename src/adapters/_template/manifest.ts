import type { AdapterManifest } from '../../types.js';

/**
 * Manifest describing this vendor to the outside world.
 *
 * The manifest is STATIC — it must not depend on credentials or make network
 * calls. It is served by api-server's `/llm-vendors/manifest` endpoint to
 * unauthenticated webapp clients.
 *
 * Fill in:
 *   - `vendor`: the machine-readable id used in `createLlm({vendor})`. Must
 *     match `TemplateAdapter.vendor` in ./adapter.ts.
 *   - `displayName`: shown in the admin UI.
 *   - `authKinds`: one or more accepted auth shapes, with form schemas for
 *     webapp to render. Each `kind` must be one of `AuthSpec['kind']`.
 *   - `knownModels`: a curated list of known models with their capabilities.
 *   - `supportsModelListing`: true if `listAvailableModels()` hits a live
 *     vendor endpoint; false if it just returns `knownModels`.
 */
export const templateManifest: AdapterManifest = {
  vendor: 'template',
  displayName: 'Template Vendor',
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
          help: 'Get one from your vendor dashboard.',
        },
        {
          name: 'baseURL',
          label: 'Base URL',
          type: 'url',
          required: false,
          default: 'https://api.example.com/v1',
          help: 'Override for self-hosted or proxy endpoints.',
        },
      ],
    },
  ],
  knownModels: [
    {
      id: 'template-model-1',
      displayName: 'Template Model 1',
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        systemPrompt: true,
        maxContextTokens: 128_000,
      },
    },
  ],
  supportsModelListing: false,
};
