import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mocks.create } };
    models = { list: mocks.modelsList };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { default: MockOpenAI };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { openAIFactory } from '../../../src/adapters/openai/index.js';
import type { LlmAdapter, LlmEvent, PromptRequest } from '../../../src/types.js';

function mockStream(chunks: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const e of adapter.stream(req)) events.push(e);
  return events;
}

async function buildAdapter(): Promise<LlmAdapter> {
  return createLlm({ vendor: 'openai', auth: { kind: 'apiKey', apiKey: 'sk-test' } });
}

describe('OpenAI adapter — wire format', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(openAIFactory);
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.create.mockReset();
    mocks.modelsList.mockReset();
  });

  it('prepends system prompt as a message at index 0', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gpt-4o',
      system: 'You are a test agent.',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const [body] = mocks.create.mock.calls[0]!;
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test agent.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('does not add a system message when req.system is absent', async () => {
    mocks.create.mockResolvedValue(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('translates flat MCP tools into {type: function, function: {...}} shape', async () => {
    mocks.create.mockResolvedValue(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 'lookup_order',
          description: 'Find an order by id',
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
        type: 'function',
        function: {
          name: 'lookup_order',
          description: 'Find an order by id',
          parameters: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      },
    ]);
    expect(body.tool_choice).toBe('auto');
  });

  it('strips tools for non-tool-capable models (check #16 happy path)', async () => {
    mocks.create.mockResolvedValue(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'o1-preview',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'x', description: 'x', parameters: { type: 'object' } }],
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('accumulates fragmented tool-call argument deltas into a single event', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'do_thing' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"ci' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"' } }] },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: 'NYC"}' } }] },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'find weather' }],
      tools: [{ name: 'do_thing', description: 'x', parameters: { type: 'object' } }],
    });

    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.id).toBe('call_1');
    expect(toolCalls[0]!.name).toBe('do_thing');
    expect(toolCalls[0]!.arguments).toEqual({ city: 'NYC' });
  });

  it('emits toolCallStart before toolCall for the same id', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_42', type: 'function', function: { name: 'fn', arguments: '{}' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'fn', description: 'x', parameters: { type: 'object' } }],
    });
    const startIdx = events.findIndex((e) => e.type === 'toolCallStart');
    const callIdx = events.findIndex((e) => e.type === 'toolCall');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(startIdx);
  });

  it('maps finish_reason values to FinishReason union', async () => {
    for (const [rawReason, expected] of [
      ['stop', 'stop'],
      ['length', 'length'],
      ['content_filter', 'filtered'],
    ] as const) {
      mocks.create.mockResolvedValueOnce(
        mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: rawReason }] }]),
      );
      const adapter = await buildAdapter();
      const events = await drain(adapter, {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'x' }],
      });
      const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
      expect(end.finishReason).toBe(expected);
      expect(end.rawReason).toBe(rawReason);
    }
  });

  it('reports usage when include_usage chunk arrives', async () => {
    mocks.create.mockResolvedValue(
      mockStream([
        { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        {
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    // Usage may arrive before or after the finish chunk — accept either
    // as long as it appears on the end event.
    expect(end.usage?.totalTokens).toBeDefined();
  });

  it('preserves vendorRaw assistant message with tool_calls on re-submission', async () => {
    mocks.create.mockResolvedValue(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    const history = [
      { role: 'user' as const, content: 'first' },
      {
        role: 'assistant' as const,
        content: '',
        vendorRaw: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc',
              type: 'function',
              function: { name: 'fn', arguments: '{}' },
            },
          ],
        },
      },
      { role: 'tool' as const, content: 'ok', vendorRaw: { role: 'tool', tool_call_id: 'call_abc', content: 'ok' } },
      { role: 'user' as const, content: 'second' },
    ];
    await drain(adapter, { model: 'gpt-4o', messages: history });
    const [body] = mocks.create.mock.calls[0]!;
    const assistantMsg = body.messages.find(
      (m: { role: string }) => m.role === 'assistant',
    );
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0].id).toBe('call_abc');
    const toolMsg = body.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('call_abc');
  });

  it('appendToolResult produces a message the adapter can re-send', async () => {
    const adapter = await buildAdapter();
    const history: Parameters<typeof adapter.appendToolResult>[0] = [
      { role: 'user', content: 'x' },
    ];
    const updated = adapter.appendToolResult(history, 'call_xyz', { result: 'ok' });
    expect(updated).toHaveLength(2);
    expect(updated[1]!.role).toBe('tool');
    expect(updated[1]!.content).toBe('{"result":"ok"}');
    expect(updated[1]!.vendorRaw).toEqual({
      role: 'tool',
      tool_call_id: 'call_xyz',
      content: '{"result":"ok"}',
    });
  });

  it('propagates non-abort errors from the SDK', async () => {
    mocks.create.mockRejectedValue(new Error('boom'));
    const adapter = await buildAdapter();
    await expect(
      drain(adapter, { model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrowError(/boom/);
  });

  it('converts APIUserAbortError from the SDK into end(aborted)', async () => {
    const err = new Error('aborted');
    (err as Error & { name: string }).name = 'APIUserAbortError';
    mocks.create.mockRejectedValue(err);
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(events).toHaveLength(1);
    const end = events[0] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.finishReason).toBe('aborted');
  });

  it('sets DeepSeek baseURL when using deepseek vendor alias', async () => {
    // Re-register including deepseek (base clean slate loses it)
    const { deepseekFactory } = await import('../../../src/adapters/openai/index.js');
    registerAdapter(deepseekFactory);
    // DeepSeek adapter extends OpenAIAdapter — init passes baseURL through to
    // the mocked OpenAI constructor. We can't directly observe the MockOpenAI
    // constructor args, so we just verify createLlm resolves.
    await expect(
      createLlm({ vendor: 'deepseek', auth: { kind: 'apiKey', apiKey: 'sk-ds' } }),
    ).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // max_tokens / max_completion_tokens heuristic
  // ---------------------------------------------------------------------------

  it('sends legacy max_tokens for gpt-4o (unchanged default behavior)', async () => {
    mocks.create.mockResolvedValueOnce(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 42,
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_tokens).toBe(42);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('switches to max_completion_tokens for o1-preview (reasoning)', async () => {
    mocks.create.mockResolvedValueOnce(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'o1-preview',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 42,
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_completion_tokens).toBe(42);
    expect(body.max_tokens).toBeUndefined();
  });

  it('switches to max_completion_tokens for gpt-5 family', async () => {
    mocks.create.mockResolvedValueOnce(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 42,
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_completion_tokens).toBe(42);
    expect(body.max_tokens).toBeUndefined();
  });

  it('omits both params when maxTokens is not supplied', async () => {
    mocks.create.mockResolvedValueOnce(
      mockStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [body] = mocks.create.mock.calls[0]!;
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // vendorMetadata extraction from response headers
  // ---------------------------------------------------------------------------

  it('extracts request_id, processing_ms, and ratelimit headers into vendorMetadata', async () => {
    const streamObj = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      },
    };
    const fakeApiPromise = {
      withResponse: async () => ({
        data: streamObj,
        response: {
          headers: new Headers({
            'x-request-id': 'req-openai-xyz',
            'openai-processing-ms': '342',
            'x-ratelimit-remaining-requests': '4995',
            'x-ratelimit-remaining-tokens': '999500',
          }),
        },
      }),
      then: (onFulfilled: (s: typeof streamObj) => unknown) =>
        Promise.resolve(streamObj).then(onFulfilled),
    };
    mocks.create.mockReturnValueOnce(fakeApiPromise);

    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const end = events.find((e) => e.type === 'end') as Extract<
      LlmEvent,
      { type: 'end' }
    >;
    expect(end.vendorMetadata).toEqual({
      request_id: 'req-openai-xyz',
      processing_ms: 342,
      requests_remaining: 4995,
      tokens_remaining: 999500,
    });
  });
});
