#!/usr/bin/env node
/**
 * Bedrock model-drift checker.
 *
 * Compares `src/adapters/bedrock/manifest.ts` against AWS's live Bedrock
 * lifecycle data and reports models that AWS now flags LEGACY but our
 * manifest still treats as active. With `--write`, edits the manifest in
 * place by inserting `deprecated: true` on drifted entries.
 *
 * Usage:
 *   tsx scripts/check-bedrock-models.ts             # dry-run human report
 *   tsx scripts/check-bedrock-models.ts --json      # dry-run JSON report
 *   tsx scripts/check-bedrock-models.ts --write     # rewrite manifest.ts
 *   tsx scripts/check-bedrock-models.ts --region us-east-1
 *
 * Exit codes:
 *   0 — no drift (or --write applied successfully with changes)
 *   1 — drift detected (dry-run only) OR AWS API error
 *
 * Requires AWS credentials via the standard SDK chain (env vars, shared
 * config, or IAM role). IAM needs `bedrock:ListFoundationModels` and
 * `bedrock:ListInferenceProfiles`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import { bedrockManifest } from '../src/adapters/bedrock/manifest.js';
import type { ModelInfo } from '../src/types.js';

// ---------------------------------------------------------------------------

interface Args {
  write: boolean;
  json: boolean;
  region: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { write: false, json: false, region: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--json') args.json = true;
    else if (a === '--region') args.region = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: tsx scripts/check-bedrock-models.ts [--write] [--json] [--region <r>]',
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------

type AwsLifecycle = 'ACTIVE' | 'LEGACY' | 'UNKNOWN';

interface AwsStatus {
  id: string;
  lifecycle: AwsLifecycle;
  /** true if the id was only found via ListInferenceProfiles, not ListFoundationModels */
  isInferenceProfile: boolean;
}

async function fetchAwsStatuses(region: string): Promise<Map<string, AwsStatus>> {
  const client = new BedrockClient({ region });
  const map = new Map<string, AwsStatus>();

  const fm = await client.send(new ListFoundationModelsCommand({}));
  for (const m of fm.modelSummaries ?? []) {
    if (!m.modelId) continue;
    const status = m.modelLifecycle?.status;
    map.set(m.modelId, {
      id: m.modelId,
      lifecycle: status === 'LEGACY' ? 'LEGACY' : status === 'ACTIVE' ? 'ACTIVE' : 'UNKNOWN',
      isInferenceProfile: false,
    });
  }

  const ip = await client.send(new ListInferenceProfilesCommand({}));
  for (const p of ip.inferenceProfileSummaries ?? []) {
    if (!p.inferenceProfileId) continue;
    // Inference profiles have a `status` field (ACTIVE|…); Bedrock does not
    // currently surface LEGACY on profiles, so treat missing/ACTIVE as ACTIVE
    // and anything else as LEGACY. Document this if AWS adds new states.
    const s = p.status;
    map.set(p.inferenceProfileId, {
      id: p.inferenceProfileId,
      lifecycle: !s || s === 'ACTIVE' ? 'ACTIVE' : 'LEGACY',
      isInferenceProfile: true,
    });
  }

  return map;
}

// ---------------------------------------------------------------------------

interface DriftReport {
  toDeprecate: ModelInfo[];              // LEGACY in AWS, not flagged here
  alreadyDeprecated: ModelInfo[];        // LEGACY in AWS, already flagged
  unDeprecationCandidate: ModelInfo[];   // ACTIVE in AWS, but we flag deprecated
  notFound: ModelInfo[];                 // id not returned by AWS (retired? typo? region?)
  novel: string[];                       // AWS has it, we don't
}

function classify(
  manifestEntries: ReadonlyArray<ModelInfo>,
  aws: ReadonlyMap<string, AwsStatus>,
): DriftReport {
  const report: DriftReport = {
    toDeprecate: [],
    alreadyDeprecated: [],
    unDeprecationCandidate: [],
    notFound: [],
    novel: [],
  };

  const manifestIds = new Set(manifestEntries.map((e) => e.id));

  for (const entry of manifestEntries) {
    const awsStatus = aws.get(entry.id);
    if (!awsStatus) {
      report.notFound.push(entry);
      continue;
    }
    if (awsStatus.lifecycle === 'LEGACY' && !entry.deprecated) {
      report.toDeprecate.push(entry);
    } else if (awsStatus.lifecycle === 'LEGACY' && entry.deprecated) {
      report.alreadyDeprecated.push(entry);
    } else if (awsStatus.lifecycle === 'ACTIVE' && entry.deprecated) {
      report.unDeprecationCandidate.push(entry);
    }
  }

  for (const [awsId, awsStatus] of aws.entries()) {
    if (awsStatus.lifecycle !== 'ACTIVE') continue;
    // Only report novel foundation models — inference-profile listings are
    // noisy (every base model gets a us./eu./apac. profile) and most aren't
    // worth curating.
    if (awsStatus.isInferenceProfile) continue;
    if (!manifestIds.has(awsId)) report.novel.push(awsId);
  }

  return report;
}

// ---------------------------------------------------------------------------

/**
 * Rewrite a manifest.ts file in place, inserting `deprecated: true,` on each
 * given id. Exported for unit tests. Returns the rewritten string. Throws if
 * any id cannot be located unambiguously.
 */
export function rewriteManifest(source: string, idsToDeprecate: string[]): string {
  let out = source;
  for (const id of idsToDeprecate) {
    out = deprecateOne(out, id);
  }
  return out;
}

function deprecateOne(source: string, id: string): string {
  const idLineNeedle = `    id: '${id}',`;
  const lines = source.split('\n');
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === idLineNeedle) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`rewriteManifest: id '${id}' not found (looking for line ${JSON.stringify(idLineNeedle)})`);
  }
  if (matches.length > 1) {
    throw new Error(`rewriteManifest: id '${id}' matched ${matches.length} lines (expected exactly 1)`);
  }
  const idLine = matches[0];

  // Walk forward to find the entry's closing brace. The entry's closing `}`
  // is an exactly-two-space-indent line, matching the array-item format.
  let closeLine = -1;
  for (let i = idLine + 1; i < lines.length; i++) {
    if (lines[i] === '  }' || lines[i] === '  },') {
      closeLine = i;
      break;
    }
  }
  if (closeLine === -1) {
    throw new Error(`rewriteManifest: could not find closing brace for entry '${id}'`);
  }

  // Idempotent: if the entry already contains `deprecated:`, leave it.
  for (let i = idLine + 1; i < closeLine; i++) {
    if (lines[i].includes('deprecated:')) return source;
  }

  lines.splice(closeLine, 0, '    deprecated: true,');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

async function writeManifest(ids: string[]): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.join(here, '..', 'src', 'adapters', 'bedrock', 'manifest.ts');
  const current = await fs.readFile(manifestPath, 'utf8');
  const next = rewriteManifest(current, ids);
  if (next === current) return;
  await fs.writeFile(manifestPath, next, 'utf8');
}

// ---------------------------------------------------------------------------

function formatReport(r: DriftReport): string {
  const lines: string[] = [];
  lines.push('Bedrock model drift report');
  lines.push('==========================');
  lines.push('');

  if (r.toDeprecate.length) {
    lines.push(`DRIFT: ${r.toDeprecate.length} model(s) LEGACY in AWS but not flagged deprecated here:`);
    for (const m of r.toDeprecate) lines.push(`  - ${m.id}${m.displayName ? '  (' + m.displayName + ')' : ''}`);
    lines.push('');
  } else {
    lines.push('No drift: every LEGACY AWS model is already flagged deprecated.');
    lines.push('');
  }

  if (r.alreadyDeprecated.length) {
    lines.push(`Already-correct deprecations (LEGACY ∩ deprecated=true): ${r.alreadyDeprecated.length}`);
    for (const m of r.alreadyDeprecated) lines.push(`  - ${m.id}`);
    lines.push('');
  }

  if (r.unDeprecationCandidate.length) {
    lines.push(`Un-deprecation candidates (ACTIVE in AWS, flagged deprecated here): ${r.unDeprecationCandidate.length}`);
    lines.push('  (Manual review only — script will not un-deprecate.)');
    for (const m of r.unDeprecationCandidate) lines.push(`  - ${m.id}`);
    lines.push('');
  }

  if (r.notFound.length) {
    lines.push(`Not found in AWS listing: ${r.notFound.length}`);
    lines.push('  (Could be retired, a typo, or a region-specific id. Manual review.)');
    for (const m of r.notFound) lines.push(`  - ${m.id}`);
    lines.push('');
  }

  if (r.novel.length) {
    lines.push(`Novel models in AWS not in our manifest: ${r.novel.length}`);
    lines.push('  (Manual curation — add if desired.)');
    for (const id of r.novel) lines.push(`  - ${id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const region = args.region ?? process.env.AWS_REGION ?? 'us-east-1';

  const aws = await fetchAwsStatuses(region);
  const manifestEntries = bedrockManifest.knownModels;
  const report = classify(manifestEntries, aws);

  if (args.json) {
    const payload = {
      region,
      awsModelCount: aws.size,
      toDeprecate: report.toDeprecate.map((m) => m.id),
      alreadyDeprecated: report.alreadyDeprecated.map((m) => m.id),
      unDeprecationCandidate: report.unDeprecationCandidate.map((m) => m.id),
      notFound: report.notFound.map((m) => m.id),
      novel: report.novel,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatReport(report));
    console.log(`(checked against AWS region: ${region}; ${aws.size} AWS entries)`);
  }

  if (args.write && report.toDeprecate.length > 0) {
    await writeManifest(report.toDeprecate.map((m) => m.id));
    console.log(`\n--write: updated manifest.ts with ${report.toDeprecate.length} deprecation(s).`);
    process.exit(0);
  }

  if (!args.write && report.toDeprecate.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

// Only run main when invoked directly (not when imported by the unit test).
const isEntry = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error('check-bedrock-models failed:', err);
    process.exit(1);
  });
}
