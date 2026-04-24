import { runContractTests, createFakeHarness } from '../../src/test-kit/index.js';

/**
 * Self-check: run the contract test-kit against the reference fake adapter.
 * If the kit is internally consistent, every check should pass here. When
 * a real adapter breaks, the kit catches it — this test ensures the kit
 * itself doesn't regress.
 */
runContractTests(createFakeHarness());
