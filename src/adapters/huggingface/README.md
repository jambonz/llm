# huggingface

Adapter for **HuggingFace Inference Providers** — a multi-provider broker hosted at `https://router.huggingface.co/v1`. One HF token gets you Llama on Groq, Mistral on Together, Qwen on Fireworks, GLM on Nebius, etc., without setting up multiple direct credentials.

Not for HuggingFace dedicated Inference Endpoints (those are per-customer, per-model deployments — use `vendor: openai` with the endpoint URL as `baseURL`). Not for HuggingFace's older shared Inference API (different wire shape, not OpenAI-compatible). This adapter is specifically for the newer Inference Providers broker that mints OpenAI-shaped responses.

## Mental model

HF Providers is a router. The customer authenticates once with their HF token; HF picks (or honors a hint to pick) the inference shop that hosts the requested model and proxies the request. From the client's perspective:

- Wire is OpenAI-compatible — chat completions, streaming, tools, all standard.
- Auth is `Authorization: Bearer hf_...`.
- The OpenAI SDK works unchanged with `baseURL: https://router.huggingface.co/v1`.

So this adapter is a thin subclass of `OpenAIAdapter` — only `baseURL` differs from the openai vendor.

## Auth

`apiKey` only. Get a token from [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). The Read scope is enough. Tokens look like `hf_...`.

Inference Providers requires a credit balance — HF gives a small free monthly allowance, or you can attach a payment method at [https://huggingface.co/billing](https://huggingface.co/billing). Without credits, requests return 402 Payment Required.

## Why customers pick HF Providers

**Multi-vendor on one account.** A jambonz customer building a voice agent might want to test the same prompt on Llama (Groq for speed), Mistral (Together for cost), and Qwen (Fireworks for context length) — three different providers. Setting up three separate accounts and three jambonz credentials is a lot of friction. HF Providers does it with one credential and a model-name change.

The tradeoff: you don't get the cheapest possible per-token pricing — HF takes a small markup on top of provider rates. For production traffic at scale, going direct to the cheapest provider for each model wins. For prototyping and multi-model testing, HF wins on convenience.

## Model field syntax

Customers pass a canonical HF model id, optionally with a routing hint suffix:

| Form | Behavior |
| --- | --- |
| `meta-llama/Llama-3.3-70B-Instruct` | HF picks a backend (often Groq or Cerebras for fast Llama models). |
| `meta-llama/Llama-3.3-70B-Instruct:fastest` | HF picks the lowest-latency backend at request time. |
| `meta-llama/Llama-3.3-70B-Instruct:fireworks-ai` | Pin Fireworks. |
| `meta-llama/Llama-3.3-70B-Instruct:cerebras` | Pin Cerebras. |
| `meta-llama/Llama-3.3-70B-Instruct:groq` | Pin Groq. |

The `x-inference-provider` response header tells you which backend HF actually served the request. Useful for diagnosing latency anomalies.

## Live evidence (verified during development)

- `meta-llama/Llama-3.3-70B-Instruct` (no suffix) → routed to Groq (`x-inference-provider: groq`) with the response carrying Groq-specific telemetry (`x_groq.id`, region, etc.).
- `meta-llama/Llama-3.3-70B-Instruct:fastest` → also routed to Groq today; the suffix is accepted and dynamic.
- `meta-llama/Llama-3.3-70B-Instruct:cerebras` → 410 Gone with a clear error: `"The requested model is deprecated and no longer supported by provider 'cerebras'."` Provider pinning works for currently-hosted pairs.

## Models

See [`manifest.ts`](./manifest.ts). The curated set is small on purpose — common picks for voice agents (Llama, Mistral, Qwen, DeepSeek). The full live catalog is enormous (hundreds of models across publishers); customers can paste any HF model id and it will work as long as the model is currently routable.

## Quirks we've hit

None yet. Tracking here as they come up.
