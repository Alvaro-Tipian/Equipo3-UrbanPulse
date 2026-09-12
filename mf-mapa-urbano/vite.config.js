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
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        'react/jsx-runtime': { singleton: true },
        'react/jsx-dev-runtime': { singleton: true },
      },
      dts: false, // Forzamos a que no busque TypeScript
    }),
  ],
  envPrefix: ['VITE_', 'TE_'],
  server: {
    port: 5174,
    cors: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'chrome89',
    minify: false,
  }
});