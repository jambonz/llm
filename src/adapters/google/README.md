# google

Adapter for Google Gemini via the AI Studio / Generative Language API (the public `generativelanguage.googleapis.com` endpoint). For Gemini on Vertex AI, use [`vertex-gemini`](../vertex-gemini/) instead.

## Mental model

Uses the `@google/genai` SDK in "non-Vertex" mode. The SDK handles SSE parsing and retries; this adapter handles wire translation between the library's normalized shape and Gemini's `contents`/`parts` shape.

Wire translation lives in [`_streaming.ts`](./_streaming.ts), shared with [`vertex-gemini`](../vertex-gemini/). The two adapters only differ in client construction (API key vs. service account + Vertex project/location).

## Auth

`googleApiKey` only. (Service-account auth is available via Vertex; that's the `vertex-gemini` adapter.)

## Wire translation — what's different from OpenAI/Anthropic

### Role naming

Library's `role: 'assistant'` → Gemini's `role: 'model'`. `role: 'user'` stays `user`. `role: 'tool'` does not exist in Gemini; tool results are user-role messages with `functionResponse` parts.

### Content is an array of parts

Every message has `parts: [...]` — text parts (`{text}`), function-call parts (`{functionCall: {name, args}}`), function-response parts (`{functionResponse: {name, response}}`). Library's simple string content is wrapped in `[{text: '...'}]` on the wire.

### System prompt is `config.systemInstruction`, not a message

Prepend with `{parts: [{text: systemPrompt}]}` and pass as the top-level `config.systemInstruction`. A handful of older Gemini models don't support it — the manifest's per-model `systemPrompt` capability flag signals that.

## Quirks worth knowing

### Tool-call IDs are synthesized, not returned

Gemini's `functionCall` parts carry a `name` but **no id**. Multi-tool conversations would be ambiguous, so the adapter synthesizes stable ids per stream: first call to `get_weather` → `get_weather`, second → `get_weather#1`, etc. `appendToolResult()` parses the id back to a bare name when emitting the `functionResponse`.

### `vendorRaw` round-trip for tool cycles

Similar to Anthropic: the assistant turn with a `functionCall` part and the user turn with a `functionResponse` part both store their native wire shapes in `vendorRaw`. The next `stream()` reads them back unchanged.

### Abort

The SDK's streaming iterator honors `AbortSignal` — pass `req.signal` through. No polling needed.

## `testCredential()`

Calls `listGeminiModels()` (the same helper `listAvailableModels()` uses). Authenticated GET, zero model tokens consumed.

## Models

See [`manifest.ts`](./manifest.ts). Google sometimes gates models behind waitlists or regional availability — the manifest's curated list is "what a typical Studio API key can access"; specific projects may see more or fewer via `listAvailableModels()`.
