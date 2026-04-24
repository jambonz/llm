import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'test-kit/index': 'src/test-kit/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node22',
  outDir: 'dist',
  // Vitest is a peer dep for the test-kit — keep it external so the bundle
  // stays slim. Consumers using the test-kit already have vitest installed.
  external: ['vitest'],
});
