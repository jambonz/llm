import { OpenAIAdapter } from '../openai/adapter.js';
import { streamFromOpenAI } from '../openai/_streaming.js';
import type { ApiKeyAuth, ClientOptions, LlmEvent, PromptRequest } from '../../types.js';
import { makeMetadataExtractor } from '../_metadata.js';
import { groqManifest } from './manifest.js';

/**
 * Groq response-header diagnostics. `x-groq-region` names the Groq
 * datacenter that served the request — useful for latency analysis.
 * `openai-processing-ms` is forwarded by Groq (they're OpenAI-wire-
 * compatible) and reports their server-side processing time, which
 * can be compared against wall-clock to spot infrastructure queueing
 * not counted in the model-server timer. Rate-limit headers help
 * operators spot when a workload is trending toward exhaustion
 * across turns within a call.
 */
const GROQ_METADATA_EXTRACTOR = makeMetadataExtractor([
  { header: 'x-request-id', key: 'request_id' },
  { header: 'x-groq-region', key: 'region' },
  { header: 'openai-processing-ms', key: 'processing_ms', numeric: true },
  { header: 'x-ratelimit-remaining-requests', key: 'requests_remaining', numeric: true },
  { header: 'x-ratelimit-remaining-tokens', key: 'tokens_remaining', numeric: true },
]);

/**
 * Adapter for Groq.
 *
 * Groq's chat-completions endpoint is OpenAI-wire-compatible — same request
 * shape, same streaming SSE, same tool-call format. The adapter is therefore
 * a thin subclass of `OpenAIAdapter` that defaults the `baseURL` to
 * `https://api.groq.com/openai/v1`. All wire translation, tool-call
 * accumulation, abort handling, and history round-tripping live in the
 * shared `streamFromOpenAI` helper.
 *
 * Why a separate class (vs. an inline alias like `DeepSeekAdapter` in
 * openai/factory.ts): keeps the manifest, README, and any future
 * Groq-specific quirks co-located in `src/adapters/groq/`. The DeepSeek
 * inline alias is a legacy shape; new vendors get their own directory.
 */
export class GroqAdapter extends OpenAIAdapter {
  override readonly vendor = groqManifest.vendor;

  override init(auth: ApiKeyAuth, client?: ClientOptions): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://api.groq.com/openai/v1',
      },
      client,
    );
  }

  override stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    // Override so we can pass Groq's own metadata extractor; otherwise
    // we'd inherit OpenAI's, which misses `x-groq-region`.
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: groqManifest.knownModels,
      vendorMetadataExtractor: GROQ_METADATA_EXTRACTOR,
    });
  }
}
