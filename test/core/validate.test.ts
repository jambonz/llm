import { describe, expect, it, vi } from 'vitest';
import { assertValidRequest } from '../../src/validate.js';
import type { Message, PromptRequest } from '../../src/types.js';

vi.setConfig({ testTimeout: 2000 });

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeValidReq(overrides: Partial<PromptRequest> = {}): PromptRequest {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Baseline: pre-existing validations
// ---------------------------------------------------------------------------

describe('assertValidRequest — baseline (pre-existing validations)', () => {
  it('does not throw for a minimal valid request', () => {
    expect(() => assertValidRequest(makeValidReq())).not.toThrow();
  }, 2000);

  it('throws when model is missing', () => {
    const req = makeValidReq({ model: undefined as unknown as string });
    expect(() => assertValidRequest(req)).toThrow();
  }, 2000);

  it('throws when model is empty string', () => {
    const req = makeValidReq({ model: '' });
    expect(() => assertValidRequest(req)).toThrow();
  }, 2000);

  it('throws when messages is missing', () => {
    const req = makeValidReq({ messages: undefined as unknown as Message[] });
    expect(() => assertValidRequest(req)).toThrow();
  }, 2000);

  it('throws when messages is empty array', () => {
    const req = makeValidReq({ messages: [] });
    expect(() => assertValidRequest(req)).toThrow();
  }, 2000);

  it('throws when a message has role: system', () => {
    const req = makeValidReq({
      messages: [{ role: 'system', content: 'Be helpful' }],
    });
    expect(() => assertValidRequest(req)).toThrow();
  }, 2000);

  it('throws for system-role message mixed with other messages', () => {
    const req = makeValidReq({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'system', content: 'Be helpful' },
      ],
    });
    expect(() => assertValidRequest(req)).toThrow();
  }, 2000);
});

// ---------------------------------------------------------------------------
// cacheKey validation
// ---------------------------------------------------------------------------

describe('assertValidRequest — cacheKey', () => {
  const EXPECTED_MESSAGE = /cacheKey must be a non-empty string/;

  // No-throw equivalence class: absent / valid values
  it('does not throw when cacheKey is omitted entirely', () => {
    expect(() => assertValidRequest(makeValidReq())).not.toThrow();
  }, 2000);

  it('does not throw when cacheKey is explicitly undefined', () => {
    expect(() =>
      assertValidRequest(makeValidReq({ cacheKey: undefined })),
    ).not.toThrow();
  }, 2000);

  it('does not throw for a valid non-empty cacheKey string', () => {
    expect(() =>
      assertValidRequest(makeValidReq({ cacheKey: 'call-abc-123' })),
    ).not.toThrow();
  }, 2000);

  it('does not throw for a whitespace-only cacheKey (length > 0, satisfies non-empty rule)', () => {
    expect(() =>
      assertValidRequest(makeValidReq({ cacheKey: '   ' })),
    ).not.toThrow();
  }, 2000);

  // Throw equivalence class: present but invalid
  it("throws with correct message for cacheKey: '' (empty string)", () => {
    expect(() =>
      assertValidRequest(makeValidReq({ cacheKey: '' })),
    ).toThrow(EXPECTED_MESSAGE);
  }, 2000);

  it('throws with correct message for cacheKey: 123 (non-string)', () => {
    expect(() =>
      assertValidRequest(makeValidReq({ cacheKey: 123 as any })),
    ).toThrow(EXPECTED_MESSAGE);
  }, 2000);

  it('throws with correct message for cacheKey: null (non-string)', () => {
    expect(() =>
      assertValidRequest(makeValidReq({ cacheKey: null as any })),
    ).toThrow(EXPECTED_MESSAGE);
  }, 2000);
});

// ---------------------------------------------------------------------------
// Full valid request with all optional fields including cacheKey
// ---------------------------------------------------------------------------

describe('assertValidRequest — full valid request shapes', () => {
  it('does not throw for request with all optional fields and valid cacheKey', () => {
    const req: PromptRequest = {
      model: 'claude-3-7-sonnet',
      system: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'Thank you' },
      ],
      tools: [
        {
          name: 'calculator',
          description: 'Performs arithmetic',
          parameters: { type: 'object', properties: {} },
        },
      ],
      temperature: 0.7,
      maxTokens: 1024,
      cacheKey: 'conversation-42',
    };
    expect(() => assertValidRequest(req)).not.toThrow();
  }, 2000);

  it('does not throw for multi-turn conversation with cacheKey', () => {
    const req = makeValidReq({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
      cacheKey: 'conversation-42',
    });
    expect(() => assertValidRequest(req)).not.toThrow();
  }, 2000);
});
