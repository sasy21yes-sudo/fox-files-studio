import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { claudeScene } from './tools/vite/claudeScene';
import { localImage } from './tools/vite/localImage';

// Relative base so the production build works from any folder or static host.
// claudeScene() and localImage() only exist in `npm run dev`: prompt editing through Claude Code,
// and image generation through the local ComfyUI.
export default defineConfig({
  base: './',
  plugins: [react(), claudeScene(), localImage()],
  build: { target: 'es2022', sourcemap: false },
});
