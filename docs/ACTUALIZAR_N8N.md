# Actualizar n8n (HT-36 T05)

**Versión:** de `n8nio/n8n:2.34.6` a `n8nio/n8n:2.45.4`, fijada en `infrastructure/lightsail-containers.json.template` y en `infrastructure/docker-compose.yml`.

## Por qué 2.45.4 y no 2.42.3

El backlog pedía 2.42.3, la versión que corregía los hallazgos de septiembre. Pero las CVE siguen apareciendo, y con el gate de `trivy-scan.yml` (CRITICAL con parche, `ignore-unfixed`), al 27/10/2026 quedaba así:

| Versión | CRITICAL con parche |
|---|---|
| 2.34.6 (actual) | 34 (Alpine `openssh`, `vm2`, `handlebars`, `simple-git`, `shell-quote`, `proxy-addr`) |
| 2.42.3 (backlog) | 13 |
| 2.44.7 | 4 |
| **2.45.4** | **0** |

El DoD pide "Trivy sin vulnerabilidades críticas", y solo 2.45.4 lo cumple.

## Qué se revisó antes de subir de versión

- **Changelog de 2.35 a 2.45:** no hay cambios marcados como *breaking*.
  - El nodo Postgres cambió cómo separa los parámetros con comas, pero solo desde la versión 2.8 del nodo. Los nuestros son 2.5 y 2.7, así que se comportan igual.
  - El webhook mantiene la misma lógica de CORS.
- **Prueba local con 2.45.4** y la configuración de producción (`N8N_RUNNERS_ENABLED=false`, `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`):
  - Se importaron los 19 workflows del repositorio sin errores.
  - Un webhook armado con los nodos reales de `report-resolve` (validación del token y CORS) respondió así:

    | Petición | Respuesta |
    |---|---|
    | Preflight desde la app | `204`, con su origen y `authorization` permitido |
    | Preflight desde un origen ajeno | `204`, con el origen de producción (el navegador bloquea) |
    | Sin token | `200`, en modo transición |
    | Firma alterada | `401` |
    | Rol ciudadano | `403` |
    | Rol operador | `200`, con el usuario del token |

    Es decir: `$env`, `require('crypto')` y `Respond to Webhook` funcionan igual que en 2.34.6.

## Pasos (los hace quien opera Lightsail y Neon)

**1. Respaldar la base de n8n.** Al arrancar, n8n 2.45 migra su esquema en Neon (`neondb`). Si después hay que volver a 2.34.6, se necesita la base como estaba antes.
- Neon → proyecto → **Branches** → **Create branch** desde `main`, con el nombre `respaldo-n8n-2-34-6`.

**2. Staging primero.**
- Lightsail → `urbanpulse-n8n-staging` → **Deployments** → **Modify your deployment** → imagen `n8nio/n8n:2.45.4` → **Save and deploy**.
- Abrir `https://urbanpulse-n8n-staging.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/healthz`: debe responder `{"status":"ok"}`.
- Entrar al editor y revisar que los workflows abran y estén publicados.

**3. Producción.** Se despliega sola al mergear el PR, porque `deploy-lightsail-n8n.yml` corre en cada push a `main` y espera a que `/healthz` responda `200`.

**4. Verificar en producción:**
- [ ] `/healthz` responde `ok`, y en **Settings → About n8n** dice 2.45.4.
- [ ] La app: el mapa carga los reportes, el chat responde y el login funciona.
- [ ] `estado-plataforma` responde.
- [ ] Se crea la Solicitud de cambio del despliegue en Jira (HT-41 T03).
- [ ] En **Executions** no aparecen errores nuevos.

## Volver atrás

1. En el template, la imagen vuelve a `n8nio/n8n:2.34.6`, por PR. O, más rápido: Lightsail → `urbanpulse-n8n` → **Deployment versions** → la versión anterior → **Modify and redeploy**.
2. Si 2.34.6 no arranca porque el esquema ya está migrado, apuntar la base al branch `respaldo-n8n-2-34-6` de Neon. Las ejecuciones guardadas después de la actualización se pierden; los workflows y las credenciales no.
