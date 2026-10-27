# openrouter

Adapter for **OpenRouter** — one API key and one endpoint in front of ~450 models from Anthropic, OpenAI, Google, Meta, DeepSeek, Qwen, Mistral, xAI and others. Model ids are `<org>/<model>` (e.g. `anthropic/claude-haiku-5.5`, `openai/gpt-5.4-mini`).

## Mental model

OpenRouter's chat-completions endpoint is OpenAI-wire-compatible, so this adapter subclasses `OpenAIAdapter`, defaults `baseURL` to `https://openrouter.ai/api/v1`, and reuses all wire translation from [`../openai/_streaming.ts`](../openai/_streaming.ts). Auth is `Authorization: Bearer <key>`.

## Why not just the OpenAI vendor with a Base URL?

That works for streaming, but:

- **Credential test.** OpenRouter's `/models` is public — it returns 200 for any key, so the OpenAI adapter's `models.list()` probe accepts a bogus key. This adapter probes `GET /key`, which returns 401 for a bad key.
- **Model listing.** `/models` carries real capability metadata (`supported_parameters`, `architecture.input_modalities`, `context_length`); this adapter uses it instead of guessing by id, and drops `:batch` variants (async-only) and models that don't output text.
- **Diagnostics.** `x-generation-id` is surfaced as `vendorMetadata.request_id` — the id OpenRouter support asks for.
- **Attribution.** Every request sends `HTTP-Referer: https://jambonz.org` and `X-OpenRouter-Title: jambonz`, crediting the traffic to jambonz on OpenRouter's app rankings and model pages. It does not affect routing, pricing or rate limits.

## Prompt caching

- Anthropic models (`anthropic/...`): with `req.cacheKey` set, a top-level `cache_control: {type: 'ephemeral'}` is added (OpenRouter's automatic caching). This lives in `OpenAIAdapter`, keyed on an openrouter.ai `baseURL`, so OpenAI-vendor credentials pointed at OpenRouter get it too.
- `prompt_cache_key` is forwarded (verified accepted); OpenAI-family upstreams use it.
- Usage reports `cached_tokens` / `cache_write_tokens`, mapped to `cacheReadTokens` / `cacheWriteTokens`.

## Quirks

- Mid-stream failures arrive as a 200 SSE chunk with a top-level `error` and `finish_reason: "error"`; the shared streaming code throws on the top-level `error`.
- The final usage chunk has a non-empty `choices` array repeating `finish_reason` — harmless.
- OpenRouter adds a network hop in front of the upstream provider; expect somewhat higher TTFT than calling the provider directly.
- Provider routing (`provider`), fallback lists (`models`) and plugins are not set by the adapter; callers can send them through `req.providerParams`. Routing suffixes on the model id (`:nitro`, `:floor`) work as-is.
