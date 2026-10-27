import { OpenAIAdapter } from '../openai/adapter.js';
import { streamFromOpenAI } from '../openai/_streaming.js';
import type { ApiKeyAuth, ClientOptions, LlmEvent, ModelInfo, PromptRequest } from '../../types.js';
import { makeMetadataExtractor } from '../_metadata.js';
import { openRouterManifest } from './manifest.js';

/**
 * OpenRouter response-header diagnostics. `x-generation-id` is the id
 * OpenRouter support asks for, and the key to `/api/v1/generation` for
 * per-request cost and upstream-provider stats.
 */
const OPENROUTER_METADATA_EXTRACTOR = makeMetadataExtractor([
  { header: 'x-generation-id', key: 'request_id' },
]);

/** The subset of OpenRouter's `/models` entry this adapter reads. */
interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
}

/**
 * Adapter for OpenRouter.
 *
 * OpenRouter's chat-completions endpoint is OpenAI-wire-compatible, so this
 * is a thin subclass of `OpenAIAdapter` that defaults the `baseURL` to
 * `https://openrouter.ai/api/v1`. Anthropic prompt caching on OpenRouter is
 * handled by the base class, which detects the openrouter.ai baseURL (so it
 * also works for OpenAI credentials pointed at OpenRouter).
 *
 * Two overrides exist because OpenRouter's `/models` is public:
 *   - `testCredential()` probes the authenticated `/key` endpoint instead —
 *     `/models` returns 200 for any key, bogus or not.
 *   - `listAvailableModels()` uses the capability metadata `/models` carries
 *     (tool support, vision, context length) rather than guessing by id.
 */
export class OpenRouterAdapter extends OpenAIAdapter {
  override readonly vendor = openRouterManifest.vendor;

  override init(auth: ApiKeyAuth, client?: ClientOptions): void {
    super.init(
      {
        ...auth,
        baseURL: auth.baseURL ?? 'https://openrouter.ai/api/v1',
      },
      client,
    );
  }

  override stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    // Override so we can pass OpenRouter's own metadata extractor.
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: this.knownModels(),
      vendorMetadataExtractor: OPENROUTER_METADATA_EXTRACTOR,
      // Verified accepted by OpenRouter (forwarded to OpenAI-family upstreams).
      includeCacheKey: true,
      openRouterAutoCache: this.isOpenRouter,
    });
  }

  override async listAvailableModels(): Promise<ModelInfo[]> {
    const result = await this.ensureClient().models.list();
    const out: ModelInfo[] = [];
    for (const m of result.data as unknown as OpenRouterModel[]) {
      // `:batch` variants are async-only; image-generation models emit no text.
      if (m.id.endsWith(':batch')) continue;
      const outputs = m.architecture?.output_modalities;
      if (outputs && !outputs.includes('text')) continue;
      const known = this.knownModels().find((k) => k.id === m.id);
      if (known) {
        out.push(known);
        continue;
      }
      out.push({
        id: m.id,
        ...(m.name ? { displayName: m.name } : {}),
        capabilities: {
          streaming: true,
          tools: m.supported_parameters?.includes('tools') ?? true,
          vision: m.architecture?.input_modalities?.includes('image') ?? false,
          systemPrompt: true,
          ...(m.context_length ? { maxContextTokens: m.context_length } : {}),
        },
      });
    }
    return out;
  }

  override async testCredential(): Promise<void> {
    // GET /key is authenticated (401 on a bad key) and free.
    await this.ensureClient().get('/key');
  }

  protected override knownModels(): ReadonlyArray<ModelInfo> {
    return openRouterManifest.knownModels;
  }
}
