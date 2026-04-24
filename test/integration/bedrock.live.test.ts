import { describe, expect, it } from 'vitest';
import { createLlm } from '../../src/index.js';
import type { AuthSpec, LlmEvent } from '../../src/types.js';

const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
const awsSessionToken = process.env.AWS_SESSION_TOKEN;
const bedrockApiKey = process.env.BEDROCK_API_KEY;
const region = process.env.AWS_REGION ?? 'us-east-1';
const model =
  process.env.BEDROCK_TEST_MODEL ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const auth: AuthSpec | null = bedrockApiKey
  ? { kind: 'bedrockApiKey', apiKey: bedrockApiKey, region }
  : awsAccessKey && awsSecretKey
    ? {
        kind: 'bedrockIam',
        accessKeyId: awsAccessKey,
        secretAccessKey: awsSecretKey,
        ...(awsSessionToken ? { sessionToken: awsSessionToken } : {}),
        region,
      }
    : null;

const suite = auth ? describe : describe.skip;

suite('AWS Bedrock — live integration', () => {
  it('streams tokens for a simple prompt', async () => {
    const llm = await createLlm({ vendor: 'bedrock', auth: auth! });
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
    const llm = await createLlm({ vendor: 'bedrock', auth: auth! });
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
    const llm = await createLlm({ vendor: 'bedrock', auth: auth! });
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
});
