import { describe, expect, it } from 'vitest';
import { createLlm } from '../../src/index.js';
import type { LlmEvent, ServiceAccountJson } from '../../src/types.js';

const rawServiceKey = process.env.VERTEX_SERVICE_KEY;
const projectId = process.env.VERTEX_PROJECT_ID;
const location = process.env.VERTEX_LOCATION ?? 'us-central1';
// A model that Vertex exposes via its OpenAI-compatible endpoint, e.g.
// mistral-large or meta/llama-3.1-405b-instruct-maas. Must be granted to the
// project under test.
const model = process.env.VERTEX_OPENAI_TEST_MODEL;

const ready = Boolean(rawServiceKey && projectId && model);
const suite = ready ? describe : describe.skip;

suite('Vertex OpenAI-compatible — live integration', () => {
  const credentials = ready
    ? (JSON.parse(rawServiceKey!) as ServiceAccountJson)
    : (undefined as unknown as ServiceAccountJson);

  it('streams tokens for a simple prompt', async () => {
    const llm = await createLlm({
      vendor: 'vertex-openai',
      auth: {
        kind: 'vertexServiceAccount',
        credentials,
        projectId: projectId!,
        location,
      },
    });
    const events: LlmEvent[] = [];
    for await (const evt of llm.stream({
      model: model!,
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
  });
});
