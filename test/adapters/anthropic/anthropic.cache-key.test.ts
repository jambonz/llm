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

// ---------------------------------------------------------------------------
// Helpers — copied verbatim from anthropic.wire.test.ts conventions
// ---------------------------------------------------------------------------

function minimalStream(): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
      yield { type: 'message_stop' };
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

// Two tools so that "only last tool gets cache_control" is actually distinguishable
// from "all tools get cache_control".
const TWO_TOOLS: PromptRequest['tools'] = [
  {
    name: 'lookup_order',
    description: 'Find an order by id',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an order by id',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

const SYSTEM_PROMPT = 'You are a helpful assistant.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Anthropic adapter — cache_control injection (cacheKey)', () => {
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

  // -------------------------------------------------------------------------
  // Class 1: cacheKey present + system + tools (≥2)
  // -------------------------------------------------------------------------
  it(
    'cacheKey present: system becomes array with ephemeral block carrying exact text; only last tool has cache_control',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());
      const adapter = await buildAdapter();

      await drain(adapter, {
        model: 'claude-sonnet-4-6',
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'hello' }],
        tools: TWO_TOOLS,
        cacheKey: 'session-abc-123',
      });

      const body = mocks.create.mock.calls[0]![0] as Record<string, unknown>;

      // system must be an array (not a plain string)
      expect(Array.isArray(body.system)).toBe(true);

      const systemArray = body.system as Array<Record<string, unknown>>;
      expect(systemArray).toHaveLength(1);

      // Exact shape: type:'text', the exact text, cache_control ephemeral
      expect(systemArray[0]).toEqual({
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      });

      const tools = body.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(2);

      // Non-last tool must NOT have cache_control
      expect(Object.prototype.hasOwnProperty.call(tools[0], 'cache_control')).toBe(false);

      // Last tool must have cache_control: { type: 'ephemeral' }
      expect(tools[1]!.cache_control).toEqual({ type: 'ephemeral' });
    },
    3000,
  );

  // -------------------------------------------------------------------------
  // Class 2: cacheKey absent — body is unchanged
  // -------------------------------------------------------------------------
  it(
    'cacheKey absent: system stays a plain string and no tool carries cache_control',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());
      const adapter = await buildAdapter();

      await drain(adapter, {
        model: 'claude-sonnet-4-6',
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'hello' }],
        tools: TWO_TOOLS,
        // cacheKey intentionally omitted
      });

      const body = mocks.create.mock.calls[0]![0] as Record<string, unknown>;

      // system must be the original plain string
      expect(typeof body.system).toBe('string');
      expect(body.system).toBe(SYSTEM_PROMPT);

      // No tool may carry a cache_control property
      const tools = body.tools as Array<Record<string, unknown>>;
      for (const tool of tools) {
        expect(Object.prototype.hasOwnProperty.call(tool, 'cache_control')).toBe(false);
      }
    },
    3000,
  );

  // -------------------------------------------------------------------------
  // Class 3: cacheKey present but NO system and NO tools — must not throw
  // -------------------------------------------------------------------------
  it(
    'cacheKey present but no system and no tools: stream drains without throwing',
    async () => {
      mocks.create.mockResolvedValue(minimalStream());
      const adapter = await buildAdapter();

      // Should not throw
      const events = await drain(adapter, {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        cacheKey: 'session-xyz',
        // no system, no tools
      });

      // Stream must complete and emit at least an end event
      const endEvent = events.find((e) => e.type === 'end');
      expect(endEvent).toBeDefined();

      const body = mocks.create.mock.calls[0]![0] as Record<string, unknown>;

      // No system key, or if present it must not be a non-empty array of blocks
      if (body.system !== undefined) {
        // If adapter sets system at all with no system prompt it should be
        // either undefined/absent or an empty value — not an array with blocks.
        expect(Array.isArray(body.system) ? (body.system as unknown[]).length : 0).toBe(0);
      }

      // No tools array with cache_control blocks
      if (Array.isArray(body.tools)) {
        for (const tool of body.tools as Array<Record<string, unknown>>) {
          expect(Object.prototype.hasOwnProperty.call(tool, 'cache_control')).toBe(false);
        }
      }
    },
    3000,
  );
});
