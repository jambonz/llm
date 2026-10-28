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

function endTurnEvents(): Array<Record<string, unknown>> {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
    { type: 'message_stop' },
  ];
}

function toolUseBlockEvents(index: number, id = 'toolu_think'): Array<Record<string, unknown>> {
  return [
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name: 'get_status', input: {} },
    },
    {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: '{"id":"ES-1"}' },
    },
    { type: 'content_block_stop', index },
  ];
}

/** A thinking block, a redacted one, a text block, then a tool call. */
function thinkingThenToolEvents(): Array<Record<string, unknown>> {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The caller ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'means ES-1.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'redacted_thinking', data: 'opaque' },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Let me check.' } },
    { type: 'content_block_stop', index: 2 },
    ...toolUseBlockEvents(3),
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
    { type: 'message_stop' },
  ];
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
      ['refusal', 'filtered'],
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

  it('merges providerParams into the body (e.g. Claude effort)', async () => {
    mocks.create.mockResolvedValue(mockStream(endTurnEvents()));
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
      providerParams: { output_config: { effort: 'low' } },
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('providerParams is add-only — cannot override library-managed fields', async () => {
    mocks.create.mockResolvedValue(mockStream(endTurnEvents()));
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'claude-haiku-5-5',
      system: 'You are a test agent.',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 300,
      providerParams: {
        model: 'evil',
        stream: false,
        max_tokens: 1,
        system: 'evil',
        thinking: { type: 'disabled' },
      },
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(300);
    expect(body.system).toBe('You are a test agent.');
    expect(body.thinking).toEqual({ type: 'disabled' }); // non-colliding key added
  });

  it('sends no extra fields when providerParams is absent', async () => {
    mocks.create.mockResolvedValue(mockStream(endTurnEvents()));
    const adapter = await buildAdapter();
    await drain(adapter, { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'hi' }] });
    const [body] = mocks.create.mock.calls[0]!;
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
  });

  it('records the turn on toolCall events without emitting thinking as tokens', async () => {
    mocks.create.mockResolvedValue(mockStream(thinkingThenToolEvents()));
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(events.filter((e) => e.type === 'token').map((e) => (e as { text: string }).text)).toEqual([
      'Let me check.',
    ]);
    const toolCall = events.find((e) => e.type === 'toolCall');
    expect(toolCall).toMatchObject({
      id: 'toolu_think',
      vendorRaw: {
        content: [
          { type: 'thinking', thinking: 'The caller means ES-1.', signature: 'sig-1' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'toolu_think', name: 'get_status', input: { id: 'ES-1' } },
        ],
      },
    });
  });

  it('keeps a Haiku 5.5 thinking block whose text is omitted', async () => {
    // Haiku 5.5 omits the thinking text by default: the block arrives with
    // an empty `thinking` and only a signature.
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-5' } },
        { type: 'content_block_stop', index: 0 },
        ...toolUseBlockEvents(1),
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const toolCall = events.find((e) => e.type === 'toolCall') as { vendorRaw: { content: unknown[] } };
    expect(toolCall.vendorRaw.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-5' });
  });

  it('replays thinking ahead of text and tool_use after appendAssistantToolCall', async () => {
    mocks.create.mockResolvedValueOnce(mockStream(thinkingThenToolEvents()));
    const adapter = await buildAdapter();
    const first: PromptRequest = {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const events = await drain(adapter, first);
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    let history = adapter.appendAssistantToolCall(first.messages, toolCalls, 'Let me check.');
    history = adapter.appendToolResult(history, 'toolu_think', { status: 'Faulted' });

    mocks.create.mockResolvedValueOnce(mockStream(endTurnEvents()));
    await drain(adapter, { model: 'claude-haiku-5-5', messages: history });
    const [body] = mocks.create.mock.calls[1]!;
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg.content.map((b: { type: string }) => b.type)).toEqual([
      'thinking',
      'redacted_thinking',
      'text',
      'tool_use',
    ]);
    expect(assistantMsg.content[0]).toEqual({
      type: 'thinking',
      thinking: 'The caller means ES-1.',
      signature: 'sig-1',
    });
  });

  it('retries once without thinking when a replayed block is rejected', async () => {
    mocks.create.mockResolvedValueOnce(mockStream(thinkingThenToolEvents()));
    const adapter = await buildAdapter();
    const first: PromptRequest = {
      model: 'claude-haiku-5-5',
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const toolCalls = (await drain(adapter, first)).filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    let history = adapter.appendAssistantToolCall(first.messages, toolCalls, 'Let me check.');
    history = adapter.appendToolResult(history, 'toolu_think', { status: 'Faulted' });

    // The caller changed the system prompt, so the API rejects the block.
    const rejection = Object.assign(
      new Error('400 messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.'),
      { status: 400 },
    );
    mocks.create.mockRejectedValueOnce(rejection);
    mocks.create.mockResolvedValueOnce(mockStream(endTurnEvents()));
    const events = await drain(adapter, { model: 'claude-haiku-5-5', system: 'Be very brief.', messages: history });

    expect(events.at(-1)).toMatchObject({ type: 'end', finishReason: 'stop' });
    expect(mocks.create).toHaveBeenCalledTimes(3);
    const [retryBody] = mocks.create.mock.calls[2]!;
    const assistantMsg = retryBody.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg.content.map((b: { type: string }) => b.type)).toEqual(['text', 'tool_use']);
    // The caller's history keeps its blocks.
    expect((history[1]!.vendorRaw as { content: unknown[] }).content).toHaveLength(4);
  });

  it('does not retry an unrelated 400', async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('400 max_tokens: too large'), { status: 400 }));
    const adapter = await buildAdapter();
    await expect(
      drain(adapter, { model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrowError(/max_tokens/);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('drops a thinking block that never received its signature', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
        { type: 'content_block_stop', index: 0 },
        ...toolUseBlockEvents(1),
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const toolCall = events.find((e) => e.type === 'toolCall') as { vendorRaw: { content: Array<{ type: string }> } };
    expect(toolCall).toBeDefined();
    expect(toolCall.vendorRaw.content.map((b) => b.type)).toEqual(['tool_use']);
  });

  it('records only the tool_use block when the model did not think', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        ...toolUseBlockEvents(0),
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const toolCall = events.find((e) => e.type === 'toolCall')!;
    expect(toolCall).toMatchObject({
      vendorRaw: { content: [{ type: 'tool_use', id: 'toolu_think', name: 'get_status', input: { id: 'ES-1' } }] },
    });
    const history = adapter.appendAssistantToolCall(
      [{ role: 'user', content: 'hi' }],
      [toolCall as Extract<LlmEvent, { type: 'toolCall' }>],
    );
    expect((history[1]!.vendorRaw as { content: Array<{ type: string }> }).content.map((b) => b.type)).toEqual([
      'tool_use',
    ]);
  });

  it('replays the turn once when it has two tool calls', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-2' } },
        { type: 'content_block_stop', index: 0 },
        ...toolUseBlockEvents(1, 'toolu_a'),
        ...toolUseBlockEvents(2, 'toolu_b'),
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    expect(toolCalls.map((tc) => tc.id)).toEqual(['toolu_a', 'toolu_b']);
    const history = adapter.appendAssistantToolCall([{ role: 'user', content: 'hi' }], toolCalls);
    const content = (history[1]!.vendorRaw as { content: Array<{ type: string; id?: string }> }).content;
    expect(content.map((b) => b.type)).toEqual(['thinking', 'tool_use', 'tool_use']);
    expect(content.map((b) => b.id)).toEqual([undefined, 'toolu_a', 'toolu_b']);
  });

  it('keeps text the model wrote between tool calls in place', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'First one.' } },
        { type: 'content_block_stop', index: 0 },
        ...toolUseBlockEvents(1, 'toolu_a'),
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'And the other.' } },
        { type: 'content_block_stop', index: 2 },
        ...toolUseBlockEvents(3, 'toolu_b'),
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    // The caller's text is the whole stream; the record keeps each piece
    // where the model put it.
    const history = adapter.appendAssistantToolCall(
      [{ role: 'user', content: 'hi' }],
      toolCalls,
      'First one.And the other.',
    );
    const content = (history[1]!.vendorRaw as { content: Array<{ type: string; text?: string }> }).content;
    expect(content.map((b) => b.type)).toEqual(['text', 'tool_use', 'text', 'tool_use']);
    expect(content.map((b) => b.text)).toEqual(['First one.', undefined, 'And the other.', undefined]);
  });

  it('rebuilds the turn from events the caller built by hand', async () => {
    const adapter = await buildAdapter();
    const history = adapter.appendAssistantToolCall(
      [{ role: 'user', content: 'hi' }],
      [{ type: 'toolCall', id: 'toolu_h', name: 'fn', arguments: { a: 1 } }],
      'Looking.',
    );
    expect((history[1]!.vendorRaw as { content: unknown[] }).content).toEqual([
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 'toolu_h', name: 'fn', input: { a: 1 } },
    ]);
  });

  it('leaves temperature out for models that reject it', async () => {
    mocks.create.mockResolvedValue(mockStream(endTurnEvents()));
    const adapter = await buildAdapter();
    for (const [model, sent] of [
      ['claude-haiku-5-5', false],
      ['claude-opus-4-7', false],
      ['claude-sonnet-4-6', true],
      ['claude-haiku-4-5-20251001', true],
    ] as const) {
      await drain(adapter, { model, messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 });
      const [body] = mocks.create.mock.calls.at(-1)!;
      expect(body.model).toBe(model);
      expect('temperature' in body).toBe(sent);
      if (sent) expect(body.temperature).toBe(0.7);
    }
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

  // -----------------------------------------------------------------------
  // vendorMetadata extraction from response headers
  // -----------------------------------------------------------------------

  it('extracts request-id and ratelimit headers into vendorMetadata', async () => {
    const streamObj = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_start', message: { usage: { input_tokens: 10 } } };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        };
        yield { type: 'message_stop' };
      },
    };
    const fakeApiPromise = {
      withResponse: async () => ({
        data: streamObj,
        response: {
          headers: new Headers({
            'request-id': 'req_anthropic_xyz',
            'anthropic-ratelimit-requests-remaining': '49',
            'anthropic-ratelimit-input-tokens-remaining': '99000',
            'anthropic-ratelimit-output-tokens-remaining': '24500',
          }),
        },
      }),
      then: (onFulfilled: (s: typeof streamObj) => unknown) =>
        Promise.resolve(streamObj).then(onFulfilled),
    };
    mocks.create.mockReturnValueOnce(fakeApiPromise);

    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const end = events.find((e) => e.type === 'end') as Extract<
      LlmEvent,
      { type: 'end' }
    >;
    expect(end.vendorMetadata).toEqual({
      request_id: 'req_anthropic_xyz',
      requests_remaining: 49,
      input_tokens_remaining: 99000,
      output_tokens_remaining: 24500,
    });
  });
});
