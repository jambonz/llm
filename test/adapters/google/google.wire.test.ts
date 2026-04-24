import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContentStream: mocks.generateContentStream,
      list: mocks.modelsList,
    };
    constructor(_opts: unknown) {
      // no-op
    }
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

import { createLlm } from '../../../src/index.js';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../../../src/registry.js';
import { googleFactory } from '../../../src/adapters/google/index.js';
import type { LlmAdapter, LlmEvent, PromptRequest } from '../../../src/types.js';

function mockStream(chunks: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

async function drain(adapter: LlmAdapter, req: PromptRequest): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of adapter.stream(req)) out.push(e);
  return out;
}

async function buildAdapter(): Promise<LlmAdapter> {
  return createLlm({ vendor: 'google', auth: { kind: 'googleApiKey', apiKey: 'AIza-test' } });
}

describe('Google Gemini adapter — wire format', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(googleFactory);
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    mocks.generateContentStream.mockReset();
    mocks.modelsList.mockReset();
  });

  it('places system prompt in config.systemInstruction (not in contents)', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([
        { candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] },
        { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }] },
      ]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gemini-2.5-flash',
      system: 'You are a test agent.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [arg] = mocks.generateContentStream.mock.calls[0]!;
    expect(arg.config.systemInstruction).toEqual({
      parts: [{ text: 'You are a test agent.' }],
    });
    expect(arg.contents.every((c: { role: string }) => c.role !== 'system')).toBe(true);
  });

  it('maps assistant role to Gemini model role in contents', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([{ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' },
      ],
    });
    const [arg] = mocks.generateContentStream.mock.calls[0]!;
    expect(arg.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
      { role: 'user', parts: [{ text: 'bye' }] },
    ]);
  });

  it('wraps tools in functionDeclarations and preserves JSON schema as parameters', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([{ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }]),
    );
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: 'gemini-2.5-flash',
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
    const [arg] = mocks.generateContentStream.mock.calls[0]!;
    expect(arg.config.tools).toEqual([
      {
        functionDeclarations: [
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
      },
    ]);
  });

  it('emits a fully-accumulated toolCall with args from functionCall.args', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'do_thing',
                      args: { city: 'NYC' },
                    },
                  },
                ],
              },
            },
          ],
        },
        { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'weather' }],
      tools: [{ name: 'do_thing', description: 'x', parameters: { type: 'object' } }],
    });
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('do_thing');
    expect(toolCalls[0]!.arguments).toEqual({ city: 'NYC' });
    // Gemini has no id — adapter synthesises one; the first call uses the
    // bare name, subsequent calls append #N.
    expect(toolCalls[0]!.id).toBe('do_thing');
  });

  it('synthesises distinct ids for multiple calls to the same tool', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'lookup', args: { q: 'a' } } },
                  { functionCall: { name: 'lookup', args: { q: 'b' } } },
                ],
              },
            },
          ],
        },
        { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'lookup', description: 'x', parameters: { type: 'object' } }],
    });
    const ids = events
      .filter((e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall')
      .map((e) => e.id);
    expect(ids).toEqual(['lookup', 'lookup#1']);
  });

  it('maps finishReason values to FinishReason union', async () => {
    for (const [raw, expected] of [
      ['STOP', 'stop'],
      ['MAX_TOKENS', 'length'],
      ['SAFETY', 'filtered'],
      ['RECITATION', 'filtered'],
    ] as const) {
      mocks.generateContentStream.mockResolvedValueOnce(
        mockStream([
          { candidates: [{ content: { parts: [] }, finishReason: raw }] },
        ]),
      );
      const adapter = await buildAdapter();
      const events = await drain(adapter, {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'x' }],
      });
      const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
      expect(end.finishReason).toBe(expected);
      expect(end.rawReason).toBe(raw);
    }
  });

  it('reports usage from usageMetadata', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([
        {
          candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 17, totalTokenCount: 59 },
        },
      ]),
    );
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
    });
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.usage).toEqual({ inputTokens: 42, outputTokens: 17, totalTokens: 59 });
  });

  it('appendToolResult returns a functionResponse part with the right name', async () => {
    const adapter = await buildAdapter();
    const history: Parameters<typeof adapter.appendToolResult>[0] = [
      { role: 'user', content: 'x' },
    ];
    const updated = adapter.appendToolResult(history, 'get_weather', { ok: true });
    expect(updated[1]!.role).toBe('tool');
    expect(updated[1]!.vendorRaw).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'get_weather',
            response: { result: '{"ok":true}' },
          },
        },
      ],
    });
  });

  it('appendToolResult strips #counter suffix when parsing tool name', async () => {
    const adapter = await buildAdapter();
    const updated = adapter.appendToolResult(
      [{ role: 'user', content: 'x' }],
      'get_weather#3',
      'sunny',
    );
    const vendorRaw = updated[1]!.vendorRaw as {
      parts: Array<{ functionResponse: { name: string } }>;
    };
    expect(vendorRaw.parts[0]!.functionResponse.name).toBe('get_weather');
  });

  it('preserves vendorRaw on re-submission (assistant functionCall + user functionResponse)', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([{ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }]),
    );
    const adapter = await buildAdapter();
    const history = [
      { role: 'user' as const, content: 'first' },
      {
        role: 'assistant' as const,
        content: '',
        vendorRaw: {
          role: 'model',
          parts: [{ functionCall: { name: 'fn', args: {} } }],
        },
      },
      {
        role: 'tool' as const,
        content: 'result',
        vendorRaw: {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'fn',
                response: { result: 'result' },
              },
            },
          ],
        },
      },
      { role: 'user' as const, content: 'second' },
    ];
    await drain(adapter, { model: 'gemini-2.5-flash', messages: history });
    const [arg] = mocks.generateContentStream.mock.calls[0]!;
    const modelMsg = arg.contents.find((c: { role: string }) => c.role === 'model');
    expect(modelMsg.parts[0].functionCall.name).toBe('fn');
    const toolMsg = arg.contents.find(
      (c: { role: string; parts: Array<{ functionResponse?: unknown }> }) =>
        c.role === 'user' && c.parts[0]?.functionResponse,
    );
    expect(toolMsg).toBeDefined();
  });

  it('converts AbortError into end(aborted)', async () => {
    const err = new Error('aborted');
    (err as Error & { name: string }).name = 'AbortError';
    mocks.generateContentStream.mockRejectedValue(err);
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect((events[0] as Extract<LlmEvent, { type: 'end' }>).finishReason).toBe('aborted');
  });

  it('propagates non-abort errors from the SDK', async () => {
    mocks.generateContentStream.mockRejectedValue(new Error('quota exceeded'));
    const adapter = await buildAdapter();
    await expect(
      drain(adapter, {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/quota exceeded/);
  });

  it('passes AbortSignal through config.abortSignal', async () => {
    mocks.generateContentStream.mockResolvedValue(
      mockStream([{ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }]),
    );
    const adapter = await buildAdapter();
    const controller = new AbortController();
    await drain(adapter, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
      signal: controller.signal,
    });
    const [arg] = mocks.generateContentStream.mock.calls[0]!;
    expect(arg.config.abortSignal).toBe(controller.signal);
  });

  it('listAvailableModels strips the models/ prefix and merges capabilities', async () => {
    mocks.modelsList.mockImplementation(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' };
        yield { name: 'models/gemini-future-9000', displayName: 'Gemini Future' };
      },
    }));
    const adapter = await buildAdapter();
    const models = await adapter.listAvailableModels();
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe('gemini-2.5-pro');
    expect(models[0]!.capabilities.maxContextTokens).toBe(1_000_000);
    expect(models[1]!.id).toBe('gemini-future-9000');
    expect(models[1]!.capabilities.tools).toBe(true);
  });
});
