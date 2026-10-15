import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import process from 'node:process';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'TE_']);
  const MF_AUTH_URL = env.TE_MF_AUTH_URL || 'http://localhost:5177/remoteEntry.js';

  return {
    plugins: [
      react(),
      federation({
        name: 'mf_chatbot',
        filename: 'remoteEntry.js',
        remotes: {
          mf_auth: { type: 'module', name: 'mf_auth', entry: MF_AUTH_URL },
        },
        exposes: { './Chatbot': './src/NLQCommandCenter.jsx' },
        shared: {
          react: { singleton: true },
          'react-dom': { singleton: true },
          'react/jsx-runtime': { singleton: true },
          'react/jsx-dev-runtime': { singleton: true },
          '@urbanpulse/shared': { singleton: true },
        },
        dts: false,
      }),
    ],
    envPrefix: ['VITE_', 'TE_'],
    server: { port: 3003, cors: true },
    build: { target: 'esnext' },
    preview: { port: 3003, strictPort: true, cors: true },
    resolve: { dedupe: ['react', 'react-dom'] },
  };
});