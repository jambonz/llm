import type {
  AdapterFactory,
  BedrockApiKeyAuth,
  BedrockIamAuth,
} from '../../types.js';
import { BedrockAdapter } from './adapter.js';
import { bedrockManifest } from './manifest.js';

export const bedrockFactory: AdapterFactory<BedrockApiKeyAuth | BedrockIamAuth> = {
  vendor: bedrockManifest.vendor,
  manifest: bedrockManifest,
  create: () => new BedrockAdapter(),
};
