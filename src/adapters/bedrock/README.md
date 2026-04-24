# bedrock

Adapter for AWS Bedrock via the **Converse** API (streaming: `ConverseStream`). Supports Anthropic Claude, Amazon Nova, Meta Llama, Mistral, AI21, Cohere — anything Bedrock exposes through the unified Converse interface.

## Mental model

Bedrock Converse is its own wire shape, distinct from OpenAI and Anthropic's native APIs. All three major wire concerns are different:

- **Messages** use `{role, content: [ContentBlock, ...]}` with content **always** an array.
- **System prompt** is `system: [{text}]` at the top level (also an array).
- **Tools** go in `toolConfig: {tools: [{toolSpec: {name, description, inputSchema: {json}}}]}`.

Streaming events are likewise structured:

```
messageStart → (contentBlockStart → contentBlockDelta* → contentBlockStop)+ → messageStop → metadata
```

## Auth

Two modes:

- **`bedrockApiKey`** — a Bedrock bearer token (new; recommended for simple deployments). The adapter sets `config.authSchemePreference = ['httpBearerAuth']` to make the bearer win over any ambient SigV4 credentials (e.g., EC2 instance role).
- **`bedrockIam`** — IAM access key + secret key (+ optional session token). Standard AWS SigV4 auth.

Both require `region`. See the manifest for the curated region list.

## Quirks worth knowing

### Content blocks always an array

Unlike OpenAI (where `content: "string"` is fine), Bedrock rejects string-typed content. The library's normalized `content: "hello"` is wrapped in `[{text: "hello"}]` on the wire. Assistant turns with tools round-trip via `vendorRaw` to preserve block ordering.

### Tool-use id is `toolUseId`

Not `id` (OpenAI), not the synthesized name-based id (Gemini). Bedrock's own id is returned as `toolUseId` and must be echoed back as `toolUseId` in the `toolResult` block on the next turn.

### Conversation ordering is validated

Bedrock's service rejects:
- Messages that don't alternate user/assistant (two consecutive user or assistant turns).
- `tool_result` in a message that doesn't directly follow the matching `tool_use`.

The adapter does not pre-validate — it's the caller's responsibility to keep history well-ordered. If you see a 400 with "invalid message ordering", check history mutation in the caller.

### Tool-call arguments arrive as delta string fragments

Similar to OpenAI — the `contentBlockDelta {toolUse: {input: '...'}}` chunks accumulate into a JSON string the adapter parses once on `contentBlockStop`.

### Region and model availability vary independently

A model-id in the manifest may or may not be accessible to a given account in a given region. The `deprecated: true` flag signals models AWS has started flagging **LEGACY** (ResourceNotFoundException on 30-day-unused accounts — see [manifest.ts](./manifest.ts) header comment). For cross-region inference profiles (Claude 4.x), the manifest includes the `us.` prefix; operators in EU/APAC must edit to `eu.`/`apac.`.

## `testCredential()`

Uses the **control-plane** client (`@aws-sdk/client-bedrock`, not the runtime client) with `ListFoundationModelsCommand`. Authenticates via the same config as the runtime client. Bedrock's only cheap authenticated probe; works regardless of which specific models the account has granted.

## Models

See [`manifest.ts`](./manifest.ts) — the header comment there explains the `deprecated` flag and the `us.`/`eu.`/`apac.` inference-profile convention.

Drift checker: [`scripts/check-bedrock-models.ts`](../../../scripts/check-bedrock-models.ts) compares the manifest against AWS's live lifecycle data weekly (GitHub Action) and opens a PR when drift is detected. Bedrock is the only vendor with structured deprecation data, which is why it gets its own drift checker.
