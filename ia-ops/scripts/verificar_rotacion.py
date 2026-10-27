"""HT-36 T06 - Comprueba que las claves ANTERIORES ya no sirven.

Se corre despues de rotar (docs/ROTACION_DE_CLAVES.md). Cada clave anterior se
pasa por una variable de entorno que termina en _ANTERIOR; el script nunca la
imprime. Una prueba sin su variable queda como OMITIDA.

Ninguna prueba crea datos: los webhooks reciben un cuerpo vacio, que se
rechaza antes de llegar a Jira, y a Gemini, Groq y Jira solo se les pide un
listado.

    python ia-ops/scripts/verificar_rotacion.py

Termina con codigo 1 si alguna clave anterior sigue funcionando o una prueba
no se pudo completar.
"""
import base64
import hashlib
import hmac
import json
import os
import smtplib
import sys
import time
import urllib.error
import urllib.request

N8N_URL = os.environ.get('N8N_URL', 'https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com')
FUNCION_URL = os.environ.get('CAMBIO_DESPLIEGUE_URL', 'https://equipo3-urban-pulse.vercel.app/api/cambio-despliegue')
JIRA_BASE_URL = os.environ.get('JIRA_BASE_URL', 'https://urbanpulse-ti.atlassian.net')
TIMEOUT = 20

RECHAZADA = 'RECHAZADA'
ACEPTADA = 'SIGUE ACEPTADA'
OMITIDA = 'OMITIDA'
ERROR = 'ERROR'


def http(metodo, url, cabeceras=None, cuerpo=None):
    """Devuelve el codigo HTTP (tambien el de los errores 4xx/5xx)."""
    datos = cuerpo.encode() if isinstance(cuerpo, str) else cuerpo
    peticion = urllib.request.Request(url, data=datos, method=metodo, headers=cabeceras or {})
    try:
        with urllib.request.urlopen(peticion, timeout=TIMEOUT) as respuesta:
            return respuesta.status
    except urllib.error.HTTPError as e:
        return e.code


def veredicto(codigo, rechazos):
    if codigo in rechazos:
        return RECHAZADA, f'HTTP {codigo}'
    return ACEPTADA, f'HTTP {codigo} (se esperaba {" o ".join(map(str, rechazos))})'


def token_firmado(secreto):
    """Token como el del login de Central, valido salvo por la firma."""
    ahora = int(time.time() * 1000)
    payload = {'sub': 'verificacion@urbanpulse.pe', 'id': '00000000-0000-4000-8000-000000000000',
               'role': 'operador', 'iat': ahora, 'exp': ahora + 600_000}
    tramo = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
    firma = hmac.new(secreto.encode(), tramo.encode(), hashlib.sha256).hexdigest()
    return f'{tramo}.{firma}'


def token_n8n(anterior):
    # Con cabecera, reports-list valida siempre el token (HT-36 T01).
    codigo = http('GET', f'{N8N_URL}/webhook/urbanpulse/reports-list',
                  {'Authorization': f'Bearer {token_firmado(anterior)}', 'Origin': 'https://equipo3-urban-pulse.vercel.app'})
    return veredicto(codigo, {401})


def webhook_despliegue(anterior):
    # Header Auth de n8n: con otro secreto responde 403. Con el correcto y el
    # cuerpo vacio responderia 400, sin abrir ningun ticket.
    codigo = http('POST', f'{N8N_URL}/webhook/urbanpulse/despliegue',
                  {'Authorization': f'Bearer {anterior}', 'Content-Type': 'application/json'}, '{}')
    return veredicto(codigo, {401, 403})


def funcion_vercel(anterior):
    cuerpo = '{}'
    firma = hmac.new(anterior.encode(), cuerpo.encode(), hashlib.sha256).hexdigest()
    codigo = http('POST', FUNCION_URL,
                  {'X-UrbanPulse-Signature': firma, 'Content-Type': 'application/json'}, cuerpo)
    return veredicto(codigo, {401})


def gemini(anterior):
    codigo = http('GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
                  {'x-goog-api-key': anterior})
    return veredicto(codigo, {400, 401, 403})


def groq(anterior):
    codigo = http('GET', 'https://api.groq.com/openai/v1/models', {'Authorization': f'Bearer {anterior}'})
    return veredicto(codigo, {401, 403})


def jira(anterior):
    email = os.environ.get('JIRA_EMAIL', '')
    if not email:
        return OMITIDA, 'falta JIRA_EMAIL'
    basico = base64.b64encode(f'{email}:{anterior}'.encode()).decode()
    codigo = http('GET', f'{JIRA_BASE_URL}/rest/api/3/myself',
                  {'Authorization': f'Basic {basico}', 'Accept': 'application/json'})
    return veredicto(codigo, {401, 403})


def neon(anterior):
    """anterior = cadena de conexion completa con la contraseña anterior."""
    try:
        import psycopg  # opcional: pip install "psycopg[binary]"
    except ImportError:
        return OMITIDA, 'instala psycopg[binary] para probar Neon'
    try:
        psycopg.connect(anterior, connect_timeout=TIMEOUT).close()
    except psycopg.OperationalError as e:
        if 'password authentication failed' in str(e).lower():
            return RECHAZADA, 'autenticacion fallida'
        return ERROR, 'no se pudo conectar, pero no por la contraseña'
    return ACEPTADA, 'la conexion entro'


def smtp(anterior):
    host = os.environ.get('SMTP_HOST', '')
    usuario = os.environ.get('SMTP_USER', '')
    if not host or not usuario:
        return OMITIDA, 'faltan SMTP_HOST o SMTP_USER'
    try:
        with smtplib.SMTP(host, int(os.environ.get('SMTP_PORT', '587')), timeout=TIMEOUT) as servidor:
            servidor.starttls()
            servidor.login(usuario, anterior)
    except smtplib.SMTPAuthenticationError:
        return RECHAZADA, 'autenticacion fallida'
    return ACEPTADA, 'el login entro'


PRUEBAS = [
    ('Secreto HMAC del token (N8N_AUTH_SECRET)', 'N8N_AUTH_SECRET_ANTERIOR', token_n8n),
    ('Webhook de despliegues en n8n (DEPLOY_WEBHOOK_SECRET)', 'DEPLOY_WEBHOOK_SECRET_ANTERIOR', webhook_despliegue),
    ('Funcion de Vercel cambio-despliegue (DEPLOY_WEBHOOK_SECRET)', 'DEPLOY_WEBHOOK_SECRET_ANTERIOR', funcion_vercel),
    ('Gemini', 'GEMINI_API_KEY_ANTERIOR', gemini),
    ('Groq', 'GROQ_API_KEY_ANTERIOR', groq),
    ('Token de Jira', 'JIRA_API_TOKEN_ANTERIOR', jira),
    ('Contraseña de Neon', 'NEON_URL_ANTERIOR', neon),
    ('SMTP (HT-36 T04)', 'SMTP_PASSWORD_ANTERIOR', smtp),
]


def main():
    resultados = []
    for nombre, variable, prueba in PRUEBAS:
        anterior = os.environ.get(variable, '')
        if not anterior:
            resultados.append((nombre, OMITIDA, f'sin {variable}'))
            continue
        try:
            estado, detalle = prueba(anterior)
        except Exception as e:  # red caida, DNS, timeout: no es un rechazo
            estado, detalle = ERROR, type(e).__name__
        resultados.append((nombre, estado, detalle))

    ancho = max(len(n) for n, _, _ in resultados)
    for nombre, estado, detalle in resultados:
        print(f'{nombre.ljust(ancho)}  {estado:<15} {detalle}')
    fallidas = [r for r in resultados if r[1] in (ACEPTADA, ERROR)]
    probadas = [r for r in resultados if r[1] != OMITIDA]
    print()
    if not probadas:
        print('No se probo ninguna clave: define las variables *_ANTERIOR (ver docs/ROTACION_DE_CLAVES.md).')
        return 1
    print(f'{len(probadas) - len(fallidas)} de {len(probadas)} claves anteriores fueron rechazadas.' if not fallidas
          else f'{len(fallidas)} prueba(s) no pasaron: revisa las marcadas.')
    return 1 if fallidas else 0


if __name__ == '__main__':
    sys.exit(main())
