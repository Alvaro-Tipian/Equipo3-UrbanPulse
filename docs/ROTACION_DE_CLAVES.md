# Rotación de claves de producción (HT-36 T06)

**DoD:** las claves anteriores son rechazadas y la checklist A3 (`docs/CHECKLIST_CONFIGURACION.md`) está firmada.

**Cuándo:** una sola vez, **después** de desplegar n8n 2.45.4 (HT-36 T05) y de configurar el SMTP (HT-36 T04, Emily), para que todo quede con claves nuevas a la vez.

**Duración:** unos 40 minutos. Avisar al equipo antes: al cambiar el secreto del token, **todas las sesiones se cierran** y hay que volver a iniciar sesión.

> Nunca pegues una clave en el chat, en un issue ni en un commit. Las anteriores se guardan solo en tu PC, en variables de entorno, hasta correr la verificación (paso final), y después se descartan.

## Qué se rota y dónde vive cada clave

| # | Clave | Dónde se genera | Dónde hay que actualizarla |
|---|---|---|---|
| 1 | **Secreto HMAC del token** (`N8N_AUTH_SECRET`) | `openssl rand -hex 32` | GitHub secret `N8N_AUTH_SECRET` → redesplegar n8n |
| 2 | **Contraseña de Neon** (rol `neondb_owner`) | Neon → Roles → **Reset password** | GitHub `DB_POSTGRESDB_PASSWORD` y `DB_PASSWORD` (si `DB_USER` es el mismo rol) · credencial **Postgres account** de n8n · redesplegar n8n |
| 3 | **Gemini** | Google AI Studio → API keys → **Create API key** | Credencial **Gemini API** de n8n · GitHub `GEMINI_API_KEY` si era la misma |
| 4 | **Groq** | console.groq.com → API Keys → **Create** | Credenciales **Groq API** y **Clasificar con Groq** de n8n · GitHub `GROQ_API_KEY` |
| 5 | **Token de Jira** | id.atlassian.com → Seguridad → API tokens → **Crear** | Credencial **Jira API** de n8n (contraseña) · GitHub `JIRA_API_TOKEN` → `terraform apply` (lo lleva a Vercel) |
| 6 | **Secreto de la función de Vercel** (`DEPLOY_WEBHOOK_SECRET`) | `openssl rand -hex 32` | GitHub `DEPLOY_WEBHOOK_SECRET` · credencial **UrbanPulse Deploy Webhook Auth** de n8n (valor `Bearer <nuevo>`) · `terraform apply` |
| 7 | **SMTP** (HT-36 T04) | Proveedor del correo → contraseña de aplicación nueva | Credencial SMTP de n8n |

**No se rota `N8N_ENCRYPTION_KEY`.** Es la clave con la que n8n cifra las credenciales guardadas: si cambia, n8n ya no puede leer ninguna. Si alguna vez hiciera falta, primero hay que exportar las credenciales descifradas.

**Fuera del alcance de T06**, pero recomendadas antes de cerrar el proyecto: `RIESGO_API_KEY`, `EVENT_ROUTER_TOKEN`, TomTom, las claves de AWS, el token de DagsHub y `TF_VERCEL_API_TOKEN`.

## Orden recomendado

El orden evita que algo quede apuntando a una clave que ya no existe.

**0. Guardar las claves anteriores en tu PC**, solo para verificar después. En PowerShell, por ejemplo: `$env:GROQ_API_KEY_ANTERIOR = "..."`. La lista de variables está en el paso final.

**1. Las que se cambian en un solo lugar: Gemini, Groq y SMTP.**
1. Crea la clave nueva.
2. Pégala en la credencial de n8n y guarda.
3. Prueba que funcione: haz una pregunta en el chat (Gemini y Groq) y pide "Olvidé mi contraseña" (SMTP).
4. **Recién ahí** borra la clave anterior en el proveedor.

**2. Jira.**
1. Crea el token nuevo.
2. Actualiza la credencial **Jira API** de n8n y el secret `JIRA_API_TOKEN` de GitHub.
3. Ejecuta **Actions → Terraform CI → Run workflow** en `main` y aprueba el `apply`. Eso actualiza `JIRA_API_TOKEN` en Vercel.
4. Redespliega el host en Vercel.
5. Revoca el token anterior en Atlassian.

**3. `DEPLOY_WEBHOOK_SECRET`.**
1. Genera el secreto nuevo con `openssl rand -hex 32`.
2. Actualiza el secret de GitHub.
3. Actualiza la credencial **UrbanPulse Deploy Webhook Auth** de n8n (valor `Bearer <nuevo>`, con el espacio).
4. Corre `terraform apply`, como en el paso 2, y redespliega el host en Vercel.

**4. Contraseña de Neon.** Es la que más afecta, porque n8n guarda ahí sus propios datos.
1. Ten abiertas, antes de empezar, las páginas de los secrets de GitHub y la credencial **Postgres account** de n8n.
2. En Neon → Roles → `neondb_owner` → **Reset password**, y copia la contraseña nueva.
3. Pégala **de inmediato** en los secrets `DB_POSTGRESDB_PASSWORD` y `DB_PASSWORD` y en la credencial **Postgres account** de n8n.
4. Ejecuta **Actions → Deploy n8n to AWS Lightsail → Run workflow**. Mientras termina (unos 5 minutos), n8n puede fallar al abrir conexiones nuevas.

**5. Secreto del token (`N8N_AUTH_SECRET`).**
1. Genera el secreto nuevo con `openssl rand -hex 32`.
2. Actualiza el secret de GitHub.
3. Ejecuta **Deploy n8n to AWS Lightsail → Run workflow**. Si en el paso 4 todavía no habías redesplegado, este despliegue toma las dos claves a la vez.
4. Desde ese momento, los tokens anteriores reciben `401` y la app lleva al login (HT-36 T03).

**6. Staging.** Repite los pasos 1, 4 y 5 en `urbanpulse-n8n-staging`, que tiene sus propias credenciales y su propio despliegue (Lightsail → Modify your deployment → variables).

## Verificación final: las claves anteriores ya no entran

Con las variables `*_ANTERIOR` definidas en tu PC:

```powershell
$env:JIRA_EMAIL = "<el correo de la cuenta de Jira>"
$env:N8N_AUTH_SECRET_ANTERIOR = "..."
$env:DEPLOY_WEBHOOK_SECRET_ANTERIOR = "..."
$env:GEMINI_API_KEY_ANTERIOR = "..."
$env:GROQ_API_KEY_ANTERIOR = "..."
$env:JIRA_API_TOKEN_ANTERIOR = "..."
$env:NEON_URL_ANTERIOR = "postgresql://neondb_owner:<anterior>@<host>/neondb?sslmode=require"
# SMTP: ademas SMTP_HOST, SMTP_USER y SMTP_PORT
$env:SMTP_PASSWORD_ANTERIOR = "..."
python ia-ops/scripts/verificar_rotacion.py
```

- La salida debe decir **RECHAZADA** en cada clave.
- Si alguna dice **SIGUE ACEPTADA**, no se terminó de rotar: revisa ese paso.
- El script no imprime las claves ni crea tickets ni datos.
- Para Neon hace falta `pip install "psycopg[binary]"`.

Toma una captura de la salida para la evidencia y **cierra la terminal**: así se borran las variables.

Por último, completa y firma la sección de HT-36 T06 en `docs/CHECKLIST_CONFIGURACION.md`.
