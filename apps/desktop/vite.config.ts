import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [
    react(),
    electron({
      main: {
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        onstart(args) {
          args.startup();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['bufferutil', 'utf-8-validate'],
            },
          },
        },
      },
      preload: {
        input: path.resolve(__dirname, 'src/preload/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              output: {
                // Prevent collision with dist-electron/index.js (main)
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
