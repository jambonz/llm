import type { AdapterManifest, ModelInfo } from '../../types.js';

/**
 * Known models that customers commonly deploy to Azure OpenAI Service.
 *
 * Unlike `api.openai.com`, Azure doesn't pick the model from the `model`
 * request field — the deployment name in the URL determines which model runs.
 * The manifest's model list is therefore keyed by the underlying *model* so
 * capability flags can be looked up by whichever model the user's deployment
 * points at. Common Azure deployment names mirror the model id (e.g. a
 * deployment called `gpt-4o` running `gpt-4o`), but customers may use arbitrary
 * names like `prod-chat` or `my-assistant` — that's fine; capability flags
 * default to something reasonable if the deployment name doesn't match.
 *
 * Azure's fine-tune deployments and private-preview model ids are out of scope.
 */
const AZURE_OPENAI_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o (on Azure)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o mini (on Azure)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo (on Azure)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    // Azure spells it `gpt-35-turbo` (no dot). Keep their spelling for the id
    // so capability lookups against deployment names that echo the Azure id
    // hit.
    id: 'gpt-35-turbo',
    displayName: 'GPT-3.5 Turbo (on Azure)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 16_385,
    },
  },
  {
    id: 'o1-preview',
    displayName: 'o1 preview — reasoning (on Azure)',
    capabilities: {
      streaming: false,
      tools: false,
      vision: false,
      systemPrompt: false,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'o1-mini',
    displayName: 'o1 mini — reasoning (on Azure)',
    capabilities: {
      streaming: false,
      tools: false,
      vision: false,
      systemPrompt: false,
      maxContextTokens: 128_000,
    },
  },
];

export const azureOpenAIManifest: AdapterManifest = {
  vendor: 'azure-openai',
  displayName: 'Azure OpenAI',
  authKinds: [
    {
      kind: 'azureOpenAIApiKey',
      displayName: 'API Key',
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          help:
            'In Azure AI Foundry, open the deployment and copy the Key from ' +
            'the Endpoint panel (eye icon to reveal). Same key is shown in ' +
            'the Azure portal under your OpenAI resource → Keys and Endpoint.',
        },
        {
          name: 'endpoint',
          label: 'Endpoint',
          type: 'url',
          required: true,
          help:
            'Resource hostname only — no path, no query string. Example: ' +
            'https://my-resource.openai.azure.com. The Foundry deployment ' +
            'page shows a Target URI like ' +
            'https://my-resource.openai.azure.com/openai/responses?api-version=… ' +
            'Strip everything from /openai/ onward and paste only the part ' +
            'before it.',
        },
        {
          name: 'deployment',
          label: 'Deployment Name',
          type: 'text',
          required: true,
          help:
            'The Name shown at the top of the deployment page in Azure AI ' +
            'Foundry (also under Deployment info → Name). NOT the underlying ' +
            'model id — deployments can be named anything you chose at create time.',
        },
        {
          name: 'apiVersion',
          label: 'API Version',
          type: 'text',
          required: true,
          default: '2025-03-01-preview',
          help:
            'Data-plane api-version. Visible in Foundry as the ?api-version=… ' +
            'query string in the Target URI, or the api_version=… line in the ' +
            'Python sample. The default 2025-03-01-preview is the minimum that ' +
            'works with gpt-5 / o-series deployments — Azure routes those ' +
            'through the Responses API internally and rejects older versions.',
        },
      ],
    },
  ],
  knownModels: AZURE_OPENAI_KNOWN_MODELS,
  // Azure's list-deployments endpoint is on the control plane (ARM) and
  // requires AAD credentials the data-plane API key doesn't carry. Return
  // the curated set from the manifest.
  supportsModelListing: false,
  docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/reference',
};
