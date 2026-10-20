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
        './Dashboard': './src/Dashboard.jsx',
      },
      shared: {
        react: { 
          singleton: true, 
          requiredVersion: '^19.2.8' 
        },
        'react-dom': { 
          singleton: true, 
          requiredVersion: '^19.2.8' 
        },
        'react/jsx-runtime': { 
          singleton: true 
        },
        'react/jsx-dev-runtime': { 
          singleton: true 
        },
        '@urbanpulse/shared': { singleton: true },
      },
      dts: false,
    }),
  ],
  envPrefix: ['VITE_', 'TE_'],
  server: {
    port: 5175,
    cors: true,
  },
  preview: {
    port: 5175,
    cors: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'esnext',
  },
});