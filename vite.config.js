import { fileURLToPath } from 'node:url';
import darkThemePlugin from './theme-dark.mjs';

export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [darkThemePlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
};
