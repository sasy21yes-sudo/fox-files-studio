import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { claudeScene } from './tools/vite/claudeScene';

// Relative base so the production build works from any folder or static host.
// claudeScene() only exists in `npm run dev` (prompt editing through Claude, key read from .env).
export default defineConfig({
  base: './',
  plugins: [react(), claudeScene()],
  build: { target: 'es2022', sourcemap: false },
});
