# @jambonz/llm

A voice-oriented LLM adapter library for Node.js.

`@jambonz/llm` provides a uniform, vendor-neutral interface for streaming chat completions from large language models — with first-class support for tool calls, `AbortSignal`-based interruption, and lossless conversation-history round-tripping. It is the LLM layer that powers jambonz voice agents, but the library itself has no voice-specific dependencies and can be used from any Node.js application.

## Design goals

1. **A small, well-defined interface for adding new vendors.** Implement one adapter class plus a manifest, register it, and the contract test-kit tells you whether you're done.
2. **Caller-owned conversation history.** The library is stateless across calls. Barge-in, history trimming, speculative preflight, and other voice-specific concerns are implemented by the caller, not the library.
3. **Lossless history round-trip.** Vendor-native message shapes (Anthropic content blocks, OpenAI `tool_calls` arrays, Google `parts`, Bedrock `content[]`) are preserved via an opaque `vendorRaw` escape hatch.
4. **Community-friendly contribution.** A new vendor is a single directory under `src/adapters/`, plus a line in `src/adapters/index.ts`.

## Contributing

New vendor adapters are the primary contribution path. See [docs/adding-a-vendor.md](docs/adding-a-vendor.md) for the step-by-step guide — copy the template, fill in the adapter, run the contract test-kit. A PR is merge-ready when all contract-kit checks pass against the new adapter and the build is green.

## Status

Under active development. API may change before `1.0.0`.

## License

MIT
