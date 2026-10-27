import type { AdapterFactory, ApiKeyAuth } from '../../types.js';
import { OpenRouterAdapter } from './adapter.js';
import { openRouterManifest } from './manifest.js';

export const openRouterFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: openRouterManifest.vendor,
  manifest: openRouterManifest,
  create: () => new OpenRouterAdapter(),
};
