# 🎫 Función serverless `cambio-despliegue` (T06)

**Endpoint:** `POST /api/cambio-despliegue` (proyecto `host`, Vercel, raíz `src/frontend`)
**Archivo:** `src/frontend/api/cambio-despliegue.js`
**Autora:** Emily

> Nota de media página para Sergio, pensada para el SAD v4 (sección del
> contrato 4.6).

---

## Qué hace

Recibe el POST firmado que manda GitHub Actions al terminar un despliegue
(commit, workflow y resultado del health check), valida la firma y el
contenido, y crea una **Solicitud de cambio** en el Service Desk de Jira
(proyecto `UPTI`, mismo `requestTypeId` que usa el webhook de n8n de HT-41
T03). Es la pieza *serverless* equivalente a ese webhook, para pipelines que
prefieren llamar directo a una función en vez de pasar por n8n.

## Contrato

```http
POST /api/cambio-despliegue
X-UrbanPulse-Signature: <HMAC-SHA256 hex del cuerpo, con DEPLOY_WEBHOOK_SECRET>
Content-Type: application/json

{
  "servicio": "urbanpulse-api",
  "commit": "9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a",
  "workflow": "Deploy API de riesgo vial to AWS Lightsail",
  "run_url": "https://github.com/.../actions/runs/38460872588",
  "health_check": "ok"
}
```

La firma se calcula sobre el **cuerpo crudo** (no sobre el JSON re-serializado)
y se compara con `crypto.timingSafeEqual` para evitar ataques de
temporización.

| Código | Cuándo |
|---|---|
| `201` | Ticket creado. `{ "id": "UPTI-123", "url": "https://..." }` |
| `400` | Falta un campo del contrato o el cuerpo no es JSON válido |
| `401` | La firma no coincide o falta la cabecera |
| `502` | Jira rechazó la solicitud, o el proyecto no tiene portal de Service Desk — se devuelve el detalle tal cual, para no tener que adivinar en el log del despliegue |

## Quién la llama

El paso **Registrar Solicitud de Cambio en Jira Service Desk (HT-41 T06)** de
`deploy-api-inferencia.yml`, al terminar un despliegue verificado de la API de
riesgo vial. Firma con el secret `DEPLOY_WEBHOOK_SECRET` de GitHub y llama a
`https://equipo3-urban-pulse.vercel.app/api/cambio-despliegue` (se puede cambiar
con la variable de repositorio `CAMBIO_DESPLIEGUE_URL`). Los despliegues de n8n
siguen yendo al webhook de n8n (HT-41 T03), así que cada despliegue abre un
solo ticket. Si la respuesta no es `201`, el paso avisa sin bloquear el
despliegue.

## Variables de entorno (pido que las registres en Terraform, HT-42 T01)

| Variable | Para qué |
|---|---|
| `DEPLOY_WEBHOOK_SECRET` | Secreto compartido con el pipeline que firma el POST |
| `JIRA_BASE_URL` | `https://urbanpulse-ti.atlassian.net` |
| `JIRA_EMAIL` | Cuenta de servicio con acceso al portal |
| `JIRA_API_TOKEN` | Token de esa cuenta |

Las cuatro como **sensibles** (`vercel_project_environment_variable` con
`sensitive = true`), en el proyecto `host` (`src/frontend`).

Una vez registradas, le paso a Álvaro la URL de la función
(`https://<dominio-del-host>/api/cambio-despliegue`) y el valor del secreto
por GitHub Secrets, para que lo use el paso que llama a esta función desde el
pipeline.

## Límites del plan Hobby de Vercel que aplican

- **Duración máxima de la función:** 300 s (el tope del plan, no solo el
  default) — de sobra para un POST a Jira.
- **Memoria/CPU:** 2 GB / 1 vCPU, fijo (no se puede pedir más en Hobby).
- **Timeout del proxy de Vercel:** 120 s por request, antes de llegar a la
  función.
- El plan Hobby es para proyectos personales/sin fines comerciales según los
  términos de Vercel — el proyecto `host` ya corre ahí para el resto del
  frontend, así que no es un límite nuevo que introduzca esta función, pero
  vale tenerlo presente si el equipo evalúa pasar a Pro por otras razones
  (más invocaciones/GB-hora al mes, logs por más tiempo, etc.).

## Pendiente antes de la Review

- [ ] Sergio registra las 4 variables en Terraform y hace `apply`.
- [ ] Deploy del proyecto `host` con la función ya en `main`.
- [ ] Prueba real con `curl` (firma válida → 201, firma inválida → 401) y
      guardar la salida como evidencia de T06.
- [x] Paso del pipeline que llama a la función (`deploy-api-inferencia.yml`). Usa el mismo secret `DEPLOY_WEBHOOK_SECRET` de GitHub que Terraform carga en Vercel.

Pruebas unitarias (firma, campos faltantes, 201, 502, portal inexistente):
`src/frontend/api/cambio-despliegue.test.js` — `npm test` dentro de
`src/frontend`.
