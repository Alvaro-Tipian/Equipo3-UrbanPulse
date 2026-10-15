import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mf_auth',
      filename: 'remoteEntry.js',
      exposes: {
        './LoginView': './src/LoginView.jsx',
        './ChatAuthGate': './src/ChatAuthGate.jsx',
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
    port: 5177,
  },
  preview: {
    port: 5177,
  },
  build: {
    target: 'esnext',
    minify: false,
  },
});