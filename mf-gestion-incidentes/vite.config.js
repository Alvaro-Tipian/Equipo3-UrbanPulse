import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  envPrefix: ['VITE_', 'TE_'], // ← para leer TE_N8N_BASE_URL y TE_ENVIAR_TOKEN del .env
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mf_gestion_incidentes',
      filename: 'remoteEntry.js',
      exposes: {
        './GestorIncidentes': './src/GestorIncidentes.jsx',
      },
      shared: {
        'react': { singleton: true },
        'react-dom': { singleton: true },
        '@tanstack/react-query': { singleton: true },
        '@urbanpulse/shared': { singleton: true },
      },
      dts: false
    })
  ],
  server: {
    port: 5173,
    cors: true,
  },
  preview: {
    port: 5173,
    cors: true,
  },
  build: {
    target: 'esnext',
  }
});