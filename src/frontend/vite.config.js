import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'host_urbanpulse',
      remotes: {
        // Le decimos explícitamente a Vite que este remoto es un Módulo ES moderno
        mf_mapa_urbano: {
          type: 'module',
          name: 'mf_mapa_urbano',
          entry: 'http://localhost:5174/remoteEntry.js',
        },
        mf_dashboard: {
        type: 'module',
        name: 'mf_dashboard',
        entry: 'http://localhost:5175/remoteEntry.js',
        },
      },
      shared: ['react', 'react-dom'],
      dts: false,
    }),
  ],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext', // Aseguramos compatibilidad total con módulos modernos
  },
});