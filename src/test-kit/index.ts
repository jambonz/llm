/**
 * @jambonz/llm test-kit — contract tests for vendor adapters.
 *
 * Usage from an adapter's test file:
 *
 *   import { runContractTests } from '@jambonz/llm/test-kit';
 *   import { myAdapterHarness } from './harness.js';
 *
 *   runContractTests(myAdapterHarness);
 *
 * The kit registers vitest describe/it blocks internally; importing this
 * module only exposes the runner and harness types.
 */

export { runContractTests } from './runner.js';
export type { CapturedRequest, ContractHarness, ContractScenario } from './types.js';

// Reference fake adapter + harness, used by the kit's own self-check.
// External adapter authors don't need these — they build a harness for their
// vendor. But they may find the fake useful as a reference.
export { FakeAdapter, createFakeHarness, fakeManifest } from './fake-adapter.js';
export type { FakeHarness } from './fake-adapter.js';
