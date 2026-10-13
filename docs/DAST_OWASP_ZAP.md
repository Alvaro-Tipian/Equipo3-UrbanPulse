# Pruebas DAST con OWASP ZAP (HT-45)

DAST (*Dynamic Application Security Testing*) ataca la aplicación **ya
desplegada y en ejecución**, a diferencia del SAST (CodeQL, HT-44), que lee el
código fuente, y del escaneo de contenedores e IaC (Trivy, HT-44), que inspecciona
imágenes y plantillas. Las tres capas encuentran cosas distintas: una cabecera
`Content-Security-Policy` ausente solo se ve con la app corriendo.

## Qué corre

| Escaneo | Objetivo | Tipo | Job |
| --- | --- | --- | --- |
| Baseline | Host React desplegado en Vercel | **Pasivo**: spider + observación del tráfico | `baseline-scan` |
| API scan | Webhooks n8n (AWS Lightsail) | **Activo**: envía payloads de ataque | `api-scan` |

El baseline usa el spider AJAX (`-j`) porque el host es una SPA con Module
Federation: el spider clásico solo vería el `index.html` y no las rutas que React
monta en el cliente.

El API scan se guía por `.zap/urbanpulse-api.openapi.yaml`, una especificación
escrita a partir de los nodos Webhook de `src/n8n-workflows/production/`. **Si se
agrega o renombra un webhook en n8n hay que reflejarlo en esa spec**, o el DAST
dejará de cubrirlo sin avisar.

## Cuándo se ejecuta

**Automáticamente, en cada despliegue de staging.** Vercel publica un
`deployment_status` por cada deploy; el workflow reacciona a los que terminan en
`success` y **no** son de producción, y escanea exactamente la URL recién
desplegada (`environment_url` del evento), no una URL fija. Así cada preview se
valida antes de que nadie proponga promoverlo.

Los despliegues de producción se saltan a propósito: producción es lo que este
gate protege, y el escaneo activo no debe correr contra datos reales de
ciudadanos.

También se puede lanzar a mano desde **Actions → DevSecOps - Pruebas DAST
(OWASP ZAP) → Run workflow**, pasando `target_url` y marcando `correr_api_scan`
si se quiere también el escaneo activo.

### Secrets

| Secret | Para qué |
| --- | --- |
| `DAST_API_BASE_URL` | Base de los webhooks n8n **de staging** (ej. `https://<n8n-staging>/webhook`) |
| `DAST_BASELINE_URL` | Solo para corridas manuales sin `target_url` |

La URL de n8n no está versionada: la spec lleva el marcador
`__ZAP_API_BASE_URL__`, que el workflow sustituye en la copia de CI.

> `DAST_API_BASE_URL` debe apuntar a staging, no a producción. El API scan es
> activo: envía payloads de inyección y **escribe datos reales** (crea reportes,
> registra usuarios).

## El gate de promoción a producción

`scripts/zap-reporte-hallazgos.mjs` termina con código 1 si encuentra algún
hallazgo de riesgo **Alto**, lo que tumba el job.

Para que eso frene de verdad la promoción hay que marcar los jobs
*ZAP Baseline* y *ZAP API Scan* como **checks requeridos** en la protección de
rama de `main`: Settings → Branches → Branch protection rules → *Require status
checks to pass before merging*. Sin ese paso el workflow informa pero no bloquea
nada.

Un hallazgo de riesgo alto que el equipo decida aceptar se marca `IGNORE` en
`.zap/rules.tsv` **con justificación escrita**; ZAP deja de reportarlo y el gate
deja de verlo. Esa es la vía deliberada para desbloquear, y queda registrada en
el repositorio.

## Dónde ver los resultados

* **Resumen del run**: el informe de hallazgos se imprime en la propia página del
  job. Es la vista rápida: clasificación de cada hallazgo y la acción tomada.
* **Pestaña Security → Code scanning**, junto a los hallazgos de CodeQL. Las
  acciones oficiales de ZAP emiten JSON/HTML/Markdown pero no SARIF, así que
  `scripts/zap-json-to-sarif.mjs` hace la conversión. Cada escaneo sube su SARIF
  bajo una categoría distinta (`dast-zap-baseline` y `dast-zap-api`) para que los
  hallazgos de uno no sobrescriban los del otro.
* **Artefactos del run**: reporte HTML navegable, el JSON crudo, el SARIF y el
  informe en Markdown.

### El informe de hallazgos

`scripts/zap-reporte-hallazgos.mjs` cruza dos fuentes: el riesgo que asignó ZAP
(la clasificación) y `.zap/rules.tsv` (la acción que el equipo decidió). Ese
cruce es el punto: un listado de alertas sin la decisión al lado no dice si
alguien ya miró ese hallazgo y lo aceptó, o si nadie lo ha visto nunca.

Los hallazgos de reglas que no están en `rules.tsv` salen marcados **SIN
REVISAR** en su propia sección, para que no pasen desapercibidos.

El riesgo de ZAP (0–3) se mapea a SARIF así: Alto → `error`, Medio y Bajo →
`warning`, Informativo → `note`. Como en DAST no hay archivo fuente, la ubicación
del hallazgo es la **ruta de la URL** afectada; la query completa viaja en el
mensaje.

## Tuning de alertas

`.zap/rules.tsv` decide qué hace cada regla (`IGNORE`, `WARN`, `FAIL`). Durante
el Sprint 3 el criterio es:

* `FAIL` para los hallazgos **ya remediados en HT-44** (CSP, HSTS, `nosniff`,
  CORS). Volver a verlos sería una regresión de seguridad.
* `IGNORE` solo con justificación escrita en el propio archivo (hoy: cookies de
  borde de Vercel y comentarios en los bundles generados por Vite, ninguno de los
  dos bajo nuestro control).
* `WARN` para el resto: aparecen en el reporte y en Code Scanning sin romper el
  build.

Los jobs corren con `fail_action: false`: el gate real es la lista `FAIL` de
`rules.tsv`, no el código de salida de ZAP.
