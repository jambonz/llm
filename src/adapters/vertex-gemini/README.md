# vertex-gemini

Adapter for Gemini models on Vertex AI. For Gemini via the AI Studio API, use [`google`](../google/). For third-party models on Vertex (Llama, Mistral), use [`vertex-openai`](../vertex-openai/).

## Mental model

Uses the `@google/genai` SDK in **Vertex mode** — same wire translation as the `google` adapter, but authenticated with a service account and scoped to a GCP project + region. All wire code is shared via [`../google/_streaming.ts`](../google/_streaming.ts); this adapter only differs in client construction.

## Auth

`vertexServiceAccount` only:

- `credentials` (service-account JSON, uploaded as a file in the webapp)
- `projectId` (GCP project id)
- `location` (GCP region — `us-central1` is the safe default)

The SDK takes the service-account JSON as `googleAuthOptions.credentials` and handles token minting internally.

## Wire

Same as [google adapter](../google/README.md) — Gemini `contents`/`parts` shape, synthesized tool-call ids, `vendorRaw` round-trip for tool cycles.

## Quirks worth knowing

### `listAvailableModels` returns the manifest curated list

Vertex's model catalog includes many models that Gemini's API won't actually serve through this SDK. Rather than filter, we return the curated `knownModels` from the manifest — it's more operator-friendly than a 40-entry dropdown of half-working ids.

### Regional availability

Most Gemini models run in most regions the manifest advertises. Newer previews are sometimes region-limited (typically us-central1 first). If a specific model 404s, try us-central1.

### The `GEMINI_API_KEY` env-var warning

If api-server has `GEMINI_API_KEY` / `GOOGLE_API_KEY` set in its environment **and** an operator uploads service-account credentials, the `@google/genai` SDK logs a `console.debug`:

> The user provided Google Cloud credentials will take precedence over the API key from the environment variable.

Harmless — the SDK is noting it's doing the right thing (explicit creds win over ambient env). If it's noisy in logs, unset the env var when you only need service-account auth.

## `testCredential()`

Calls `listGeminiModels()` — authenticated via the service-account bearer, no chat call required. Success means the SA credentials are valid and the project has Vertex API enabled.

## Models

See [`manifest.ts`](./manifest.ts).
