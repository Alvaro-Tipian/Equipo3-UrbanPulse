import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mf_chatbot',
      filename: 'remoteEntry.js',
      exposes: {
        './Chatbot': './src/NLQCommandCenter.jsx',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        'react/jsx-runtime': { singleton: true },
        'react/jsx-dev-runtime': { singleton: true },
      },
      dts: false,
    })
  ],
  envPrefix: ['VITE_', 'TE_'],
  server: {
    port: 3003,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
});