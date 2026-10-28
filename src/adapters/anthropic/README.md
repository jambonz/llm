# anthropic

Adapter for Anthropic's native Messages API (Claude models).

## Mental model

Anthropic's wire shape differs from OpenAI's in four ways that matter:

1. **System prompt is top-level**, not a role. Pass `system: "..."` as a request parameter; don't put `{role: 'system', ...}` in the messages array — Anthropic rejects it.
2. **`max_tokens` is required.** The adapter defaults to 4096 if the caller doesn't set one (there is no reasonable "unlimited" default like OpenAI has).
3. **Tool calls are content blocks**, not a separate `tool_calls` array. An assistant turn with tools looks like `{role: 'assistant', content: [{type: 'tool_use', id, name, input}]}`.
4. **Tool results are delivered as a user message** with a `tool_result` content block: `{role: 'user', content: [{type: 'tool_result', tool_use_id, content}]}`. The library normalizes this to `role: 'tool'` with the native shape stashed in `vendorRaw`.

## Auth

`apiKey` only.

## Streaming event model

Server-sent events; each event is typed:

```
message_start → (content_block_start → content_block_delta* → content_block_stop)+ → message_delta → message_stop
```

A streaming tool call arrives as one or more `content_block_start {type: 'tool_use'}` events followed by `content_block_delta {partial_json: '...'}` chunks. The adapter accumulates `partial_json` per content block and emits one `toolCall` event per block when `content_block_stop` fires.

## Quirks worth knowing

### `vendorRaw` is load-bearing

Assistant turns that contain tool_use blocks cannot be trivially re-serialized from the library's normalized `Message` shape — content is an array, not a string. `appendAssistantToolCall()` writes the wire shape into `vendorRaw`; `buildWireMessages()` reads it back verbatim on the next request. Without this, the next turn loses the tool_use block and Anthropic returns 400 `"tool_result without matching tool_use"`.

### A tool-call turn is replayed as the model wrote it

The Claude 5 models (Haiku 5.5 included) think by default, and the thinking counts toward `max_tokens`. The adapter never emits thinking as `token` events, but it records the turn's content blocks — `thinking` / `redacted_thinking` (with their signatures), text and `tool_use`, in order — and attaches the record to every `toolCall` event as `vendorRaw: {content: [...]}`. `appendAssistantToolCall()` replays it: thinking keeps its place, and so does text the model wrote between tool calls. Only the `tool_use` blocks passed back stay in, and the `assistantText` argument is used when the record has no text of its own. Without the thinking blocks the request still succeeds, but the model reasons the turn out again after the tool result: slower, and on a small `max_tokens` the reply gets cut off. Callers that rebuild tool-call events instead of passing them through lose the record and get that behavior back.

A replayed thinking block is bound to everything sent before it (`system`, `tools`, earlier messages). When the caller changes that prefix — a new system prompt, a different tool set, summarized history — the API rejects the block with a 400 on accounts that enforce the check (by default, accounts created on or after 2026-08-31). The adapter then retries the request once with every `thinking` / `redacted_thinking` block removed, so the turn runs without that reasoning instead of failing. The caller's history keeps its blocks, so later requests in the same conversation repeat the 400 and the retry, one extra round trip each turn.

Known limit: a turn that thinks and then answers in text, with no tool call, has no event to carry its blocks, and the caller builds that assistant message itself. Its thinking is not replayed on later turns.

### `providerParams`

Merged into the request body add-only, as in the OpenAI-compatible adapters. The usual one is `{output_config: {effort: 'low'}}`, which keeps a voice agent's thinking short on models that think by default. Haiku 5.5 (and Opus 5) also accept `thinking: {type: 'disabled'}` at effort `high` or below; Opus 5.5 and Sonnet 5.5 reject it at any effort.

### Sampling parameters

Opus 4.7 and every Claude model since (Opus 4.8 and 5.x, Sonnet 5.x, Haiku 5.5, Fable, Mythos) return 400 on a non-default `temperature`, `top_p` or `top_k`. The adapter leaves `temperature` out of requests to those models rather than fail every call; steer them from the prompt. Earlier models still get it.

### `finishReason` mapping

Anthropic's `stop_reason` is string-typed with values `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `refusal`, etc. The adapter maps to the library's `FinishReason` union. `tool_use` → `tool`, `max_tokens` → `length`, `refusal` → `filtered`.

### Abort behavior

Anthropic's SDK honors `AbortSignal` on its streaming iterator — passing `req.signal` straight through to `messages.stream({signal})` is enough. No custom polling needed.

## `testCredential()`

Calls `client.models.list()` — cheapest authenticated GET. Anthropic's `/v1/models` is free to hit.

## Models

See [`manifest.ts`](./manifest.ts). Anthropic versions models via date-suffixed ids (`claude-sonnet-4-5-20250929`). Keep the list current; Anthropic typically sunsets older versions ~6 months after a replacement ships.
