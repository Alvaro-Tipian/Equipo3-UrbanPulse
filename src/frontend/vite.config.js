import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

// ============================================================================
// URLs de los remoteEntry.js en producción (Vercel).
// TODO(usuario): reemplazar estos dos placeholders con las URLs reales una
// vez que mf-dashboard y mf-mapa-urbano estén desplegados en Vercel.
// Ejemplo de forma final: "https://mf-dashboard-xxxx.vercel.app/assets/remoteEntry.js"
// ============================================================================
const PROD_REMOTE_MF_DASHBOARD_URL = 'https://equipo3-urban-pulse-jti7.vercel.app/remoteEntry.js';
const PROD_REMOTE_MF_MAPA_URBANO_URL = 'https://equipo3-urban-pulse-e9i8.vercel.app/remoteEntry.js';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    plugins: [
      react(),
      federation({
        name: 'host_urbanpulse',
        remotes: {
          // Le decimos explícitamente a Vite que este remoto es un Módulo ES moderno
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
  };
});