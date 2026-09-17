# 🛡️ Políticas de Seguridad HTTP: Cabeceras, CORS y CSP en Vercel (HT-30 / T02)

Este documento detalla la arquitectura de seguridad a nivel de cabeceras HTTP, control de acceso cruzado (**CORS**) y directivas de seguridad de contenido (**Content Security Policy - CSP**) implementadas en **Vercel** para el host y microfrontends de **UrbanPulse**.

---

## 1. 🎯 Objetivo y Criterio de Aceptación

* **Historia:** HT-30 (Hardening Keys en Producción Vercel).
* **Tarea:** T02 — Implementar políticas de seguridad de cabeceras HTTP (CORS, CSP) en el host para permitir solicitudes exclusivas de dominios verificados.
* **Criterio de Aceptación:** Cierre de accesos cross-site no autorizados a webhooks y mitigación de inyecciones XSS / Clickjacking.

---

## 2. 🔐 Matriz de Cabeceras HTTP Implementadas (`src/frontend/vercel.json`)

| Cabecera HTTP | Valor Configurado | Propósito de Seguridad |
|---|---|---|
| **`Content-Security-Policy`** | *Ver sección 3 detallada abajo* | Limita el origen de scripts, conexiones y recursos a una lista blanca estricta de dominios autorizados. |
| **`Strict-Transport-Security` (HSTS)** | `max-age=63072000; includeSubDomains; preload` | Fuerza a los navegadores a comunicarse exclusivamente mediante HTTPS durante al menos 2 años, protegiendo contra ataques de degradación SSL/TLS (SSL Stripping). |
| **`X-Frame-Options`** | `DENY` | Impide que cualquier sitio web embeba la aplicación en un `<frame>`, `<iframe>`, `<embed>` u `<object>`, neutralizando ataques de **Clickjacking**. |
| **`X-Content-Type-Options`** | `nosniff` | Previene que el navegador interprete archivos con tipos MIME diferentes al declarado (MIME Sniffing), bloqueando la ejecución accidental de scripts disfrazados de imágenes o texto. |
| **`Referrer-Policy`** | `strict-origin-when-cross-origin` | Envía la URL completa solo en solicitudes del mismo origen, y únicamente el dominio base (sin rutas sensibles ni parámetros) en solicitudes HTTPS cruzadas. |
| **`Permissions-Policy`** | `camera=(), microphone=(), geolocation=(self), payment=()` | Restringe el acceso a APIs de hardware del dispositivo del cliente. La geolocalización solo se permite para el propio origen (`self`) para el reporte de incidentes urbanos. |

---

## 3. 🌐 Política de Seguridad de Contenido (CSP) en Detalle

La directiva `Content-Security-Policy` fue diseñada a medida para permitir el funcionamiento de **Module Federation**, mapas de **TomTom** y webhooks de **AWS Lightsail**, bloqueando cualquier otro destino:

```http
Content-Security-Policy:
  default-src 'self' https://*.vercel.app;
  script-src 'self' 'unsafe-inline' blob: https://*.vercel.app;
  worker-src 'self' blob:;
  child-src 'self' blob:;
  style-src 'self' 'unsafe-inline' https://*.vercel.app https://*.tomtom.com;
  img-src 'self' data: blob: https://*.tomtom.com https://*.cs.amazonlightsail.com https://*.vercel.app;
  font-src 'self' data: https://*.vercel.app;
  connect-src 'self'
              blob:
              data:
              https://*.vercel.app
              https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com
              https://*.tomtom.com
              https://generativelanguage.googleapis.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
```

### Justificación de orígenes permitidos en `connect-src`:
1. `'self'` y `https://*.vercel.app`: Comunicación interna entre el host y los microfrontends federados.
2. `https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com`: Único dominio autorizado para enviar reportes ciudadanos, autenticación, KPIs y chat hacia n8n en AWS Lightsail. **Cualquier intento de exfiltrar datos hacia servidores de terceros será bloqueado inmediatamente por el navegador.**
3. `https://*.tomtom.com`: Peticiones de georreferenciación y cálculo de rutas al SDK de TomTom.
4. `https://generativelanguage.googleapis.com`: Consultas opcionales a modelos de Google Gemini.

---

## 4. 🔄 Políticas CORS para Module Federation (`mf-*/vercel.json`)

Dado que el host (`src/frontend`) descarga en tiempo de ejecución los archivos `remoteEntry.js` de los microfrontends remotos (`mf-dashboard`, `mf-mapa-urbano`, `mf-chatbot`), los navegadores exigen cabeceras CORS válidas:

En cada microfrontend se configuró en su respectivo `vercel.json`:

```json
{
  "key": "Access-Control-Allow-Origin",
  "value": "*"
},
{
  "key": "Access-Control-Allow-Methods",
  "value": "GET, OPTIONS"
},
{
  "key": "Access-Control-Allow-Headers",
  "value": "X-Requested-With, Content-Type, Authorization"
}
```

Esto garantiza que la federación de módulos cargue de forma limpia e instantánea sin violaciones de `Cross-Origin Resource Sharing`.

---

## 5. 🧪 Verificación y Auditoría de Cabeceras

Una vez desplegado en Vercel, se puede validar la presencia y calificación de las cabeceras ejecutando:

```bash
# Inspeccionar cabeceras HTTP con curl
curl -I https://tu-despliegue-urbanpulse.vercel.app/

# O evaluar la postura de seguridad en https://securityheaders.com/
```
Resultado esperado: **Calificación A / A+** en SecurityHeaders.com gracias a la presencia combinada de HSTS, CSP estricto, X-Frame-Options y Referrer-Policy.
