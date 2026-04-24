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

### `finishReason` mapping

Anthropic's `stop_reason` is string-typed with values `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `refusal`, etc. The adapter maps to the library's `FinishReason` union. `tool_use` → `tool`, `max_tokens` → `length`, `refusal` → `filtered`.

### Abort behavior

Anthropic's SDK honors `AbortSignal` on its streaming iterator — passing `req.signal` straight through to `messages.stream({signal})` is enough. No custom polling needed.

## `testCredential()`

Calls `client.models.list()` — cheapest authenticated GET. Anthropic's `/v1/models` is free to hit.

## Models

See [`manifest.ts`](./manifest.ts). Anthropic versions models via date-suffixed ids (`claude-sonnet-4-5-20250929`). Keep the list current; Anthropic typically sunsets older versions ~6 months after a replacement ships.
