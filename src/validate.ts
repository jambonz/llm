import type { PromptRequest } from './types.js';

/**
 * Validate a PromptRequest against the library's universal preconditions.
 *
 * Adapters should call this at the top of `stream()` to get consistent error
 * messages. The contract test-kit's check #18 verifies empty messages are
 * rejected, so adapters that skip this helper must implement the equivalent
 * validation themselves.
 *
 * Rules enforced:
 *   - `model` is a non-empty string.
 *   - `messages` is a non-empty array.
 *   - `messages` does not contain `role: 'system'` turns (use `system` top-level).
 *   - If `reasoningEffort` is present, it must be one of 'minimal', 'low', 'medium', 'high'.
 */
export function assertValidRequest(req: PromptRequest): void {
  if (!req || typeof req !== 'object') {
    throw new Error('PromptRequest must be an object');
  }
  if (typeof req.model !== 'string' || req.model.length === 0) {
    throw new Error('PromptRequest.model must be a non-empty string');
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new Error('PromptRequest.messages must be a non-empty array');
  }
  if (req.messages.some((m) => m.role === 'system')) {
    throw new Error(
      'PromptRequest.messages must not contain role: \'system\'. ' +
        'Pass the system prompt via PromptRequest.system instead.',
    );
  }
  if (req.reasoningEffort !== undefined) {
    const allowed = ['minimal', 'low', 'medium', 'high'] as const;
    if (!(allowed as readonly string[]).includes(req.reasoningEffort as string)) {
      throw new Error(
        `PromptRequest.reasoningEffort must be one of: ${allowed.join(', ')}`,
      );
    }
  }
}
