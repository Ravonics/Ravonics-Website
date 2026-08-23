import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ravonics.com',
  output: 'static',
  outDir: './build/site',
  build: {
    format: 'file',
    assets: 'assets',
    inlineStylesheets: 'never'
  },
  compressHTML: false
});
