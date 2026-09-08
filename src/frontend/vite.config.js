import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';


const PROD_REMOTE_MF_DASHBOARD_URL = 'https://equipo3-urban-pulse-jti7.vercel.app/remoteEntry.js';
const PROD_REMOTE_MF_MAPA_URBANO_URL = 'https://equipo3-urban-pulse-e9i8.vercel.app/remoteEntry.js';
const PROD_REMOTE_MF_CHATBOT_URL = 'https://equipo3-urban-pulse-jbf3.vercel.app/remoteEntry.js';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    plugins: [
      react(),
      federation({
        name: 'host_urbanpulse',
        remotes: {
          mf_mapa_urbano: {
            type: 'module',
            name: 'mf_mapa_urbano',
            entry: isProduction ? PROD_REMOTE_MF_MAPA_URBANO_URL : 'http://localhost:5174/remoteEntry.js',
          },
          mf_dashboard: {
            type: 'module',
            name: 'mf_dashboard',
            entry: isProduction ? PROD_REMOTE_MF_DASHBOARD_URL : 'http://localhost:5175/remoteEntry.js',
          },
          mf_chatbot: {
            type: 'module',
            name: 'mf_chatbot',
            entry: isProduction ? PROD_REMOTE_MF_CHATBOT_URL : 'http://localhost:3003/remoteEntry.js', 
          },
        },
        shared: {
          'react': { singleton: true },
          'react-dom': { singleton: true },
          'react/jsx-runtime': { singleton: true },
          'react/jsx-dev-runtime': { singleton: true },
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