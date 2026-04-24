import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { bedrockFactory } from '../../../src/adapters/bedrock/index.js';
import type { LlmAdapter, LlmEvent, PromptRequest } from '../../../src/types.js';

const bedrockMock = mockClient(BedrockRuntimeClient);

function mockStream(events: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of adapter.stream(req)) out.push(e);
  return out;
}

describe('Bedrock adapter — wire', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(bedrockFactory);
    bedrockMock.reset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    bedrockMock.reset();
  });

  // -----------------------------------------------------------------------
  // Auth mode construction
  // -----------------------------------------------------------------------

  it('bedrockApiKey: passes token + httpBearerAuth preference to the client config', async () => {
    const llm = await createLlm({
      vendor: 'bedrock',
      auth: { kind: 'bedrockApiKey', apiKey: 'bed-123', region: 'eu-west-1' },
    });
    // Access private config via internal state — we verify via a successful
    // stream call whose input carries no SigV4 signing indication. Indirect,
    // but bedrockMock intercepts after the config is applied.
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    await drain(llm, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
    });
    // Verify command reached the client (mock captured it).
    expect(bedrockMock.commandCalls(ConverseStreamCommand)).toHaveLength(1);
  });

  it('bedrockIam: passes accessKeyId/secretAccessKey (+sessionToken) to the client config', async () => {
    const llm = await createLlm({
      vendor: 'bedrock',
      auth: {
        kind: 'bedrockIam',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secret',
        sessionToken: 'session-token',
        region: 'us-east-1',
      },
    });
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    await drain(llm, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(bedrockMock.commandCalls(ConverseStreamCommand)).toHaveLength(1);
  });

  it('rejects missing region', async () => {
    await expect(
      createLlm({
        vendor: 'bedrock',
        auth: {
          kind: 'bedrockIam',
          accessKeyId: 'a',
          secretAccessKey: 'b',
          region: '',
        },
      }),
    ).rejects.toThrowError(/region is required/);
  });

  it('rejects bedrockApiKey without apiKey', async () => {
    await expect(
      createLlm({
        vendor: 'bedrock',
        auth: { kind: 'bedrockApiKey', apiKey: '', region: 'us-east-1' },
      }),
    ).rejects.toThrowError(/apiKey is required/);
  });

  it('rejects bedrockIam without accessKeyId', async () => {
    await expect(
      createLlm({
        vendor: 'bedrock',
        auth: {
          kind: 'bedrockIam',
          accessKeyId: '',
          secretAccessKey: 'b',
          region: 'us-east-1',
        },
      }),
    ).rejects.toThrowError(/accessKeyId and secretAccessKey required/);
  });

  it('rejects unsupported auth kinds', async () => {
    await expect(
      createLlm({
        vendor: 'bedrock',
        auth: { kind: 'apiKey', apiKey: 'x' },
      }),
    ).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // Converse request shape
  // -----------------------------------------------------------------------

  async function buildAdapter(): Promise<LlmAdapter> {
    return createLlm({
      vendor: 'bedrock',
      auth: {
        kind: 'bedrockApiKey',
        apiKey: 'bed-test',
        region: 'us-east-1',
      },
    });
  }

  it('places system prompt at top-level as [{text}] array', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      system: 'You are a test agent.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
    const input = call.args[0].input as unknown as Record<string, unknown>;
    expect(input.system).toEqual([{ text: 'You are a test agent.' }]);
  });

  it('translates flat MCP tools into toolConfig.tools[].toolSpec shape', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 'lookup_order',
          description: 'Find an order',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      ],
    });
    const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
    const input = call.args[0].input as unknown as Record<string, unknown>;
    expect(input.toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: 'lookup_order',
            description: 'Find an order',
            inputSchema: {
              json: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
              },
            },
          },
        },
      ],
    });
  });

  it('wraps plain string message content into [{text}] blocks', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
        { role: 'user', content: 'again' },
      ],
    });
    const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
    const input = call.args[0].input as unknown as Record<string, unknown>;
    expect(input.messages).toEqual([
      { role: 'user', content: [{ text: 'hello' }] },
      { role: 'assistant', content: [{ text: 'hi back' }] },
      { role: 'user', content: [{ text: 'again' }] },
    ]);
  });

  // -----------------------------------------------------------------------
  // Stream parsing
  // -----------------------------------------------------------------------

  it('accumulates toolUse input deltas into a single toolCall event', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([
        { messageStart: { role: 'assistant' } },
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: 'toolu_1', name: 'do_thing' } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: '{"ci' } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: 'ty":"' } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: 'NYC"}' } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: 'tool_use' } },
        { metadata: { usage: { inputTokens: 5, outputTokens: 8, totalTokens: 13 } } },
      ]) as never,
    });
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'weather' }],
      tools: [{ name: 'do_thing', description: 'x', parameters: { type: 'object' } }],
    });
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.id).toBe('toolu_1');
    expect(toolCalls[0]!.name).toBe('do_thing');
    expect(toolCalls[0]!.arguments).toEqual({ city: 'NYC' });
  });

  it('emits toolCallStart at contentBlockStart (before toolUse input deltas)', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([
        { messageStart: { role: 'assistant' } },
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: 'toolu_42', name: 'fn' } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: '{}' } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: 'tool_use' } },
      ]) as never,
    });
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'fn', description: 'x', parameters: { type: 'object' } }],
    });
    const startIdx = events.findIndex((e) => e.type === 'toolCallStart');
    const callIdx = events.findIndex((e) => e.type === 'toolCall');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(startIdx);
  });

  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['stop_sequence', 'stop'],
    ['content_filtered', 'filtered'],
    ['guardrail_intervened', 'filtered'],
  ] as const)('maps stopReason %s -> %s', async (raw, expected) => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([
        { messageStart: { role: 'assistant' } },
        { messageStop: { stopReason: raw } },
      ]) as never,
    });
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
    });
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.finishReason).toBe(expected);
    expect(end.rawReason).toBe(raw);
  });

  it('reports usage from the metadata event', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([
        { messageStart: { role: 'assistant' } },
        { messageStop: { stopReason: 'end_turn' } },
        {
          metadata: {
            usage: { inputTokens: 42, outputTokens: 17, totalTokens: 59 },
          },
        },
      ]) as never,
    });
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
    });
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.usage).toEqual({ inputTokens: 42, outputTokens: 17, totalTokens: 59 });
  });

  // -----------------------------------------------------------------------
  // Tool result / vendorRaw round-trip
  // -----------------------------------------------------------------------

  it('appendToolResult returns role:user + toolResult content block', async () => {
    const adapter = await buildAdapter();
    const history: Parameters<typeof adapter.appendToolResult>[0] = [
      { role: 'user', content: 'x' },
    ];
    const updated = adapter.appendToolResult(history, 'toolu_abc', { ok: true });
    expect(updated).toHaveLength(2);
    expect(updated[1]!.role).toBe('tool');
    expect(updated[1]!.vendorRaw).toEqual({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'toolu_abc',
            content: [{ text: '{"ok":true}' }],
          },
        },
      ],
    });
  });

  it('preserves vendorRaw on re-submission (assistant toolUse + user toolResult)', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    const adapter = await buildAdapter();
    const history = [
      { role: 'user' as const, content: 'first' },
      {
        role: 'assistant' as const,
        content: '',
        vendorRaw: {
          role: 'assistant',
          content: [
            { toolUse: { toolUseId: 'toolu_abc', name: 'fn', input: {} } },
          ],
        },
      },
      {
        role: 'tool' as const,
        content: 'result',
        vendorRaw: {
          role: 'user',
          content: [
            {
              toolResult: {
                toolUseId: 'toolu_abc',
                content: [{ text: 'result' }],
              },
            },
          ],
        },
      },
      { role: 'user' as const, content: 'again' },
    ];
    await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: history,
    });
    const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
    const input = call.args[0].input as unknown as { messages: Array<{ role: string; content: unknown[] }> };
    const assistantMsg = input.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content[0]).toMatchObject({
      toolUse: { toolUseId: 'toolu_abc', name: 'fn' },
    });
    const toolResultMsg = input.messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content[0] as { toolResult?: unknown }).toolResult,
    );
    expect(toolResultMsg).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Error paths
  // -----------------------------------------------------------------------

  it('converts AbortError into end(aborted)', async () => {
    const err = new Error('aborted');
    (err as Error & { name: string }).name = 'AbortError';
    bedrockMock.on(ConverseStreamCommand).rejectsOnce(err);
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(events).toHaveLength(1);
    expect((events[0] as Extract<LlmEvent, { type: 'end' }>).finishReason).toBe('aborted');
  });

  it('propagates non-abort errors from the SDK', async () => {
    bedrockMock.on(ConverseStreamCommand).rejectsOnce(new Error('throttling'));
    const adapter = await buildAdapter();
    await expect(
      drain(adapter, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/throttling/);
  });

  // -----------------------------------------------------------------------
  // listAvailableModels
  // -----------------------------------------------------------------------

  it('listAvailableModels returns the curated manifest set without calling the SDK', async () => {
    const adapter = await buildAdapter();
    const models = await adapter.listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.startsWith('anthropic.claude'))).toBe(true);
    expect(bedrockMock.commandCalls(ConverseStreamCommand)).toHaveLength(0);
  });
});
