import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  format: ['esm', 'cjs'],
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  esbuildOptions(o) {
    o.banner = o.banner || {};
  },
});
