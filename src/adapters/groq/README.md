# groq

Adapter for **Groq** — ultra-low-latency inference for open-weight models (Llama 3.x/3.3, Gemma) on custom LPU hardware. Not for `api.openai.com`; not for HuggingFace's hosted inference. Use this adapter when a customer wants the fastest possible TTFT for a voice agent and is fine with a Llama-class model rather than GPT-4o/Claude.

## Mental model

Groq's chat-completions endpoint is OpenAI-wire-compatible — same request shape, same streaming SSE, same tool-call format. So this adapter:

- Reuses the OpenAI SDK (`openai` npm package).
- Reuses every byte of wire translation from [`../openai/_streaming.ts`](../openai/_streaming.ts) — one code path, multiple adapters.
- Overrides only `baseURL`. Auth is `Authorization: Bearer <key>` like OpenAI; the SDK handles it from `apiKey`.

If something is broken here and it's not in the "Quirks" list below, look in `_streaming.ts` first.

## Auth

`apiKey` only. Get one from [https://console.groq.com/keys](https://console.groq.com/keys).

The `baseURL` field on the manifest is exposed but defaults to `https://api.groq.com/openai/v1`. Customers should leave it alone unless they're routing through a corporate proxy.

## Why customers pick Groq

**Voice latency.** Groq runs Llama 3.x/3.3 and Gemma on LPU silicon and gets ~5–10× the tokens/sec of GPU-backed providers. For a real-time voice agent, that means sub-200ms TTFT and faster inter-token cadence — the assistant feels noticeably more responsive than the same agent on `gpt-4o`. This is the entire reason the adapter exists.

The tradeoff: Groq's catalog is open-weight Llama / Gemma — capable but not GPT-5 / Claude-tier on hard reasoning. Pick Groq for "look up the order, read it back" voice agents; stick with Anthropic / OpenAI / Bedrock for complex reasoning.

## Models

See [`manifest.ts`](./manifest.ts) for the curated `knownModels`. Conservative on purpose — Groq's catalog churns rapidly (preview models come and go), and the manifest is shipped to webapp clients via `/LlmVendors/manifest`. The list includes:

- `llama-3.3-70b-versatile` — current top-quality general-purpose, tool-capable
- `llama-3.1-8b-instant` — cheapest and fastest, tool-capable
- `gemma2-9b-it` — alternative

The full live catalog (including vision, safety classifiers, preview models) is returned by `listAvailableModels()` which hits `/openai/v1/models` with the same API key.

## Unsupported OpenAI parameters

Per [Groq's OpenAI compatibility doc](https://console.groq.com/docs/openai), the following are 400-level errors on Groq:

- `logprobs`
- `top_logprobs`
- `logit_bias`
- `messages[].name`
- `n` ≠ 1

`@jambonz/llm` doesn't send any of these, so no special handling is required. Listed here in case a future feature adds one — it'll need to be guarded for Groq.

## Quirks we've hit

None yet.
