import { OpenAIAdapter } from '../openai/adapter.js';
import type { ApiKeyAuth, ClientOptions } from '../../types.js';
import { groqManifest } from './manifest.js';

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
}
