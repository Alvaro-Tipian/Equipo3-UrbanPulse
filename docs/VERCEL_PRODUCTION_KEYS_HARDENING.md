# 🔐 Guía Técnica: Cifrado y Hardening de API Keys en Producción Vercel (HT-30 / T01)

Este documento detalla los lineamientos y procedimientos para la gestión, cifrado y configuración de credenciales de producción en la plataforma **Vercel**, protegiendo la **API Key de TomTom** y las variables de entorno de red contra exposiciones accidentales en el frontend de **UrbanPulse**.

---

## 1. 📋 Inventario de Variables de Producción en Frontend

El frontend de UrbanPulse (Shell Host y microfrontends) requiere las siguientes variables de entorno para operar en producción. **Ninguna de estas variables debe estar quemada en el código fuente ni en archivos `.env` versionados en Git.**

| Variable | Tipo / Nivel de Seguridad | Propósito | Dónde se Configura |
|---|---|---|---|
| `VITE_TOMTOM_API_KEY` | **Sensible / Cifrado (KMS)** | Credencial de acceso al SDK de TomTom para carga de mapas vectoriales, estilos y cálculo de tráfico. | Vercel (Proyecto `mf-mapa-urbano` y `src/frontend`) |
| `TE_N8N_WEBHOOK_URL` | **Público / Endpoint de Red** | Endpoint del webhook conversacional del asistente virtual en AWS Lightsail. | Vercel (Proyecto `mf-chatbot` y `src/frontend`) |
| `TE_N8N_REPORTS_LIST_URL` | **Público / Endpoint de Red** | Endpoint para consulta de incidentes georreferenciados para el mapa. | Vercel (Proyecto `mf-mapa-urbano` y `src/frontend`) |
| `TE_N8N_REPORT_IMAGE_URL` | **Público / Endpoint de Red** | Endpoint para carga bajo demanda de fotografías de incidentes. | Vercel (Proyecto `mf-mapa-urbano`) |
| `TE_N8N_DASHBOARD_KPIS_URL` | **Público / Endpoint de Red** | Endpoint para extracción de métricas, gráficos y KPIs analíticos. | Vercel (Proyecto `mf-dashboard` y `src/frontend`) |
| `TE_N8N_AUTH_LOGIN_URL` | **Público / Endpoint de Red** | Endpoint del servicio de autenticación de operadores en n8n. | Vercel (Proyecto `mf-chatbot` y `src/frontend`) |
| `TE_N8N_REPORTS_HISTORY_URL` | **Público / Endpoint de Red** | Endpoint para consulta de historial de reportes por usuario. | Vercel (`src/frontend`) |
| `TE_N8N_REPORT_RESOLVE_URL` | **Público / Endpoint de Red** | Endpoint para actualización y resolución de tickets. | Vercel (`src/frontend`) |

---

## 2. 🛡️ Medidas de Hardening y Protección de Claves

### A. Cifrado en Reposo y Tránsito en Vercel
1. Todas las variables cargadas en la consola de Vercel se almacenan **cifradas en reposo** utilizando **AWS KMS** gestionado por la infraestructura de Vercel.
2. Al configurar `VITE_TOMTOM_API_KEY`, debe seleccionarse la opción **Sensitive Environment Variable**. Esto garantiza que:
   - El valor de la clave no sea visible para los desarrolladores en la interfaz web de Vercel una vez guardado.
   - El valor sea omitido automáticamente de los logs de compilación (`build logs`) de Vercel.
   - Únicamente el runner de compilación pueda desencriptarla en memoria durante el paso de empaquetado de Vite.

### B. Restricción de Dominio HTTP Referrer en la Consola de TomTom
Dado que las aplicaciones frontend (SPA) entregan la clave al navegador cliente para consultar los mapas vectoriales, la seguridad principal se delega en la **restricción por cabecera HTTP Referer** en el portal de TomTom:
1. Acceder al [TomTom Developer Portal](https://developer.tomtom.com/).
2. Ir a **My Apps** > Seleccionar la clave de producción de UrbanPulse.
3. En la sección **Domain Restrictions (HTTP Referrer)**, añadir los dominios autorizados:
   - `https://*.vercel.app/*`
   - `https://equipo3-urban-pulse-*.vercel.app/*`
   - `https://urbanpulse.vercel.app/*` (si existe dominio personalizado)
   - `http://localhost:3000/*` (únicamente en claves de desarrollo/preview)
4. De esta manera, si un atacante intenta extraer la API key del bundle JS, TomTom rechazará cualquier solicitud que no provenga de los dominios verificados de la aplicación.

---

## 3. ⚙️ Procedimiento de Configuración en la Consola Web de Vercel

Sigue estos pasos para provisionar las variables de producción:

1. Inicia sesión en [Vercel Dashboard](https://vercel.com/).
2. Selecciona el proyecto frontend correspondiente (`equipo3-urban-pulse` o microfrontend específico).
3. Navega a la pestaña **Settings** > **Environment Variables**.
4. Haz clic en **Add New**:
   - **Key:** `VITE_TOMTOM_API_KEY`
   - **Value:** `[TU_API_KEY_DE_TOMTOM]`
   - **Environment:** Selecciona `Production` y `Preview` (desmarca `Development` si se usa mock local).
   - **Type:** Marca la casilla **Sensitive**.
5. Presiona **Save**.
6. Repite el proceso para los endpoints de AWS Lightsail (`TE_N8N_*`) apuntando a:
   `https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/...`
7. Para aplicar los cambios, dispara un nuevo despliegue (**Redeploy**) en la pestaña **Deployments**.

---

## 4. 💻 Configuración Automatizada mediante Vercel CLI

Para equipos DevOps que configuren ambientes mediante línea de comandos, se deben ejecutar los siguientes comandos:

```bash
# 1. Iniciar sesión en Vercel CLI
npx vercel login

# 2. Vincular el proyecto local con Vercel
npx vercel link

# 3. Agregar la API Key de TomTom cifrada como sensible
npx vercel env add VITE_TOMTOM_API_KEY production --sensitive

# 4. Agregar los endpoints de n8n en AWS Lightsail
npx vercel env add TE_N8N_WEBHOOK_URL production
npx vercel env add TE_N8N_REPORTS_LIST_URL production
npx vercel env add TE_N8N_DASHBOARD_KPIS_URL production
npx vercel env add TE_N8N_AUTH_LOGIN_URL production

# 5. Desplegar a producción con las nuevas variables
npx vercel --prod
```

---

## 5. 🔍 Verificación y Auditoría de Seguridad

Para garantizar que ninguna clave se haya filtrado:
1. **Auditoría de Git:** Ejecutar `git log -S "VITE_TOMTOM_API_KEY" -p` para confirmar que ningún commit anterior contenga una clave real en texto plano.
2. **Inspección de Bundle de Producción:** Revisar que el bundle empaquetado en Vercel solo contenga variables inyectadas mediante el build step seguro de Vite (`import.meta.env`).
3. **Manejo de Degrado Gracioso:** Si la variable no existe en el entorno, el componente `MapaUrbano.jsx` muestra un aviso informativo de seguridad sin generar excepciones de ejecución (`Uncaught ReferenceError`) ni pantallas en blanco.
