import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mf_dashboard',
      filename: 'remoteEntry.js',
      exposes: {
        './Dashboard': './src/Dashboard.jsx', // Este será el archivo que exportaremos
      },
      shared: ['react', 'react-dom'],
      dts: false,
    }),
  ],
  server: {
    port: 5175,
    cors: true,
  },
  build: {
    target: 'esnext',
  }
});