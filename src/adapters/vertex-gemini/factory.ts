import type { AdapterFactory, VertexServiceAccountAuth } from '../../types.js';
import { VertexGeminiAdapter } from './adapter.js';
import { vertexGeminiManifest } from './manifest.js';

export const vertexGeminiFactory: AdapterFactory<VertexServiceAccountAuth> = {
  vendor: vertexGeminiManifest.vendor,
  manifest: vertexGeminiManifest,
  create: () => new VertexGeminiAdapter(),
};
