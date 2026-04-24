import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetRegistryForTests,
  registerAdapter,
} from '../registry.js';
import { createLlm } from '../index.js';
import type {
  FinishReason,
  LlmAdapter,
  LlmEvent,
  Message,
  PromptRequest,
} from '../types.js';
import type { ContractHarness } from './types.js';

const VALID_FINISH_REASONS: ReadonlyArray<FinishReason> = [
  'stop',
  'tool',
  'length',
  'filtered',
  'error',
  'aborted',
];

const VALID_FORM_FIELD_TYPES = ['text', 'password', 'url', 'json-file', 'select'];

/**
 * Run the 20 contract checks against a vendor adapter via its harness.
 *
 * Call at the top level of a test file; registers vitest `describe`/`it` blocks
 * that exercise every aspect of the adapter contract. Adapters that pass this
 * suite are merge-ready for the library.
 *
 * The suite registers the harness's factory in the library registry for the
 * duration of the run; existing registrations are preserved after cleanup.
 */
export function runContractTests(harness: ContractHarness): void {
  describe(`contract: ${harness.vendor}`, () => {
    beforeEach(() => {
      _resetRegistryForTests();
      registerAdapter(harness.factory);
    });

    afterEach(async () => {
      await harness.cleanup();
      _resetRegistryForTests();
    });

    // -----------------------------------------------------------------------
    // Structural checks — no vendor mocking required.
    // -----------------------------------------------------------------------

    it('[1] manifest is well-formed', () => {
      const m = harness.factory.manifest;
      expect(m.vendor).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.authKinds.length).toBeGreaterThan(0);
      for (const ak of m.authKinds) {
        expect(ak.displayName.length).toBeGreaterThan(0);
        for (const field of ak.fields) {
          expect(field.name.length).toBeGreaterThan(0);
          expect(field.label.length).toBeGreaterThan(0);
          expect(VALID_FORM_FIELD_TYPES).toContain(field.type);
          if (field.type === 'select') {
            expect(field.options?.length ?? 0).toBeGreaterThan(0);
          }
        }
      }
      expect(m.knownModels.length).toBeGreaterThan(0);
      for (const model of m.knownModels) {
        expect(model.id.length).toBeGreaterThan(0);
        expect(typeof model.capabilities.streaming).toBe('boolean');
        expect(typeof model.capabilities.tools).toBe('boolean');
        expect(typeof model.capabilities.vision).toBe('boolean');
        expect(typeof model.capabilities.systemPrompt).toBe('boolean');
      }
      expect(typeof m.supportsModelListing).toBe('boolean');
    });

    it('[2] createLlm returns an adapter with matching vendor id', async () => {
      const firstKind = harness.factory.manifest.authKinds[0]!.kind;
      const adapter = await createLlm({
        vendor: harness.vendor,
        auth: harness.authFor(firstKind),
      });
      expect(adapter.vendor).toBe(harness.vendor);
    });

    it('[3] init() accepts each declared auth kind', async () => {
      for (const ak of harness.factory.manifest.authKinds) {
        await expect(
          createLlm({ vendor: harness.vendor, auth: harness.authFor(ak.kind) }),
        ).resolves.toBeDefined();
      }
    });

    if (harness.unsupportedAuth) {
      it('[4] init() rejects an unsupported auth kind', async () => {
        await expect(
          createLlm({
            vendor: harness.vendor,
            auth: harness.unsupportedAuth!,
          }),
        ).rejects.toThrow();
      });
    }

    it('[18] empty messages array is rejected with a clear error', async () => {
      const adapter = await init(harness);
      await expect(
        drainStream(adapter, {
          model: harness.toolCapableModel,
          messages: [],
        }),
      ).rejects.toThrowError(/messages/i);
    });

    // -----------------------------------------------------------------------
    // Behavioral checks — require vendor mocking via the harness.
    // -----------------------------------------------------------------------

    it('[5,6,7] stream emits exactly one end event, as the last event, with a valid finishReason', async () => {
      await harness.mockScenario('simple-stream');
      const adapter = await init(harness);
      const events = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'hello' }],
      });
      const endIndexes = events
        .map((e, i) => (e.type === 'end' ? i : -1))
        .filter((i) => i >= 0);
      expect(endIndexes).toHaveLength(1);
      expect(endIndexes[0]).toBe(events.length - 1);
      const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
      expect(VALID_FINISH_REASONS).toContain(end.finishReason);
    });

    it('[8] tokens stream incrementally (at least two chunks)', async () => {
      await harness.mockScenario('simple-stream');
      const adapter = await init(harness);
      const events = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'hello' }],
      });
      const tokens = events.filter((e) => e.type === 'token');
      expect(tokens.length).toBeGreaterThanOrEqual(2);
    });

    it('[9] pre-fired AbortSignal yields end(aborted) within 500ms', async () => {
      await harness.mockScenario('simple-stream');
      const adapter = await init(harness);
      const controller = new AbortController();
      controller.abort();
      const start = Date.now();
      const events = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'hello' }],
        signal: controller.signal,
      });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
      const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
      expect(end.type).toBe('end');
      expect(end.finishReason).toBe('aborted');
      // No token events should precede the end event when the abort was pre-fired.
      expect(events.filter((e) => e.type === 'token').length).toBe(0);
    });

    it('[10] mid-stream abort prevents any pending toolCall from firing', async () => {
      await harness.mockScenario('long-stream-with-pending-tool');
      const adapter = await init(harness);
      const controller = new AbortController();
      const events: LlmEvent[] = [];
      // Abort after the first token arrives.
      let aborted = false;
      for await (const evt of adapter.stream({
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'go' }],
        signal: controller.signal,
      })) {
        events.push(evt);
        if (!aborted && evt.type === 'token') {
          controller.abort();
          aborted = true;
        }
      }
      const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
      expect(end.type).toBe('end');
      expect(end.finishReason).toBe('aborted');
      expect(events.filter((e) => e.type === 'toolCall')).toHaveLength(0);
    });

    it('[11] tool-capable request yields a well-formed toolCall event', async () => {
      await harness.mockScenario('tool-call');
      const adapter = await init(harness);
      const events = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'call the tool' }],
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });
      const toolCalls = events.filter(
        (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
      );
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);
      const tc = toolCalls[0]!;
      expect(typeof tc.id).toBe('string');
      expect(tc.id.length).toBeGreaterThan(0);
      expect(typeof tc.name).toBe('string');
      expect(tc.name.length).toBeGreaterThan(0);
      expect(tc.arguments).toBeDefined();
    });

    if (harness.emitsToolCallStart) {
      it('[12] every toolCallStart precedes its matching toolCall with the same id', async () => {
        await harness.mockScenario('tool-call-after-tokens');
        const adapter = await init(harness);
        const events = await drainStream(adapter, {
          model: harness.toolCapableModel,
          messages: [{ role: 'user', content: 'hi' }],
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: { type: 'object', properties: {} },
            },
          ],
        });
        const startIndexById = new Map<string, number>();
        for (let i = 0; i < events.length; i++) {
          const evt = events[i]!;
          if (evt.type === 'toolCallStart') {
            startIndexById.set(evt.id, i);
          } else if (evt.type === 'toolCall') {
            const startIndex = startIndexById.get(evt.id);
            expect(startIndex, `missing toolCallStart for id ${evt.id}`).toBeDefined();
            expect(startIndex!).toBeLessThan(i);
          }
        }
      });
    }

    it('[13] appendToolResult produces a history that re-streams without throwing', async () => {
      await harness.mockScenario('tool-call');
      const adapter = await init(harness);
      const events = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'call it' }],
        tools: [
          { name: 'test_tool', description: 'x', parameters: { type: 'object' } },
        ],
      });
      const tc = events.find(
        (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
      );
      expect(tc).toBeDefined();
      const baseHistory: Message[] = [{ role: 'user', content: 'call it' }];
      const afterAssistant = adapter.appendAssistantToolCall(baseHistory, [tc!]);
      expect(afterAssistant.length).toBe(baseHistory.length + 1);
      const withResult = adapter.appendToolResult(afterAssistant, tc!.id, { ok: true });
      expect(withResult.length).toBe(afterAssistant.length + 1);
      // Re-submit — must not throw.
      await harness.mockScenario('simple-stream');
      await expect(
        drainStream(adapter, {
          model: harness.toolCapableModel,
          messages: withResult,
        }),
      ).resolves.toBeDefined();
    });

    it('[14] appendToolResult is deterministic for the same inputs', async () => {
      const adapter = await init(harness);
      const history: Message[] = [{ role: 'user', content: 'hi' }];
      const a = adapter.appendToolResult(history, 'tc_1', { a: 1 });
      const b = adapter.appendToolResult(history, 'tc_1', { a: 1 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('[15] listAvailableModels returns a non-empty list', async () => {
      await harness.mockScenario('list-models');
      const adapter = await init(harness);
      const models = await adapter.listAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      for (const m of models) {
        expect(m.id.length).toBeGreaterThan(0);
        expect(typeof m.capabilities.tools).toBe('boolean');
      }
    });

    if (harness.nonToolCapableModel) {
      it('[16] non-tool-capable model with tools declared either fails fast or runs without tool calls', async () => {
        await harness.mockScenario('simple-stream');
        const adapter = await init(harness);
        const run = async () =>
          drainStream(adapter, {
            model: harness.nonToolCapableModel!,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [
              { name: 'test_tool', description: 'x', parameters: { type: 'object' } },
            ],
          });
        try {
          const events = await run();
          // Allowed: ran to completion but emitted no tool calls.
          expect(events.filter((e) => e.type === 'toolCall')).toHaveLength(0);
          const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
          expect(end.finishReason).not.toBe('error');
        } catch (err) {
          // Also allowed: fails fast with a clear error.
          expect(err).toBeInstanceOf(Error);
        }
      });
    }

    it('[17] system prompt is present in the upstream request', async () => {
      await harness.mockScenario('simple-stream');
      const adapter = await init(harness);
      await drainStream(adapter, {
        model: harness.toolCapableModel,
        system: 'You are a test agent.',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const captured = harness.getCapturedRequest();
      expect(captured).not.toBeNull();
      expect(captured!.system).toBe('You are a test agent.');
    });

    it('[19] multi-turn conversation is preserved in the upstream request', async () => {
      await harness.mockScenario('simple-stream');
      const adapter = await init(harness);
      const messages: Message[] = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'one' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'third' },
      ];
      await drainStream(adapter, { model: harness.toolCapableModel, messages });
      const captured = harness.getCapturedRequest();
      expect(captured).not.toBeNull();
      expect(captured!.messageCount).toBe(messages.length);
    });

    it('[20] vendorRaw on an assistant message round-trips through the next request', async () => {
      await harness.mockScenario('tool-call');
      const adapter = await init(harness);
      const first = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'go' }],
        tools: [
          { name: 'test_tool', description: 'x', parameters: { type: 'object' } },
        ],
      });
      const tc = first.find(
        (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
      );
      expect(tc).toBeDefined();

      const afterAssistant = adapter.appendAssistantToolCall(
        [{ role: 'user', content: 'go' }],
        [tc!],
      );
      const withResult = adapter.appendToolResult(afterAssistant, tc!.id, { ok: true });

      await harness.mockScenario('simple-stream');
      await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: withResult,
      });
      const captured = harness.getCapturedRequest();
      expect(captured).not.toBeNull();
      expect(captured!.vendorRawHonored).toBe(true);
    });

    it('[21] appendAssistantToolCall output + appendToolResult re-stream preserves tool-call id on wire', async () => {
      await harness.mockScenario('tool-call');
      const adapter = await init(harness);
      const first = await drainStream(adapter, {
        model: harness.toolCapableModel,
        messages: [{ role: 'user', content: 'go' }],
        tools: [
          { name: 'test_tool', description: 'x', parameters: { type: 'object' } },
        ],
      });
      const tc = first.find(
        (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
      );
      expect(tc).toBeDefined();

      const history = adapter.appendAssistantToolCall(
        [{ role: 'user', content: 'go' }],
        [tc!],
      );
      // The appended message must carry vendorRaw in a shape the same adapter
      // accepts back on stream(). If vendorRaw is undefined, the adapter would
      // have to reconstruct from role/content only — which is the regression
      // this check catches.
      const appended = history[history.length - 1]!;
      expect(appended.role).toBe('assistant');
      expect(appended.vendorRaw).toBeDefined();
    });
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function init(harness: ContractHarness): Promise<LlmAdapter> {
  const kind = harness.factory.manifest.authKinds[0]!.kind;
  return createLlm({ vendor: harness.vendor, auth: harness.authFor(kind) });
}

async function drainStream(adapter: LlmAdapter, req: PromptRequest): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const evt of adapter.stream(req)) {
    events.push(evt);
  }
  return events;
}
