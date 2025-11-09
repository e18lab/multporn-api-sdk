import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.node.ts' },
    outDir: 'dist/node',
    treeshake: true,
    format: ['esm', 'cjs'],
    dts: false,
    target: 'es2022',
    minify: false,
    sourcemap: true,
    clean: true,
  },

  {
    entry: { index: 'src/index.rn.ts' },
    outDir: 'dist/rn',
    treeshake: true,
    format: ['esm'],
    dts: false,
    target: 'es2022',
    minify: false,
    sourcemap: true,
    clean: false,
  },

  {
    entry: { index: 'src/index.browser.ts' },
    outDir: 'dist/browser',
    treeshake: true,
    format: ['esm'],
    dts: false,
    target: 'es2022',
    minify: false,
    sourcemap: true,
    clean: false,
  },

  {
    entry: { index: 'src/index.public.ts' },
    outDir: 'dist/types',
    treeshake: false,
    format: ['esm'],
    dts: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    clean: false,
  },
]);
