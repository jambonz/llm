import type { AdapterFactory, ApiKeyAuth } from '../../types.js';
import { GroqAdapter } from './adapter.js';
import { groqManifest } from './manifest.js';

export const groqFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: groqManifest.vendor,
  manifest: groqManifest,
  create: () => new GroqAdapter(),
};
