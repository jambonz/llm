# Adding a new LLM vendor

This guide walks you through contributing a new vendor adapter to `@jambonz/llm`. The library is designed so that the work is concentrated: one adapter directory, one registration line, one test file.

## What you'll implement

Every adapter implements the same contract — a small interface exported from `src/types.ts`:

```typescript
interface LlmAdapter<A extends AuthSpec = AuthSpec> {
  readonly vendor: string;
  readonly acceptedAuth: ReadonlyArray<A['kind']>;
  init(auth: A, client?: ClientOptions): Promise<void> | void;
  stream(req: PromptRequest): AsyncIterable<LlmEvent>;
  appendAssistantToolCall(
    history: Message[],
    toolCalls: ReadonlyArray<ToolCallEvent>,
  ): Message[];
  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[];
  listAvailableModels(): Promise<ModelInfo[]>;
  warmup?(): Promise<void>;
}
```

Plus a static `AdapterManifest` describing the vendor for the admin UI (auth form fields, known models, capability flags).

## Step-by-step

### 1. Copy the template

```bash
cp -r src/adapters/_template src/adapters/<your-vendor>
```

Rename the class (`TemplateAdapter` → `YourAdapter`) and the factory export (`templateFactory` → `yourFactory`). Update the vendor id in `manifest.ts`.

### 2. Fill in the manifest

`src/adapters/<your-vendor>/manifest.ts` is the static metadata served to the admin UI. Set:

- `vendor`: lowercase id used in `createLlm({vendor: ...})`. Must be kebab-case: `openai`, `vertex-gemini`, etc.
- `displayName`: shown in the admin UI.
- `authKinds`: one or more accepted auth shapes. Each has a form-field schema that drives the admin UI's add-LLM page. Use multiple entries for vendors that support more than one auth mode (API key + IAM for Bedrock, API key + service account for Google, etc.).
- `knownModels`: a curated list of model ids with their capabilities. `tools: true` for tool-capable models, `false` otherwise. **This is per-model, not per-vendor** — many vendors have a mix.
- `supportsModelListing`: true if `listAvailableModels()` hits a live endpoint (OpenAI's `/v1/models`, etc.); false if it just returns `knownModels`.

The manifest MUST be static — no credentials, no network calls. It's safe to serve to unauthenticated webapp clients.

### 3. Implement `init()`

Instantiate the vendor SDK client from the credential. Keep it cheap — no network calls. If the vendor SDK needs async setup, you can return a Promise from `init()`.

```typescript
init(auth: ApiKeyAuth, client?: ClientOptions): void {
  this.client = new VendorSdk({
    apiKey: auth.apiKey,
    baseURL: auth.baseURL,
    timeout: client?.timeout,
    maxRetries: client?.maxRetries,
  });
}
```

### 4. Implement `stream()`

This is the core of the adapter. Contract:

- Zero or more `{type: 'token', text}` events for content deltas.
- Optional `{type: 'toolCallStart', id, name}` when a tool call begins (emit as soon as the vendor surfaces the name — helps voice callers say filler audio while arguments still stream).
- Zero or more `{type: 'toolCall', id, name, arguments}` events, each emitted ONCE with fully-accumulated arguments.
- Exactly one `{type: 'end', finishReason, usage?}` as the LAST event.

Always call `assertValidRequest(req)` from `src/validate.js` at the top — it enforces the library's standard preconditions (non-empty messages, no `role: 'system'` in messages, non-empty model).

Honor `req.signal`. Pass it through to the vendor SDK where supported. On abort, yield `{type: 'end', finishReason: 'aborted'}` and do NOT emit any partially-accumulated tool call.

Tool-call argument deltas are often streamed fragmented by vendors (OpenAI in particular). Accumulate them internally; emit `toolCall` once when the arguments are complete.

### 5. Implement `appendAssistantToolCall()` and `appendToolResult()`

These two helpers let stateful callers (e.g. a voice agent maintaining a running history across turns) append the two halves of a tool-call round-trip in your vendor's native shape:

- `appendAssistantToolCall(history, toolCalls)` — called after `stream()` yields one or more `toolCall` events. Returns a new history with an **assistant turn** that carries the tool calls in whatever wire shape the vendor expects (OpenAI's `tool_calls` array, Anthropic's `content: [{type:'tool_use',...}]` blocks, Gemini's `parts: [{functionCall,...}]`, Bedrock's `content: [{toolUse: ...}]`, etc.).
- `appendToolResult(history, toolCallId, result)` — called after the caller has executed the tool. Appends a **tool-result message** in the vendor's native shape. The returned array MUST be a valid `messages` input for a subsequent `stream()` call on the same adapter.

The `vendorRaw` field on Message is an opaque wire shape — use it to preserve vendor-native details. When the adapter sees `vendorRaw` on an assistant or tool message in a subsequent request, use it as the source of truth rather than re-constructing from the normalized fields.

Callers MUST invoke `appendAssistantToolCall` before `appendToolResult`; the vendor's API will reject a tool-result message that isn't preceded by the matching assistant turn.

### 6. Implement `listAvailableModels()`

Hit the vendor's list-models endpoint and return the accessible models. If the vendor has no list endpoint, return `manifest.knownModels` and set `supportsModelListing: false`.

### 7. Register the adapter

Add the factory to `src/adapters/index.ts`:

```typescript
import { registerAdapter } from '../registry.js';
import { yourFactory } from './your-vendor/index.js';

registerAdapter(yourFactory);
```

### 8. Run the contract test-kit

Write a test file that runs the 20 contract checks against your adapter. The kit needs a **harness** — a small object that tells it how to mock your vendor's SDK for each named scenario.

```typescript
// test/adapters/your-vendor.contract.test.ts
import { runContractTests } from '../../src/test-kit/index.js';
import { createYourHarness } from './your-vendor.harness.js';

runContractTests(createYourHarness());
```

The harness implements the `ContractHarness` interface (see `src/test-kit/types.ts`). It exposes:

- `factory` — your adapter factory.
- `authFor(kind)` — return a valid `AuthSpec` for each kind your manifest declares.
- `unsupportedAuth` — an `AuthSpec` your adapter should reject (verifies `init()` guards).
- `mockScenario(scenario)` — stage a canned vendor response. Six scenarios: `simple-stream`, `tool-call`, `tool-call-after-tokens`, `long-stream`, `long-stream-with-pending-tool`, `list-models`.
- `cleanup()` — reset mocks between tests.
- `getCapturedRequest()` — return a normalized view of the most recent request your adapter sent upstream. Used by checks #17 (system prompt), #19 (multi-turn), #20 (vendorRaw).
- `toolCapableModel`, `nonToolCapableModel`, `emitsToolCallStart` — per-adapter facts.

For HTTP-based vendors (OpenAI, Anthropic, Google, Vertex), use `nock` to intercept requests and replay fixture responses. For AWS Bedrock, use `aws-sdk-client-mock`. See the reference fake in `src/test-kit/fake-adapter.ts` for the shape of a minimal harness — it doesn't mock a real vendor, but it demonstrates every harness method.

Run `npm test`. The kit registers ~18 vitest tests (20 checks, some bundled). Fix failures one by one until all pass.

### 9. Write adapter-specific tests

The contract kit catches universal regressions. Your adapter almost certainly has vendor-specific quirks that deserve targeted tests:

- Wire format: assert on the HTTP body / SDK command your adapter produces from a given `PromptRequest`.
- Stream parsing: given a recorded vendor response, assert the correct sequence of events.
- Error paths: 401, 429, 500 — what finishReason does your adapter report?

Recorded fixtures live under `test/fixtures/<vendor>/` and are committed. See any existing adapter for the recording pattern.

### 10. Submit a PR

Green CI (`npm run lint && npm run typecheck && npm test && npm run build`) is the gate. Integration tests against the live vendor run on `main` after merge, using repository-secret credentials.

## The 20 contract checks

Here's what the kit verifies. Knowing this in advance helps you design your adapter's internal structure.

| # | Check |
|---|---|
| 1 | Manifest is well-formed (vendor, displayName, at least one AuthKind, valid FormField types, non-empty knownModels). |
| 2 | `createLlm` returns an adapter with matching vendor id. |
| 3 | `init()` accepts each declared auth kind. |
| 4 | `init()` rejects an unsupported auth kind. |
| 5,6,7 | `stream()` emits exactly one `end` event, as the LAST event, with a valid `finishReason`. |
| 8 | Tokens stream incrementally (≥ 2 chunks for a non-trivial response). |
| 9 | Pre-fired `AbortSignal` yields `end(aborted)` within 500ms. |
| 10 | Mid-stream abort prevents any pending `toolCall` from firing. |
| 11 | Tool-capable request yields a well-formed `toolCall` event (id, name, arguments all present). |
| 12 | Every `toolCallStart` precedes its matching `toolCall` for the same id. (Skipped if `emitsToolCallStart: false`.) |
| 13 | `appendToolResult` produces a history that re-streams without throwing. |
| 14 | `appendToolResult` is deterministic for the same inputs. |
| 15 | `listAvailableModels()` returns a non-empty list. |
| 16 | Non-tool-capable model with tools declared either fails fast or runs without tool calls. (Skipped if no non-tool model in manifest.) |
| 17 | System prompt is present in the upstream request. |
| 18 | Empty messages array is rejected with a clear error. |
| 19 | Multi-turn conversation (4+ messages) is preserved in the upstream request. |
| 20 | `vendorRaw` on an assistant message round-trips through the next request. |
| 21 | `appendAssistantToolCall` populates `vendorRaw` so the same adapter accepts the turn back on a subsequent `stream()` call. |

## Tips

- **Don't normalize history shapes lossily**. Use `message.vendorRaw` as your escape hatch for vendor-native representations (content blocks, function call parts, etc.). The library's `Message.content: string | ContentBlock[]` is a convenience for simple cases, not a requirement.
- **Tool-call id synthesis**. Some vendors (Google Gemini) don't give tool calls a stable id. Synthesize one (e.g., `${name}_${Date.now()}_${counter}`) and use it consistently in `appendToolResult`.
- **Fragmented tool-call deltas**. OpenAI streams tool-call arguments as a sequence of string deltas. Accumulate inside the adapter; emit `toolCall` once.
- **Model capability tables.** `max_completion_tokens` vs `max_tokens`, which models support tools, which support vision — the vendor won't tell you automatically. Maintain a lookup or emit warnings for unknown models.
