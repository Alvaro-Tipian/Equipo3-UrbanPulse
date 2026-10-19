import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import process from 'node:process';

// Vite pega las variables TE_ en el JS al compilar: si falta TE_N8N_BASE_URL en
// Vercel, el deploy sale "verde" pero ninguna llamada a n8n funciona. Como el
// host sirve @urbanpulse/shared (singleton) a todos los remotos, aquí es obligatoria.
// Solo se exige en builds de Vercel (VERCEL=1) para no romper el CI.
const exigirN8nEnVercel = {
  name: 'exigir-n8n-en-vercel',
  configResolved(config) {
    if (process.env.VERCEL && config.command === 'build' && !config.env.TE_N8N_BASE_URL) {
      throw new Error('Falta TE_N8N_BASE_URL en las variables de entorno de Vercel (host).');
    }
  },
};

export default defineConfig(() => {
  return {
    envPrefix: ['VITE_', 'TE_'],
    plugins: [
      exigirN8nEnVercel,
      react(),
      federation({
        name: 'host_urbanpulse',

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

    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']
    },
    server: {
      port: 3000,
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    build: {
      target: 'esnext',
    },
  };
});