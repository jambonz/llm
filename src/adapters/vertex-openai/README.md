# vertex-openai

Adapter for **third-party / partner models on Vertex AI** (Llama, Mistral, etc.) that Google exposes via an OpenAI-compatible endpoint. Not for Gemini — use [`vertex-gemini`](../vertex-gemini/) for those.

## Mental model

Google publishes partner models under a Model-as-a-Service (MaaS) SKU and fronts them with an OpenAI-compatible chat-completions endpoint. From the client's perspective it looks almost exactly like OpenAI, so this adapter:

- Reuses the OpenAI SDK (`openai` npm package).
- Reuses wire translation from [`../openai/_streaming.ts`](../openai/_streaming.ts). One code path, two adapters.
- Overrides only the bits Vertex needs: `baseURL`, auth, and a few defaults to paper over MaaS-specific quirks.

If something is broken here and it's not in the "Quirks" list below, look in `_streaming.ts` first — it's shared with `openai`.

## Auth

`vertexServiceAccount` only. Adapter:

1. Constructs a `GoogleAuth` client with `cloud-platform` scope from the service-account JSON.
2. Wraps `fetch` to mint a fresh access token on every request and inject `Authorization: Bearer <token>`. This is simpler than caching — google-auth-library caches internally.
3. Passes the wrapped `fetch` to the OpenAI SDK via its `fetch` option.

`apiKey` on the OpenAI client is the string `'vertex-ai'` — never actually sent, but the SDK requires *something*.

## Endpoint

```
https://{LOCATION}-aiplatform.googleapis.com/v1beta1/projects/{PROJECT}/locations/{LOCATION}/endpoints/openapi
```

**Path is `/v1beta1/`, not `/v1/`.** The `/v1/` variant returns 404. This is not documented prominently — the Google Cloud sample notebooks use `/v1beta1/` so that's the source of truth.

## Quirks we've hit

### Llama MaaS returns an empty reply when `max_tokens` is omitted

Symptom: HTTP 200, single chunk like:

```json
{"choices":[{"delta":{"content":"","role":"assistant"},"finish_reason":"stop"}]}
data: [DONE]
```

…immediately followed by end-of-stream. The caller sees a successful call with zero tokens, which in a voice-agent context means "the assistant said nothing."

Workaround (in [`adapter.ts`](./adapter.ts)): we pass `defaultMaxTokens: 4096` to `streamFromOpenAI`. If the caller provides `maxTokens`, their value wins.

Google's own Python Colab examples always set `max_tokens` explicitly — that's effectively undocumented guidance to do the same.

### Intermittent HTTP 400s on Llama MaaS

We've observed ~40% first-attempt 400-rate on `meta/llama-4-scout-17b-16e-instruct-maas` with:

```json
{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}
```

No body details, no correlation with headers, payload, or timing — identical requests alternate between 200 and 400 within the same second. Reproduced with raw `fetch` (no SDK in the loop), so it's a Vertex-side flake, not ours.

**We do not retry on 400** because (a) the OpenAI SDK's `maxRetries` doesn't cover 400 and (b) a real 400 (malformed request) should surface to the caller, not loop. feature-server handles this at the Agent layer: on any LLM error it terminates the Agent verb, writes an `LLM_FAILURE` alert, and runs the `actionHook` — so the caller (human or app) can retry the turn.

If the error rate becomes a UX problem, the narrow fix is a 400-retry shim here (1–2 retries with short backoff) gated by `error.status === 'INVALID_ARGUMENT'` and a missing error body — *not* a general retry layer.

### `stream_options` is OK on Vertex (verified)

Early hypothesis: Vertex rejects the OpenAI-specific `stream_options: { include_usage: true }` extension. Verified with a probe: Vertex accepts and honors it. We send it unchanged.

## Future: `vertex-anthropic`

Claude is available on Vertex (`claude-*@anthropic`) via Anthropic's SDK with a Vertex-auth shim, not the OpenAI-compatible endpoint. When we add that adapter, it will share `GoogleAuth` wiring with this one — extract a `resolveVertexBearer(auth)` helper at that point. Until then, inlining is fine.

## Models

See [`manifest.ts`](./manifest.ts). The manifest is the source of truth for:

- `knownModels` — curated list with `ModelCapabilities` (tools, streaming, vision, systemPrompt, maxContextTokens).
- `authKinds` — the form schema api-server serves to webapp for the add-credential UI.

Add a new Vertex partner model by appending to `knownModels`. No wire code changes needed unless the vendor introduces a new content-block shape or auth kind.
