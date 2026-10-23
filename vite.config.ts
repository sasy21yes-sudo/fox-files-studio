import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { claudeScene } from './tools/vite/claudeScene';
import { localImage } from './tools/vite/localImage';
import { tracer } from './tools/vite/tracer';
import { rigTools } from './tools/vite/rigTools';
import { episodeSync } from './tools/vite/episodeSync';
import { voiceRecord } from './tools/vite/voiceRecord';

// Relative base so the production build works from any folder or static host.
// claudeScene() and localImage() only exist in `npm run dev`: prompt editing through Claude Code,
// and image generation through the local ComfyUI.
export default defineConfig({
  base: './',
  plugins: [react(), claudeScene(), localImage(), tracer(), rigTools(), episodeSync(), voiceRecord()],
  build: { target: 'es2022', sourcemap: false },
});
