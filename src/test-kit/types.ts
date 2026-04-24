import type { AdapterFactory, AuthKind, AuthSpec } from '../types.js';

/**
 * Named scenarios the harness must be able to stage. Each scenario configures
 * the vendor mock to produce a specific response the next time `stream()` is
 * called. The kit calls `harness.mockScenario(name)` before running a test.
 */
export type ContractScenario =
  /** 3+ text tokens then end('stop'). No tools. */
  | 'simple-stream'
  /** A single tool call (no content) then end('tool'). */
  | 'tool-call'
  /** Content tokens, then a tool call, then end('tool'). */
  | 'tool-call-after-tokens'
  /** 10+ text tokens yielded slowly (>= 20ms apart) then end('stop'). */
  | 'long-stream'
  /**
   * Stream that would produce a tool call, but with enough delay before the
   * tool call arrives that the kit can fire an abort in the middle.
   * Expected behavior: on abort, no toolCall event fires; end('aborted') is yielded.
   */
  | 'long-stream-with-pending-tool'
  /** `listAvailableModels()` returns at least 2 models. */
  | 'list-models';

/**
 * A vendor-agnostic view of the most recent request the adapter sent upstream.
 * The harness captures whatever the vendor wire actually contained and exposes
 * a normalized view so the kit can assert on it without vendor knowledge.
 */
export interface CapturedRequest {
  /** System prompt as the adapter forwarded it (top-level, injected-into-messages, or missing). */
  system?: string;
  /** Number of non-system messages forwarded. */
  messageCount: number;
  /** True if any message's vendorRaw contents appear to have influenced the wire request. */
  vendorRawHonored: boolean;
}

/**
 * Harness an adapter provides so the contract kit can run. Adapter authors
 * implement this once for their adapter, then call `runContractTests(harness)`.
 *
 * The harness hides vendor-specific concerns (SDK mocking, wire format,
 * credential shapes) behind a small uniform surface.
 */
export interface ContractHarness {
  /** Machine-readable vendor id. Used in test descriptions only. */
  vendor: string;

  /** The factory under test. */
  factory: AdapterFactory;

  /**
   * Return a valid AuthSpec for each `AuthKind` the adapter's manifest declares.
   * Called once per declared kind during the "accepts declared auth kinds" check.
   * Values need not be real credentials — mocks don't care.
   */
  authFor(kind: AuthKind): AuthSpec;

  /**
   * An AuthSpec that the adapter MUST reject via `init()`. Typically a kind the
   * adapter does not accept. Return `null` if the adapter truly accepts every
   * AuthKind (unusual — check #4 will be skipped).
   */
  unsupportedAuth: AuthSpec | null;

  /**
   * Configure the vendor mock for the named scenario. Called before each
   * behavioral test. The next `stream()` or `listAvailableModels()` call will
   * return the scenario's canned response.
   */
  mockScenario(scenario: ContractScenario): void | Promise<void>;

  /**
   * Clean up mocks between tests. Called in an `afterEach`. Safe to call even
   * if no scenario is active.
   */
  cleanup(): void | Promise<void>;

  /**
   * Return a normalized view of the most recent wire request the adapter sent
   * upstream, or null if no request has been made since the last cleanup().
   */
  getCapturedRequest(): CapturedRequest | null;

  /** A model id in `knownModels` whose capabilities.tools is true. */
  toolCapableModel: string;

  /**
   * A model id whose capabilities.tools is false, for check #16. Return null if
   * the adapter has no non-tool-capable models in its manifest — the check is
   * then skipped.
   */
  nonToolCapableModel: string | null;

  /**
   * Does this adapter emit `toolCallStart` events? If true, check #12
   * (toolCallStart precedes toolCall) runs; if false, that check is skipped.
   */
  emitsToolCallStart: boolean;
}
