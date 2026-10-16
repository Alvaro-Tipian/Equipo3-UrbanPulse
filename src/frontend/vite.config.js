import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

export default defineConfig(() => {
  return {
    envPrefix: ['VITE_', 'TE_'],
    plugins: [
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