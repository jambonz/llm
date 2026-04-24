import type { AdapterFactory, AzureOpenAIApiKeyAuth } from '../../types.js';
import { AzureOpenAIAdapter } from './adapter.js';
import { azureOpenAIManifest } from './manifest.js';

export const azureOpenAIFactory: AdapterFactory<AzureOpenAIApiKeyAuth> = {
  vendor: azureOpenAIManifest.vendor,
  manifest: azureOpenAIManifest,
  create: () => new AzureOpenAIAdapter(),
};
