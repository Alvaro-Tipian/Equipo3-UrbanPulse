import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mf_historial_reportes',
      filename: 'remoteEntry.js',
      exposes: {
        // Exponemos el componente HistorialView
        './HistorialView': './src/HistorialView.jsx',
      },
      shared: {
        'react': { singleton: true },
        'react-dom': { singleton: true },
        'react/jsx-runtime': { singleton: true },
        'react/jsx-dev-runtime': { singleton: true },
        '@tanstack/react-query': { singleton: true },
        '@urbanpulse/shared': { singleton: true },
      },
      dts: false,
    }),
  ],
  server: {
    port: 5176, // Puerto único para este microfrontend
  },
  preview: {
    port: 5176,
  },
  build: {
    target: 'esnext',
    minify: false,
  },
});