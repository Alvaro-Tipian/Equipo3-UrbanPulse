import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mf_mapa_urbano',
      filename: 'remoteEntry.js',
      exposes: {
        './MapaUrbano': './src/MapaUrbano.jsx',
      },
      shared: ['react', 'react-dom'],
      dts: false, // Forzamos a que no busque TypeScript
    }),
  ],
  server: {
    port: 5174,
    cors: true,
  },
  build: {
    target: 'chrome89',
    minify: false,
  }
});