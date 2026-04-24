import type { AdapterFactory, GoogleApiKeyAuth } from '../../types.js';
import { GoogleAdapter } from './adapter.js';
import { googleManifest } from './manifest.js';

export const googleFactory: AdapterFactory<GoogleApiKeyAuth> = {
  vendor: googleManifest.vendor,
  manifest: googleManifest,
  create: () => new GoogleAdapter(),
};
