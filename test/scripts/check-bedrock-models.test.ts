import { describe, expect, it } from 'vitest';
import { rewriteManifest } from '../../scripts/check-bedrock-models.js';

const MANIFEST_SAMPLE = `const BEDROCK_KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'amazon.nova-micro-v1:0',
    displayName: 'Amazon Nova Micro',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 128_000,
    },
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    displayName: 'Claude 3.5 Haiku (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: false,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
  },
  {
    id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    displayName: 'Claude 3.7 Sonnet (on Bedrock)',
    capabilities: {
      streaming: true,
      tools: true,
      vision: true,
      systemPrompt: true,
      maxContextTokens: 200_000,
    },
    deprecated: true,
  },
];
`;

describe('rewriteManifest', () => {
  it('inserts `deprecated: true,` on a single matching entry', () => {
    const result = rewriteManifest(MANIFEST_SAMPLE, ['anthropic.claude-3-5-haiku-20241022-v1:0']);
    expect(result).toContain(`    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',`);
    // The new line appears immediately before the entry's closing brace.
    const lines = result.split('\n');
    const idIdx = lines.findIndex((l) => l === `    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',`);
    // Walk to the closing brace.
    let closeIdx = -1;
    for (let i = idIdx + 1; i < lines.length; i++) {
      if (lines[i] === '  }' || lines[i] === '  },') { closeIdx = i; break; }
    }
    expect(closeIdx).toBeGreaterThan(idIdx);
    expect(lines[closeIdx - 1]).toBe('    deprecated: true,');
  });

  it('is idempotent — entries already flagged `deprecated:` are untouched', () => {
    const result = rewriteManifest(MANIFEST_SAMPLE, ['anthropic.claude-3-7-sonnet-20250219-v1:0']);
    expect(result).toBe(MANIFEST_SAMPLE);
  });

  it('handles multiple ids in one pass', () => {
    const result = rewriteManifest(MANIFEST_SAMPLE, [
      'amazon.nova-micro-v1:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
    ]);
    // Both now carry deprecated:
    const occurrences = (result.match(/deprecated: true,/g) ?? []).length;
    expect(occurrences).toBe(3); // two new + one pre-existing
  });

  it('throws on unknown id (tamper detection / format drift)', () => {
    expect(() =>
      rewriteManifest(MANIFEST_SAMPLE, ['nonexistent.model-id-v99:0']),
    ).toThrowError(/not found/);
  });

  it('leaves untouched entries byte-identical', () => {
    const result = rewriteManifest(MANIFEST_SAMPLE, ['anthropic.claude-3-5-haiku-20241022-v1:0']);
    // The nova-micro entry block (5 lines starting from its id line) is unchanged.
    const novaLine = `    id: 'amazon.nova-micro-v1:0',`;
    const beforeStart = MANIFEST_SAMPLE.indexOf(novaLine);
    const afterStart = result.indexOf(novaLine);
    // Slice up to the next id line — that entry's contents must match byte-for-byte.
    const beforeSlice = MANIFEST_SAMPLE.slice(beforeStart, MANIFEST_SAMPLE.indexOf(`    id: 'anthropic`));
    const afterSlice = result.slice(afterStart, result.indexOf(`    id: 'anthropic`));
    expect(afterSlice).toBe(beforeSlice);
  });
});
