import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS dependency injection reads constructor types from `emitDecoratorMetadata`.
// Vitest transforms with esbuild by default, which does not emit that metadata, so DI
// resolves to `undefined` and every test fails with an unhelpful error. SWC does emit it.
// This is the documented NestJS + Vitest setup (ADR-016).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // *.itest.ts is deliberately absent: those need a real database and run under
    // vitest.integration.config.mts. `pnpm test` must work with nothing started.
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    setupFiles: ['./test/env.setup.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
