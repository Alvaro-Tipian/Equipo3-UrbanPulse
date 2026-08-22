# UrbanPulse — Shell (Host)

Este proyecto es el **shell** (host) de Module Federation de UrbanPulse. Corre con **Vite** y consume dos microfrontends remotos vía Module Federation:

- `mf_dashboard` (repo `mf-dashboard/`), expone `./Dashboard`
- `mf_mapa_urbano` (repo `mf-mapa-urbano/`), expone `./MapaUrbano`

También incluye el formulario de reporte ciudadano (descripción, foto, geolocalización) que envía los datos al webhook de n8n (`WEBHOOK_URL` en `src/App.jsx`).

## Cómo correr el shell en local

```bash
npm install
npm run dev
```

Esto levanta el shell en `http://localhost:3000`.

**Importante:** en modo desarrollo, `vite.config.js` apunta los remotos a `http://localhost:5174/remoteEntry.js` (mf-mapa-urbano) y `http://localhost:5175/remoteEntry.js` (mf-dashboard). Para que el Dashboard y el Mapa carguen correctamente en local, ambos microfrontends deben estar corriendo (`npm run dev` en cada uno) **antes** de levantar el shell.

## Producción / Vercel

Para producción, `vite.config.js` usa dos constantes con placeholders (`PROD_REMOTE_MF_DASHBOARD_URL` y `PROD_REMOTE_MF_MAPA_URBANO_URL`) que **deben reemplazarse con las URLs reales de `remoteEntry.js`** una vez que `mf-dashboard` y `mf-mapa-urbano` estén desplegados en Vercel. Si esas URLs no se configuran, el build de producción del shell no podrá cargar el Dashboard ni el Mapa (verás el fallback de carga indefinidamente o un error de red).

Otros scripts disponibles:

```bash
npm run build    # build de producción (Vite)
npm run preview  # sirve el build de producción localmente
```

## Estructura

- `src/App.jsx` — shell con pestañas simples (Reportar incidente / Dashboard / Mapa), formulario de reporte ciudadano y carga perezosa (`React.lazy` + `Suspense`) de los dos remotos.
- `vite.config.js` — configuración de Vite + Module Federation (host).
