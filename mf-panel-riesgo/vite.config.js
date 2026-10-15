import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  envPrefix: ['VITE_', 'TE_'],   // ← NUEVO: permite leer las variables TE_ del .env
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mf_panel_riesgo',
      filename: 'remoteEntry.js',
      exposes: {
        './PanelRiesgo': './src/PanelRiesgo.jsx',
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
  server: { port: 5181, cors: true },
  preview: { port: 5181, cors: true },
  build: { target: 'esnext' }
});