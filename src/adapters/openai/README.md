# openai

Adapter for OpenAI's native chat-completions API, plus any OpenAI-compatible endpoint (DeepSeek — see [`factory.ts`](./factory.ts) for the DeepSeek alias, LM Studio, Ollama, vLLM, self-hosted gateways).

This is the **reference adapter**. The streaming helpers in [`_streaming.ts`](./_streaming.ts) are shared with [`vertex-openai`](../vertex-openai/). When in doubt about wire shape or event flow, this is the one to read first.

## Mental model

OpenAI's Chat Completions API is the *de facto* standard for LLM wire protocols — enough vendors clone it that we can reuse the same SDK (`openai` npm package) across multiple adapters with only auth + `baseURL` differing. This adapter is essentially:

- `new OpenAI({apiKey, baseURL?})` for the client
- `streamFromOpenAI(client, req)` for wire translation

Anything non-OpenAI specific lives in `_streaming.ts`.

## Auth

`apiKey` only. Optional `baseURL` lets operators point at compatible endpoints (DeepSeek's `https://api.deepseek.com/v1`, a local Ollama on `http://localhost:11434/v1`, etc.).

## Quirks worth knowing

### Tool-call arguments arrive fragmented

OpenAI streams `tool_calls[].function.arguments` as multiple delta chunks (not whole JSON strings). The shared streaming helper accumulates by `index` and emits one `toolCall` event per tool once `finish_reason: 'tool_calls'` arrives.

### Reasoning models (o1, o3) have different capabilities

`streaming: false`, `tools: false`, `systemPrompt: false`. The manifest's `knownModels` table flags these; the `defaultCapabilitiesForUnknown()` helper applies the same rule via regex (`^o[13]([-/]|$)`) so a user-provided `o3-preview-…` id maps to the right defaults without a manifest release.

### No `stream_options.include_usage` for third-party endpoints

OpenAI's native API honors `stream_options: { include_usage: true }` to send a final usage chunk; many compatible endpoints 400 on unknown options. The shared helper has `includeStreamOptions` controlled by the caller — native OpenAI leaves it on (default), vertex-openai sets it off.

### SDK 6.x drops gzipped 4xx bodies

Error bodies that arrive with `Content-Encoding: gzip` are silently dropped by the OpenAI SDK, leaving `error.message = "NNN status code (no body)"`. This bit us hard on Vertex-OpenAI (see that adapter's README). Native OpenAI rarely gzip-compresses errors so we don't intercept here, but if a compatible backend starts doing it, copy vertex-openai's `surfaceErrorBody` pattern.

## `testCredential()`

Calls `client.models.list()` — cheapest authenticated GET, no token cost, works against any OpenAI-compatible backend that honors `/v1/models`.

## Shared code path

[`_streaming.ts`](./_streaming.ts) is imported by [`../vertex-openai/adapter.ts`](../vertex-openai/adapter.ts). Changes here affect both. If a change is OpenAI-specific (not applicable to Vertex's OpenAI-compat endpoint), do it in the adapter, not the helper.

## Models

See [`manifest.ts`](./manifest.ts). Update `knownModels` when OpenAI ships or deprecates a model. `knownModels[0]` is the probe-model default for any operator tooling that needs one — keep a widely-accessible model there (currently `gpt-4o`).
