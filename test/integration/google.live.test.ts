import { describe, expect, it } from 'vitest';
import { createLlm } from '../../src/index.js';
import type { LlmEvent } from '../../src/types.js';

const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
const suite = apiKey ? describe : describe.skip;
const model = process.env.GOOGLE_TEST_MODEL ?? 'gemini-2.5-flash';

suite('Google Gemini — live integration', () => {
  it('streams tokens for a simple prompt', async () => {
    const llm = await createLlm({
      vendor: 'google',
      auth: { kind: 'googleApiKey', apiKey: apiKey! },
    });
    const events: LlmEvent[] = [];
    for await (const evt of llm.stream({
      model,
      system: 'Respond with exactly: "integration-test-ok"',
      messages: [{ role: 'user', content: 'Say the passphrase.' }],
      maxTokens: 50,
    })) {
      events.push(evt);
    }
    const tokens = events.filter((e) => e.type === 'token') as Extract<
      LlmEvent,
      { type: 'token' }
    >[];
    const joined = tokens.map((t) => t.text).join('');
    expect(joined.toLowerCase()).toContain('integration-test-ok');
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.finishReason).toMatch(/^(stop|length)$/);
  });

  it('dispatches a tool call end-to-end', async () => {
    const llm = await createLlm({
      vendor: 'google',
      auth: { kind: 'googleApiKey', apiKey: apiKey! },
    });
    const events: LlmEvent[] = [];
    for await (const evt of llm.stream({
      model,
      system:
        'You are a test agent. When asked for weather, ALWAYS call the get_weather tool.',
      messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
      maxTokens: 300,
    })) {
      events.push(evt);
    }
    const toolCalls = events.filter(
      (e): e is Extract<LlmEvent, { type: 'toolCall' }> => e.type === 'toolCall',
    );
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(toolCalls[0]!.name).toBe('get_weather');
    expect(toolCalls[0]!.arguments).toMatchObject({ city: expect.any(String) });
  });

  it('aborts cleanly mid-stream', async () => {
    const llm = await createLlm({
      vendor: 'google',
      auth: { kind: 'googleApiKey', apiKey: apiKey! },
    });
    const controller = new AbortController();
    const events: LlmEvent[] = [];
    let sawToken = false;
    for await (const evt of llm.stream({
      model,
      messages: [{ role: 'user', content: 'Count slowly from 1 to 100.' }],
      maxTokens: 500,
      signal: controller.signal,
    })) {
      events.push(evt);
      if (!sawToken && evt.type === 'token') {
        sawToken = true;
        controller.abort();
      }
    }
    const end = events[events.length - 1] as Extract<LlmEvent, { type: 'end' }>;
    expect(end.finishReason).toBe('aborted');
  });

  it('lists models', async () => {
    const llm = await createLlm({
      vendor: 'google',
      auth: { kind: 'googleApiKey', apiKey: apiKey! },
    });
    const models = await llm.listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.startsWith('gemini-'))).toBe(true);
  });
});
