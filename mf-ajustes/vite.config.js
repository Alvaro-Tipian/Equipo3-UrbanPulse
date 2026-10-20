import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  envPrefix: ['VITE_', 'TE_'],
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mf_ajustes',
      filename: 'remoteEntry.js',
      exposes: {
        './AjustesView': './src/AjustesView.jsx',
        './theme': './src/theme.js',
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
  server: {
    port: 5178,
    cors: true,
  },
  preview: {
    port: 5178,
    cors: true,
  },
  build: {
    target: 'esnext',
    minify: false,
  },
});