# _template

Scaffolding for adding a new vendor adapter. **Not registered** at runtime — only the contract test-kit uses it to prove the kit can detect incomplete implementations.

## Adding a new vendor

See [`docs/adding-a-vendor.md`](../../../docs/adding-a-vendor.md) for the full step-by-step. Short version:

```bash
cp -r src/adapters/_template src/adapters/<your-vendor>
```

Then:

1. Rename the class and factory in [`adapter.ts`](./adapter.ts) / [`factory.ts`](./factory.ts).
2. Fill in [`manifest.ts`](./manifest.ts) — `vendor`, `displayName`, `authKinds[]`, `knownModels[]`.
3. Implement every method on `LlmAdapter` — the stubs throw "not implemented" on purpose. The contract test-kit will fail on each one and guide you through.
4. Add a line in [`../index.ts`](../index.ts) registering the factory.
5. Write a test harness in `test/adapters/<your-vendor>/_mock-<vendor>.ts` (copy an existing adapter's for scaffolding).
6. Run the contract suite. When it's green, open a PR.

## What to study first

Pick the existing adapter closest to your vendor's wire shape:

- **OpenAI-compatible endpoint** (Ollama, vLLM, a new proxy) → copy [`openai`](../openai/) and override only `baseURL` + auth.
- **Native Messages-style API** → study [`anthropic`](../anthropic/) — similar patterns for system-top-level, content-block tool shapes.
- **AWS SDK-style** (command/response, not fetch) → study [`bedrock`](../bedrock/).
- **Google genai SDK** → study [`google`](../google/) — `parts` arrays and synthesized tool-call ids.

## What the stub is teaching you

The stub is deliberately empty to force contributors through the right mental path:

- `init()` — don't do network calls here. Just construct the SDK client and validate auth shape.
- `stream()` — the wire translation core. Read [`openai/_streaming.ts`](../openai/_streaming.ts) for a reference implementation.
- `appendAssistantToolCall` / `appendToolResult` — vendor-native history shapes. Use `vendorRaw` for anything that can't be trivially re-serialized from the library's normalized `Message`.
- `listAvailableModels` — if the vendor has a `/models` endpoint, wrap it; if not, return the manifest's `knownModels` and set `supportsModelListing: false` in the manifest.
- `testCredential` — cheapest authenticated call. See each existing adapter's README for the specific choice. **Do not** reach for a stream probe against a specific model; that couples auth validation to model grants.

## Contract test-kit

[`src/test-kit/runner.ts`](../../test-kit/runner.ts) runs ~20 checks per adapter. A merge-ready PR passes them all. The kit uses mock SDK responses; it does not hit real vendor APIs.
