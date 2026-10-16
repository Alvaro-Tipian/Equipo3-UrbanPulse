import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    federation({
      name: 'mf_mapa_urbano',
      filename: 'remoteEntry.js',
      exposes: {
        './MapaUrbano': './src/MapaUrbano.jsx',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        'react/jsx-runtime': { singleton: true },
        'react/jsx-dev-runtime': { singleton: true },
        '@urbanpulse/shared': { singleton: true },
      },
      dts: false,
    }),
  ],
  envPrefix: ['VITE_', 'TE_'],
  server: {
    port: 5174,
    strictPort: true,
    cors: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
    cors: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'esnext',
    minify: false,
  },
});