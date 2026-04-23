import type { AdapterFactory, ApiKeyAuth } from '../../types.js';
import { TemplateAdapter } from './adapter.js';
import { templateManifest } from './manifest.js';

/**
 * Factory registered with the core registry. Each `createLlm({vendor: 'template'})`
 * call produces a fresh `TemplateAdapter` instance via `create()`.
 *
 * Copy this file when you add a new vendor: rename the const, swap the adapter
 * class, and import your manifest. Then add a registration line to
 * `src/adapters/index.ts`.
 */
export const templateFactory: AdapterFactory<ApiKeyAuth> = {
  vendor: templateManifest.vendor,
  manifest: templateManifest,
  create: () => new TemplateAdapter(),
};
