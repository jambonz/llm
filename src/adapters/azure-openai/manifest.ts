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
            'Azure OpenAI resource key. Find it in the Azure portal under ' +
            'your OpenAI resource → Keys and Endpoint.',
        },
        {
          name: 'endpoint',
          label: 'Endpoint',
          type: 'url',
          required: true,
          help:
            'Resource endpoint URL, e.g. https://my-resource.openai.azure.com. ' +
            'Shown in the Azure portal alongside the keys.',
        },
        {
          name: 'deployment',
          label: 'Deployment Name',
          type: 'text',
          required: true,
          help:
            'The name you chose for the deployment in Azure AI Studio ' +
            '(NOT the underlying model id — deployments can be named anything).',
        },
        {
          name: 'apiVersion',
          label: 'API Version',
          type: 'text',
          required: true,
          default: '2024-10-21',
          help:
            'Data-plane api-version, e.g. 2024-10-21. Microsoft rolls these ' +
            'frequently; see Azure OpenAI API reference docs for the current ' +
            'stable GA version.',
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
