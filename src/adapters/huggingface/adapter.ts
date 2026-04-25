import { OpenAIAdapter } from '../openai/adapter.js';
import { streamFromOpenAI } from '../openai/_streaming.js';
import type { ApiKeyAuth, ClientOptions, LlmEvent, PromptRequest } from '../../types.js';
import { makeMetadataExtractor } from '../_metadata.js';
import { huggingfaceManifest } from './manifest.js';

/**
 * HuggingFace Inference Providers response-header diagnostics.
 *
 * `x-inference-provider` is the killer signal — names the actual
 * backend (Groq, Cerebras, Together, Fireworks, etc.) that served
 * the request. Useful for diagnosing latency anomalies and confirming
 * provider routing for `:fastest` / `:provider-name` model suffixes.
 */
const HUGGINGFACE_METADATA_EXTRACTOR = makeMetadataExtractor([
  { header: 'x-inference-provider', key: 'provider' },
  { header: 'x-request-id', key: 'request_id' },
]);

/**
 * Adapter for HuggingFace Inference Providers.
 *
 * HF Providers is a multi-provider broker: one HF token at
 * https://router.huggingface.co/v1 routes requests to whichever inference
 * shop hosts the requested model — Groq, Together, Fireworks, Cerebras,
 * Nebius, Hyperbolic, SambaNova, etc. The wire is OpenAI-compatible (chat
 * completions, streaming, tools, Bearer auth), so the adapter is a thin
 * subclass of `OpenAIAdapter` that defaults the `baseURL`.
 *
 * Model field syntax: customers pass canonical HF model ids
 * (`meta-llama/Llama-3.3-70B-Instruct`). They MAY append a routing
 * hint:
 *   - `:fireworks-ai`, `:cerebras`, `:groq`, etc. — pin a specific provider
 *   - `:fastest` — let HF route to the fastest available backend
 * Suffixes pass through to HF unchanged. The library's capability lookup
 * falls back to `defaultCapabilitiesForUnknown` for suffixed ids.
 */
export class HuggingfaceAdapter extends OpenAIAdapter {
  override readonly vendor = huggingfaceManifest.vendor;

  override init(auth: ApiKeyAuth, client?: ClientOptions): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://router.huggingface.co/v1',
      },
      client,
    );
  }

  override stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: huggingfaceManifest.knownModels,
      vendorMetadataExtractor: HUGGINGFACE_METADATA_EXTRACTOR,
    });
  }
}
