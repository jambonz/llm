#!/usr/bin/env node
/**
 * Vendor validation harness.
 *
 * Drives a vendor's adapter through the real @jambonz/llm code path against
 * live credentials, so you can confirm a new OpenAI-compatible vendor actually
 * works end-to-end before relying on it. Specifically it:
 *
 *   1. testCredential()        — auth check (cheapest authenticated call).
 *   2. listAvailableModels()   — what the vendor actually exposes. Compares the
 *                                live list against the manifest's seed ids and
 *                                flags seeds that DON'T appear (likely wrong id
 *                                or wrong casing). Skipped/annotated when the
 *                                manifest sets supportsModelListing: false.
 *   3. streaming probe         — a 1-token prompt against the chosen model id,
 *                                reporting TTFT / client timing. Proves the id
 *                                resolves and the SSE stream parses.
 *   4. tool-call probe         — a prompt that forces a function call, to verify
 *                                the vendor's tool_call delta chunking matches
 *                                what the OpenAI adapter expects (the #1 thing
 *                                that silently breaks mid-call function calling).
 *
 * Usage:
 *   MOONSHOT_API_KEY=... tsx scripts/validate-vendor.ts moonshot
 *   ZAI_API_KEY=...      tsx scripts/validate-vendor.ts zai
 *   MINIMAX_API_KEY=...  tsx scripts/validate-vendor.ts minimax
 *   tsx scripts/validate-vendor.ts moonshot --model kimi-k2.6   # override model
 *   tsx scripts/validate-vendor.ts all                          # every vendor with a key set
 *
 * Each vendor reads its key from <VENDOR>_API_KEY (uppercased vendor id, '-'→'_').
 * Optional <VENDOR>_BASE_URL overrides the default base URL (e.g. Z.ai Coding-Plan,
 * Moonshot .cn). Exit code is non-zero if any probed vendor fails a step.
 */
import {
  createLlm,
  getAdapterFactory,
  type ApiKeyAuth,
  type LlmAdapter,
  type LlmEvent,
  type ModelInfo,
} from '../src/index.js';

// ---------------------------------------------------------------------------

const VENDORS = ['moonshot', 'zai'] as const;

interface Args {
  vendors: string[];
  model: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') model = argv[++i];
    else if (a.startsWith('--model=')) model = a.slice('--model='.length);
    else positionals.push(a);
  }
  const target = positionals[0] ?? 'all';
  const vendors = target === 'all' ? [...VENDORS] : [target];
  return { vendors, model };
}

const envKey = (vendor: string) => vendor.toUpperCase().replace(/-/g, '_');

// ANSI helpers (no deps).
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const ok = (s: string) => console.log(`  ${c.green('✓')} ${s}`);
const warn = (s: string) => console.log(`  ${c.yellow('!')} ${s}`);
const fail = (s: string) => console.log(`  ${c.red('✗')} ${s}`);

// ---------------------------------------------------------------------------

async function drainStream(
  adapter: LlmAdapter,
  req: Parameters<LlmAdapter['stream']>[0],
): Promise<{ events: LlmEvent[]; tokenText: string; firstTokenMs: number }> {
  const start = process.hrtime.bigint();
  let firstTokenMs = NaN;
  let tokenText = '';
  const events: LlmEvent[] = [];
  for await (const ev of adapter.stream(req)) {
    events.push(ev);
    if (ev.type === 'token') {
      if (Number.isNaN(firstTokenMs)) {
        firstTokenMs = Number(process.hrtime.bigint() - start) / 1e6;
      }
      tokenText += ev.text;
    }
  }
  return { events, tokenText, firstTokenMs };
}

async function validateVendor(vendor: string, modelOverride: string | undefined): Promise<boolean> {
  console.log(`\n${c.bold(`▶ ${vendor}`)}`);

  let factory;
  try {
    factory = getAdapterFactory(vendor);
  } catch {
    fail(`'${vendor}' is not a registered vendor`);
    return false;
  }

  const apiKey = process.env[`${envKey(vendor)}_API_KEY`];
  if (!apiKey) {
    warn(`${envKey(vendor)}_API_KEY not set — skipping`);
    return true; // not a failure, just skipped
  }
  const baseURL = process.env[`${envKey(vendor)}_BASE_URL`];

  const auth: ApiKeyAuth = { kind: 'apiKey', apiKey, ...(baseURL ? { baseURL } : {}) };
  const adapter = await createLlm({ vendor, auth });

  // Pick a model: explicit override, else first non-deprecated seed.
  const seeds = factory.manifest.knownModels;
  const model =
    modelOverride ?? seeds.find((m) => !m.deprecated)?.id ?? seeds[0]?.id;
  if (!model) {
    fail('no model id available (no override and empty knownModels)');
    return false;
  }

  let allPassed = true;

  // 1. testCredential
  try {
    await adapter.testCredential();
    ok('testCredential() — credential accepted');
  } catch (err) {
    fail(`testCredential() — ${(err as Error).message}`);
    allPassed = false;
  }

  // 2. listAvailableModels + seed comparison
  if (factory.manifest.supportsModelListing) {
    try {
      const live: ModelInfo[] = await adapter.listAvailableModels();
      const liveIds = new Set(live.map((m) => m.id));
      ok(`listAvailableModels() — ${live.length} model(s) returned`);
      console.log(c.dim(`    live: ${live.map((m) => m.id).slice(0, 30).join(', ')}`));
      for (const seed of seeds) {
        if (liveIds.has(seed.id)) {
          ok(`seed id '${seed.id}' present in live list`);
        } else {
          warn(`seed id '${seed.id}' NOT in live list — wrong id/casing? fix the manifest`);
          allPassed = false;
        }
      }
    } catch (err) {
      warn(
        `listAvailableModels() failed — ${(err as Error).message}. ` +
          `If this vendor has no /v1/models, set supportsModelListing: false in its manifest.`,
      );
    }
  } else {
    warn('manifest.supportsModelListing = false — skipping live model listing');
  }

  // 3. streaming probe (proves model id resolves + SSE parses + TTFT)
  try {
    const { tokenText, firstTokenMs, events } = await drainStream(adapter, {
      model,
      system: 'You are a terse assistant. Reply with a single word.',
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      maxTokens: 256,
    });
    const end = events.find((e) => e.type === 'end');
    const ttft = Number.isNaN(firstTokenMs) ? 'n/a' : `${firstTokenMs.toFixed(0)}ms`;
    const total = end && 'clientTiming' in end && end.clientTiming
      ? `${end.clientTiming.totalMs.toFixed(0)}ms`
      : 'n/a';
    const reason = end && end.type === 'end' ? end.finishReason : 'no-end';
    const line =
      `stream('${model}') — got ${JSON.stringify(tokenText.trim().slice(0, 40))} ` +
      `(finish=${reason}, TTFT ${ttft}, total ${total})`;
    if (tokenText.trim().length > 0) ok(line);
    else warn(line + ' — no content tokens (reasoning-only? check maxTokens/reasoning_content)');
  } catch (err) {
    fail(`stream('${model}') — ${(err as Error).message}`);
    allPassed = false;
  }

  // 4. tool-call probe (verifies tool_call delta accumulation)
  try {
    const { events } = await drainStream(adapter, {
      model,
      system: 'You are a weather bot. Always use the get_weather tool to answer.',
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the current weather for a city.',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string', description: 'City name' } },
            required: ['city'],
          },
        },
      ],
      maxTokens: 128,
    });
    const calls = events.filter((e): e is Extract<LlmEvent, { type: 'toolCall' }> =>
      e.type === 'toolCall',
    );
    if (calls.length === 0) {
      warn('tool-call probe — model returned no tool call (may just be model behavior, retry)');
    } else {
      const call = calls[0];
      const argsOk =
        call.arguments && typeof call.arguments === 'object' && 'city' in (call.arguments as object);
      if (argsOk) {
        ok(
          `tool-call probe — '${call.name}' with ${JSON.stringify(call.arguments)} ` +
            `(args accumulated cleanly)`,
        );
      } else {
        fail(
          `tool-call probe — '${call.name}' but arguments did NOT parse to an object: ` +
            `${JSON.stringify(call.arguments)}. Likely a delta-chunking mismatch.`,
        );
        allPassed = false;
      }
    }
  } catch (err) {
    fail(`tool-call probe — ${(err as Error).message}`);
    allPassed = false;
  }

  return allPassed;
}

// ---------------------------------------------------------------------------

async function main() {
  const { vendors, model } = parseArgs(process.argv.slice(2));
  console.log(c.bold('@jambonz/llm vendor validation'));
  const results: Record<string, boolean> = {};
  for (const v of vendors) {
    results[v] = await validateVendor(v, model);
  }

  console.log(`\n${c.bold('Summary')}`);
  let anyFailed = false;
  for (const [v, passed] of Object.entries(results)) {
    const keySet = !!process.env[`${envKey(v)}_API_KEY`];
    if (!keySet) console.log(`  ${c.dim(`- ${v}: skipped (no key)`)}`);
    else if (passed) console.log(`  ${c.green(`✓ ${v}: ok`)}`);
    else {
      console.log(`  ${c.red(`✗ ${v}: issues found`)}`);
      anyFailed = true;
    }
  }
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
