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

// ---------------------------------------------------------------------------
// Shared test infra — mirrors bedrock.wire.test.ts exactly
// ---------------------------------------------------------------------------

const bedrockMock = mockClient(BedrockRuntimeClient);

function mockStream(
  events: Array<Record<string, unknown>>,
): AsyncIterable<Record<string, unknown>> {
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

const MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

const MINIMAL_STREAM = mockStream([{ messageStop: { stopReason: 'end_turn' } }]);

const CACHE_POINT = { cachePoint: { type: 'default' } };

// ---------------------------------------------------------------------------
// Helper — build a fresh authenticated adapter
// ---------------------------------------------------------------------------

async function buildAdapter(): Promise<LlmAdapter> {
  return createLlm({
    vendor: 'bedrock',
    auth: { kind: 'bedrockApiKey', apiKey: 'bed-test', region: 'us-east-1' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bedrock adapter — cacheKey → cachePoint injection', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(bedrockFactory);
    bedrockMock.reset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    bedrockMock.reset();
  });

  // -------------------------------------------------------------------------
  // Class 1: cacheKey present + system + tools
  // Contract: cachePoint is the LAST element of input.system AND the LAST
  // element of input.toolConfig.tools; the real text block and tool spec
  // are present BEFORE it.
  // Production bug caught: adapter silently ignores cacheKey, or appends
  // cachePoint to the wrong position, or drops the real content.
  // -------------------------------------------------------------------------
  it(
    'appends cachePoint as last element of system and toolConfig.tools when cacheKey is present',
    async () => {
      bedrockMock.on(ConverseStreamCommand).resolvesOnce({
        stream: MINIMAL_STREAM as never,
      });

      const adapter = await buildAdapter();
      await drain(adapter, {
        model: MODEL,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'session-abc',
        tools: [
          {
            name: 'lookup_order',
            description: 'Find an order by ID',
            parameters: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          },
          {
            name: 'get_status',
            description: 'Get order status',
            parameters: {
              type: 'object',
              properties: { orderId: { type: 'string' } },
              required: ['orderId'],
            },
          },
        ],
      });

      const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
      const input = call.args[0].input as unknown as Record<string, unknown>;

      // --- system array ---
      const system = input.system as Array<unknown>;
      expect(Array.isArray(system)).toBe(true);
      // Last element must be the cachePoint
      expect(system[system.length - 1]).toEqual(CACHE_POINT);
      // An earlier element must be the text block
      expect(system.some((el) => (el as Record<string, unknown>).text === 'You are a helpful assistant.')).toBe(true);
      // The text block must appear BEFORE the cachePoint (not after)
      const textIdx = system.findIndex(
        (el) => (el as Record<string, unknown>).text === 'You are a helpful assistant.',
      );
      expect(textIdx).toBeGreaterThanOrEqual(0);
      expect(textIdx).toBeLessThan(system.length - 1);

      // --- toolConfig.tools array ---
      const toolConfig = input.toolConfig as Record<string, unknown>;
      const tools = toolConfig.tools as Array<unknown>;
      expect(Array.isArray(tools)).toBe(true);
      // Last element must be the cachePoint
      expect(tools[tools.length - 1]).toEqual(CACHE_POINT);
      // The real tool specs must be present before the cachePoint
      const toolSpecNames = tools
        .slice(0, tools.length - 1)
        .map((t) => {
          const entry = t as Record<string, unknown>;
          const spec = entry.toolSpec as Record<string, unknown> | undefined;
          return spec?.name;
        });
      expect(toolSpecNames).toContain('lookup_order');
      expect(toolSpecNames).toContain('get_status');
    },
    5000,
  );

  // -------------------------------------------------------------------------
  // Class 2: cacheKey ABSENT (undefined)
  // Contract: no cachePoint element appears anywhere in system or toolConfig.tools.
  // Production bug caught: adapter always appends cachePoint regardless of
  // cacheKey presence, incorrectly polluting uncached requests.
  // -------------------------------------------------------------------------
  it(
    'does NOT append any cachePoint when cacheKey is absent',
    async () => {
      bedrockMock.on(ConverseStreamCommand).resolvesOnce({
        stream: MINIMAL_STREAM as never,
      });

      const adapter = await buildAdapter();
      await drain(adapter, {
        model: MODEL,
        system: 'You are a plain assistant.',
        messages: [{ role: 'user', content: 'hi' }],
        // cacheKey intentionally omitted
        tools: [
          {
            name: 'do_thing',
            description: 'Does a thing',
            parameters: { type: 'object' },
          },
        ],
      });

      const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
      const input = call.args[0].input as unknown as Record<string, unknown>;

      // system must contain only plain {text} blocks — no cachePoint
      const system = input.system as Array<unknown>;
      expect(Array.isArray(system)).toBe(true);
      const hasSystemCachePoint = system.some(
        (el) => (el as Record<string, unknown>).cachePoint !== undefined,
      );
      expect(hasSystemCachePoint).toBe(false);

      // toolConfig.tools must contain only toolSpec objects — no cachePoint
      const toolConfig = input.toolConfig as Record<string, unknown>;
      const tools = toolConfig.tools as Array<unknown>;
      expect(Array.isArray(tools)).toBe(true);
      const hasToolsCachePoint = tools.some(
        (el) => (el as Record<string, unknown>).cachePoint !== undefined,
      );
      expect(hasToolsCachePoint).toBe(false);
    },
    5000,
  );

  // -------------------------------------------------------------------------
  // Class 3: cacheKey present + NO system + NO tools
  // Contract: stream() must not throw; no cachePoint is added (there is nothing
  // to attach it to). Drains to at least one event (end event).
  // Production bug caught: adapter crashes or throws when cacheKey is set but
  // system/tools are both absent (undefined).
  // -------------------------------------------------------------------------
  it(
    'does not throw and drains cleanly when cacheKey is present but system and tools are absent',
    async () => {
      bedrockMock.on(ConverseStreamCommand).resolvesOnce({
        stream: MINIMAL_STREAM as never,
      });

      const adapter = await buildAdapter();
      const events = await drain(adapter, {
        model: MODEL,
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'no-system-no-tools',
        // system: absent
        // tools: absent
      });

      // Must have produced at least an end event — proves no crash
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1]!.type).toBe('end');

      // The command input must have no cachePoint anywhere
      const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
      const input = call.args[0].input as unknown as Record<string, unknown>;

      // system may be undefined or an array — if array, no cachePoint
      if (Array.isArray(input.system)) {
        const hasSystemCachePoint = (input.system as Array<unknown>).some(
          (el) => (el as Record<string, unknown>).cachePoint !== undefined,
        );
        expect(hasSystemCachePoint).toBe(false);
      }

      // toolConfig may be undefined — if present, no cachePoint in tools
      if (input.toolConfig !== undefined) {
        const toolConfig = input.toolConfig as Record<string, unknown>;
        if (Array.isArray(toolConfig.tools)) {
          const hasToolsCachePoint = (toolConfig.tools as Array<unknown>).some(
            (el) => (el as Record<string, unknown>).cachePoint !== undefined,
          );
          expect(hasToolsCachePoint).toBe(false);
        }
      }
    },
    5000,
  );
});

// ---------------------------------------------------------------------------
// Conversation-history cache point + cache-token usage normalization
// ---------------------------------------------------------------------------

describe('Bedrock adapter — history cache point and cache-token usage', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    registerAdapter(bedrockFactory);
    bedrockMock.reset();
  });

  afterEach(() => {
    _resetRegistryForTests();
    bedrockMock.reset();
  });

  it('cacheKey present: cachePoint appended to the last message content; earlier messages and history untouched', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([{ messageStop: { stopReason: 'end_turn' } }]) as never,
    });
    // A tool_result turn as produced by appendToolResult().
    const vendorRaw = {
      role: 'user',
      content: [{ toolResult: { toolUseId: 'tool-1', content: [{ text: 'shipped' }] } }],
    };
    const adapter = await buildAdapter();
    await drain(adapter, {
      model: MODEL,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'tool', content: 'shipped', vendorRaw },
      ],
      cacheKey: 'session-abc',
    });

    const call = bedrockMock.commandCalls(ConverseStreamCommand)[0]!;
    const input = call.args[0].input as unknown as Record<string, unknown>;
    const wire = input.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;

    // Earlier message untouched
    expect(wire[0]).toEqual({ role: 'user', content: [{ text: 'hi' }] });

    // Last message: original block preserved, cachePoint appended after it
    const lastContent = wire[1]!.content;
    expect(lastContent).toHaveLength(2);
    expect(lastContent[0]).toEqual({
      toolResult: { toolUseId: 'tool-1', content: [{ text: 'shipped' }] },
    });
    expect(lastContent[1]).toEqual(CACHE_POINT);

    // The history object must NOT accumulate the cache point: a persisted
    // block would add one per turn until the service's 4-point limit
    // rejects the request outright.
    expect(vendorRaw.content).toHaveLength(1);
  });

  it('normalizes Converse cache-token usage fields onto the end event', async () => {
    bedrockMock.on(ConverseStreamCommand).resolvesOnce({
      stream: mockStream([
        { messageStop: { stopReason: 'end_turn' } },
        {
          metadata: {
            usage: {
              inputTokens: 12,
              outputTokens: 7,
              totalTokens: 959,
              cacheReadInputTokens: 900,
              cacheWriteInputTokens: 40,
            },
          },
        },
      ]) as never,
    });
    const adapter = await buildAdapter();
    const events = await drain(adapter, {
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      cacheKey: 'session-abc',
    });
    const end = events.find((e) => e.type === 'end') as Extract<LlmEvent, { type: 'end' }>;
    expect(end.usage).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 959,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
    });
  });
});
