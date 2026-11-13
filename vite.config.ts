import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // bibliotecas pesadas em arquivos próprios: ficam no cache do navegador entre publicações
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(xlsx|cfb|ssf|codepage)\//.test(id)) return 'planilhas';
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor|internmap)\//.test(id)) return 'graficos';
          if (/node_modules\/(@supabase)\//.test(id)) return 'supabase';
          return undefined;
        },
      },
    },
  }
});
