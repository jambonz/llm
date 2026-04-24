import type { AdapterFactory, VertexServiceAccountAuth } from '../../types.js';
import { VertexOpenAIAdapter } from './adapter.js';
import { vertexOpenAIManifest } from './manifest.js';

export const vertexOpenAIFactory: AdapterFactory<VertexServiceAccountAuth> = {
  vendor: vertexOpenAIManifest.vendor,
  manifest: vertexOpenAIManifest,
  create: () => new VertexOpenAIAdapter(),
};
