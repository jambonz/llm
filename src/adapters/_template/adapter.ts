import type {
  ApiKeyAuth,
  ClientOptions,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  ToolCallEvent,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';
import { templateManifest } from './manifest.js';

/**
 * Template adapter. Copy this directory to `src/adapters/<your-vendor>/`,
 * rename the class and export, and fill in the TODOs.
 *
 * Every method below has a stub that makes the contract test-kit fail in a
 * recognizable way. Implement them one at a time until the kit goes green.
 *
 * Read docs/adding-a-vendor.md before starting.
 */
export class TemplateAdapter implements LlmAdapter<ApiKeyAuth> {
  readonly vendor = templateManifest.vendor;
  readonly acceptedAuth = ['apiKey'] as const;

  // private client: VendorSdkClient | undefined;

  init(_auth: ApiKeyAuth, _client?: ClientOptions): void {
    // TODO: instantiate the vendor's SDK client with the credentials.
    // Example:
    //   this.client = new VendorSdk({
    //     apiKey: auth.apiKey,
    //     baseURL: auth.baseURL,
    //     timeout: client?.timeout,
    //     maxRetries: client?.maxRetries,
    //   });
    throw new Error('TemplateAdapter.init: not implemented');
  }

  // eslint-disable-next-line require-yield
  async *stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    // Standard library-side validation. Rejects empty messages, role:'system'
    // in messages, missing model. Contract check #18 depends on this.
    assertValidRequest(req);

    // TODO: call the vendor's streaming endpoint, honor req.signal, and yield
    // events as they arrive. The contract is:
    //   - Zero or more `{type: 'token', text}` events for content deltas.
    //   - Optional `{type: 'toolCallStart', id, name}` when a tool call begins
    //     (emit this as soon as the vendor surfaces the name).
    //   - Zero or more `{type: 'toolCall', id, name, arguments}` events — each
    //     emitted ONCE with fully-accumulated arguments.
    //   - Exactly one `{type: 'end', finishReason, usage?}` as the LAST event.
    //
    // On abort (req.signal?.aborted), yield {type: 'end', finishReason: 'aborted'}
    // and do NOT emit any pending toolCall events.
    throw new Error('TemplateAdapter.stream: not implemented');
  }

  appendAssistantToolCall(
    _history: Message[],
    _toolCalls: ReadonlyArray<ToolCallEvent>,
  ): Message[] {
    // TODO: append an assistant turn containing the given tool calls to
    // history, in the vendor's native shape. This turn must precede the
    // tool-result messages appended by `appendToolResult()` on the next
    // `stream()` call.
    //
    // Example (OpenAI-style):
    //   return [
    //     ...history,
    //     {
    //       role: 'assistant',
    //       content: '',
    //       vendorRaw: {
    //         role: 'assistant',
    //         content: null,
    //         tool_calls: toolCalls.map((tc) => ({
    //           id: tc.id,
    //           type: 'function',
    //           function: {
    //             name: tc.name,
    //             arguments: JSON.stringify(tc.arguments ?? {}),
    //           },
    //         })),
    //       },
    //     },
    //   ];
    throw new Error('TemplateAdapter.appendAssistantToolCall: not implemented');
  }

  appendToolResult(
    _history: Message[],
    _toolCallId: string,
    _result: unknown,
  ): Message[] {
    // TODO: append a tool-result message to history in the vendor's native shape.
    // The returned array must be a valid `messages` input for a subsequent
    // stream() call on this adapter.
    //
    // Example (OpenAI-style):
    //   return [
    //     ...history,
    //     { role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result),
    //       vendorRaw: { tool_call_id: toolCallId } },
    //   ];
    throw new Error('TemplateAdapter.appendToolResult: not implemented');
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    // TODO: hit the vendor's /models (or equivalent) endpoint and return the
    // accessible models. If the vendor has no list endpoint, return
    // `templateManifest.knownModels` and set `supportsModelListing: false` in
    // the manifest.
    throw new Error('TemplateAdapter.listAvailableModels: not implemented');
  }

  async testCredential(): Promise<void> {
    // Verify the credential authenticates against the vendor. This is an
    // auth check only — success means "the vendor accepts these creds";
    // it does NOT imply any specific model is accessible to the caller.
    //
    // Pick the cheapest authenticated call available:
    //   - If the vendor has /models, call listAvailableModels() and drop the result.
    //   - If there's no list endpoint, find a no-cost authenticated endpoint
    //     (token mint, whoami, etc.).
    //   - Avoid chat-probe fallbacks — they couple auth validation to specific
    //     model grants, which is almost always wrong.
    throw new Error('TemplateAdapter.testCredential: not implemented');
  }

  // warmup?(): Promise<void> {
  //   // OPTIONAL: pre-establish TLS / pool a connection. No-op is fine.
  // }
}
