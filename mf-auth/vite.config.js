import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';
import process from 'node:process';

// LoginView y ChatAuthGate leen TE_N8N_BASE_URL directo (no vía @urbanpulse/shared),
// así que este build también la necesita. Solo se exige en el build de Production de Vercel (no en CI ni en Preview de PRs).
const exigirN8nEnVercel = {
  name: 'exigir-n8n-en-vercel',
  configResolved(config) {
    if (process.env.VERCEL_ENV === 'production' && config.command === 'build' && !config.env.TE_N8N_BASE_URL) {
      throw new Error('Falta TE_N8N_BASE_URL en las variables de entorno de Vercel (mf-auth).');
    }
  },
};

export default defineConfig({
  envPrefix: 'TE_',
  plugins: [
    exigirN8nEnVercel,
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