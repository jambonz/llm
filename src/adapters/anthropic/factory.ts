import type { AdapterFactory, ApiKeyAuth } from '../../types.js';
import { AnthropicAdapter } from './adapter.js';
import { anthropicManifest } from './manifest.js';

export const anthropicFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: anthropicManifest.vendor,
  manifest: anthropicManifest,
  create: () => new AnthropicAdapter(),
};
