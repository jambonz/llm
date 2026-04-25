import type { AdapterFactory, ApiKeyAuth } from '../../types.js';
import { HuggingfaceAdapter } from './adapter.js';
import { huggingfaceManifest } from './manifest.js';

export const huggingfaceFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: huggingfaceManifest.vendor,
  manifest: huggingfaceManifest,
  create: () => new HuggingfaceAdapter(),
};
