import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mocks.create };
    models = { list: mocks.modelsList };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { default: MockAnthropic };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { anthropicFactory } from '../../../src/adapters/anthropic/index.js';
import type { LlmAdapter, LlmEvent, PromptRequest } from '../../../src/types.js';

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

async function buildAdapter(): Promise<LlmAdapter> {
  return createLlm({ vendor: 'anthropic', auth: { kind: 'apiKey', apiKey: 'sk-ant-test' } });
}

describe('Anthropic adapter — wire format', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(anthropicFactory);
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  it('places system prompt at top-level, not in messages', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'claude-sonnet-4-6',
      system: 'You are a test agent.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.system).toBe('You are a test agent.');
    expect(body.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
  });

  it('always sets max_tokens (defaults to 4096 if not provided)', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_tokens).toBe(4096);
  });

  it('respects caller-provided maxTokens', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 200,
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_tokens).toBe(200);
  });

  it('translates flat MCP tools into Anthropic {name, description, input_schema} shape', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'claude-sonnet-4-6',
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
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.tools).toEqual([
      {
        name: 'lookup_order',
        description: 'Find an order',
        input_schema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    ]);
  });

  it('accumulates input_json_delta fragments into a single toolCall event', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 5 } } },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'do_thing',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"ci' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: 'ty":"' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: 'NYC"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'weather' }],
      tools: [
        { name: 'do_thing', description: 'x', parameters: { type: 'object' } },
      ],
    });
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.id).toBe('toolu_1');
    expect(toolCalls[0]!.name).toBe('do_thing');
    expect(toolCalls[0]!.arguments).toEqual({ city: 'NYC' });
  });

  it('emits toolCallStart at content_block_start (before input deltas)', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_42', name: 'fn', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'fn', description: 'x', parameters: { type: 'object' } }],
    });
    const startIdx = events.findIndex((e) => e.type === 'toolCallStart');
    const callIdx = events.findIndex((e) => e.type === 'toolCall');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(startIdx);
  });

  it('maps stop_reason values to FinishReason union', async () => {
    for (const [raw, expected] of [
      ['end_turn', 'stop'],
      ['max_tokens', 'length'],
      ['stop_sequence', 'stop'],
    ] as const) {
      mocks.create.mockResolvedValueOnce(
        mockStream([
          { type: 'message_start', message: { usage: { input_tokens: 1 } } },
          { type: 'message_delta', delta: { stop_reason: raw }, usage: { output_tokens: 0 } },
          { type: 'message_stop' },
        ]),
      );
      const adapter = await buildAdapter();
      const events = await drain(adapter, {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'x' }],
      });
      const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
      expect(end.finishReason).toBe(expected);
      expect(end.rawReason).toBe(raw);
    }
  });

  it('reports usage with input_tokens from message_start and output_tokens from message_delta', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 42 } } },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 17 },
        },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'x' }],
    });
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.usage).toEqual({ inputTokens: 42, outputTokens: 17, totalTokens: 59 });
  });

  it('appendToolResult returns role:user + tool_result content block (not role:tool)', async () => {
    const adapter = await buildAdapter();
    const history: Parameters<typeof adapter.appendToolResult>[0] = [
      { role: 'user', content: 'x' },
    ];
    const updated = adapter.appendToolResult(history, 'toolu_abc', { ok: true });
    expect(updated).toHaveLength(2);
    // Normalized form presented to callers — role 'tool' so downstream helpers
    // can distinguish tool messages from regular user turns.
    expect(updated[1]!.role).toBe('tool');
    // The vendor-native wire form uses role:'user' with a tool_result block.
    expect(updated[1]!.vendorRaw).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_abc',
          content: '{"ok":true}',
        },
      ],
    });
  });

  it('preserves vendorRaw on re-submission (assistant tool_use + user tool_result)', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const history = [
      { role: 'user' as const, content: 'first' },
      {
        role: 'assistant' as const,
        content: '',
        vendorRaw: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_abc', name: 'fn', input: {} }],
        },
      },
      {
        role: 'tool' as const,
        content: 'result',
        vendorRaw: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_abc',
              content: 'result',
            },
          ],
        },
      },
      { role: 'user' as const, content: 'second' },
    ];
    await drain(adapter, { model: 'claude-sonnet-4-6', messages: history });
    const [body] = mocks.create.mock.calls[0]!;
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content[0]).toMatchObject({ type: 'tool_use', id: 'toolu_abc' });
    // Tool result is carried as a user-role message with a tool_result block.
    const toolResultUser = body.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type?: string }>)[0]?.type === 'tool_result',
    );
    expect(toolResultUser).toBeDefined();
    expect(toolResultUser.content[0].tool_use_id).toBe('toolu_abc');
  });

  it('converts AbortError into end(aborted)', async () => {
    const err = new Error('aborted');
    (err as Error & { name: string }).name = 'AbortError';
    mocks.create.mockRejectedValue(err);
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(events).toHaveLength(1);
    expect((events[0] as Extract<LlmEvent, { type: 'end' }>).finishReason).toBe('aborted');
  });

  it('propagates non-abort errors from the SDK', async () => {
    mocks.create.mockRejectedValue(new Error('auth failed'));
    const adapter = await buildAdapter();
    await expect(
      drain(adapter, {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/auth failed/);
  });

  it('listAvailableModels merges capabilities from the known-models manifest', async () => {
    mocks.modelsList.mockResolvedValue({
      data: [
        { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' },
        { id: 'claude-future-9000', display_name: 'Claude Future' },
      ],
    });
    const adapter = await buildAdapter();
    const models = await adapter.listAvailableModels();
    expect(models).toHaveLength(2);
    const opus = models.find((m) => m.id === 'claude-opus-4-7');
    expect(opus?.capabilities.tools).toBe(true);
    expect(opus?.capabilities.maxContextTokens).toBe(200_000);
    const future = models.find((m) => m.id === 'claude-future-9000');
    expect(future?.capabilities.tools).toBe(true); // default for Claude
  });
});
