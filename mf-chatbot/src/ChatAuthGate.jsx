import { useState } from 'react';
import { Bot, Lock, Mail, Loader2, AlertTriangle, CheckCircle, ArrowLeft } from 'lucide-react';

const N8N_BASE = 'https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook';

const URLS = {
  login: () => import.meta.env.TE_N8N_AUTH_LOGIN_URL || `${N8N_BASE}/urbanpulse/auth/login`,
  register: () => import.meta.env.TE_N8N_AUTH_REGISTER_URL || `${N8N_BASE}/urbanpulse/auth/register`,
  forgot: () => import.meta.env.TE_N8N_AUTH_FORGOT_URL || `${N8N_BASE}/urbanpulse/auth/forgot`,
  reset: () => import.meta.env.TE_N8N_AUTH_RESET_URL || `${N8N_BASE}/urbanpulse/auth/reset`,
};

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Si el enlace de recuperación trae el token, se abre directamente el formulario
// de nueva contraseña.
function tokenDeLaUrl() {
  try {
    return new URLSearchParams(window.location.search).get('reset_token');
  } catch {
    return null;
  }
}

// El webhook puede responder con cuerpo vacío si el workflow de n8n falla antes
// de llegar a un nodo "Respond": parseamos de forma defensiva.
async function pedir(url, cuerpo) {
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  const texto = await respuesta.text();
  let datos;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(`El servidor de autenticación respondió con JSON inválido (HTTP ${respuesta.status}).`);
  }

  if (!datos) {
    throw new Error(`El servidor de autenticación respondió vacío (HTTP ${respuesta.status}). Revisa que el workflow de n8n esté activo.`);
  }

  return datos;
}

function Campo({ icono: Icono, ...props }) {
  return (
    <div className="relative">
      <Icono size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
      <input
        {...props}
        className="w-full bg-[var(--color-bg-app)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] pl-10 pr-4 py-3 rounded-xl border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-all"
      />
    </div>
  );
}

export default function ChatAuthGate({ onAuth }) {
  const tokenInicial = tokenDeLaUrl();

  const [modo, setModo] = useState(tokenInicial ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [token] = useState(tokenInicial || '');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enlaceReset, setEnlaceReset] = useState(null);

  const limpiarMensajes = () => {
    setError(null);
    setAviso(null);
    setEnlaceReset(null);
  };

  const cambiarModo = (nuevo) => {
    limpiarMensajes();
    setModo(nuevo);
  };

  const validar = () => {
    if (modo !== 'reset' && !FORMATO_EMAIL.test(email.trim())) {
      return 'Ingresa un correo electrónico válido.';
    }
    if (modo === 'forgot') return null;
    if (password.length < 8) {
      return 'La contraseña debe tener al menos 8 caracteres.';
    }
    if ((modo === 'register' || modo === 'reset') && password !== password2) {
      return 'Las contraseñas no coinciden.';
    }
    return null;
  };

  const enviar = async (e) => {
    e.preventDefault();
    limpiarMensajes();

    const problema = validar();
    if (problema) {
      setError(problema);
      return;
    }

    setCargando(true);
    try {
      if (modo === 'forgot') {
        const datos = await pedir(URLS.forgot(), { email: email.trim() });
        if (!datos.success) throw new Error(datos.error || 'No se pudo generar el enlace.');
        setAviso('Generamos un enlace de recuperación para tu cuenta.');
        setEnlaceReset(datos.reset_url || null);
        return;
      }

      if (modo === 'reset') {
        const datos = await pedir(URLS.reset(), { token, password });
        if (!datos.success) throw new Error(datos.error || 'No se pudo cambiar la contraseña.');
        setAviso(datos.mensaje || 'Contraseña actualizada. Ya puedes iniciar sesión.');
        setModo('login');
        setPassword('');
        setPassword2('');
        return;
      }

      const url = modo === 'register' ? URLS.register() : URLS.login();
      const datos = await pedir(url, { email: email.trim(), password });

      if (!datos.success) {
        throw new Error(datos.error || 'Correo o contraseña incorrectos.');
      }

      onAuth(datos);
    } catch (err) {
      setError(err.message || 'No se pudo conectar con el servidor de autenticación.');
    } finally {
      setCargando(false);
    }
  };

  const titulos = {
    login: 'Para reportar un incidente, inicia sesión',
    register: 'Crea tu cuenta para reportar',
    forgot: 'Recuperar contraseña',
    reset: 'Define tu nueva contraseña',
  };

  const botones = {
    login: 'Iniciar sesión',
    register: 'Crear cuenta',
    forgot: 'Generar enlace',
    reset: 'Guardar contraseña',
  };

  return (
    <div className="flex flex-col h-full items-center justify-center bg-[var(--color-bg-app)] text-[var(--color-text-primary)] px-4 overflow-y-auto">
      <div className="w-full max-w-sm py-8">
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] mb-4 shadow-[0_0_30px_rgba(168,85,247,0.15)]">
            <Bot size={32} className="text-[var(--color-accent)]" />
          </div>
          <h1 className="text-xl font-bold text-center">{titulos[modo]}</h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1 text-center">
            {modo === 'forgot'
              ? 'Te daremos un enlace para definir una contraseña nueva.'
              : 'Así podemos asociar tu reporte a tu cuenta y darte seguimiento.'}
          </p>
        </div>

        {(modo === 'login' || modo === 'register') && (
          <div className="flex mb-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-1">
            {[
              { valor: 'login', etiqueta: 'Iniciar sesión' },
              { valor: 'register', etiqueta: 'Registrarse' },
            ].map(({ valor, etiqueta }) => (
              <button
                key={valor}
                type="button"
                onClick={() => cambiarModo(valor)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  modo === valor ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-secondary)]'
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={enviar} className="space-y-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-6">
          {modo !== 'reset' && (
            <Campo
              icono={Mail}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Correo electrónico"
              autoComplete="email"
              disabled={cargando}
            />
          )}

          {modo !== 'forgot' && (
            <Campo
              icono={Lock}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={modo === 'login' ? 'Contraseña' : 'Contraseña (mínimo 8 caracteres)'}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              disabled={cargando}
            />
          )}

          {(modo === 'register' || modo === 'reset') && (
            <Campo
              icono={Lock}
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Repite la contraseña"
              autoComplete="new-password"
              disabled={cargando}
            />
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-400 text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {aviso && (
            <div className="flex items-start gap-2 text-emerald-400 text-sm">
              <CheckCircle size={16} className="shrink-0 mt-0.5" />
              <span>{aviso}</span>
            </div>
          )}

          {enlaceReset && (
            <div className="text-xs bg-[var(--color-bg-app)] border border-[var(--color-border)] rounded-xl p-3 space-y-2">
              <p className="text-[var(--color-text-secondary)]">
                Todavía no hay envío de correo configurado, así que aquí tienes el enlace:
              </p>
              <a
                href={enlaceReset}
                className="block text-[var(--color-accent-light)] underline break-all"
              >
                {enlaceReset}
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="w-full py-3 bg-[var(--color-accent)] text-white font-bold rounded-xl hover:bg-[var(--color-accent-light)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {cargando ? <Loader2 size={18} className="animate-spin" /> : botones[modo]}
          </button>

          {modo === 'login' && (
            <button
              type="button"
              onClick={() => cambiarModo('forgot')}
              className="w-full text-center text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] transition-colors"
            >
              Olvidé mi contraseña
            </button>
          )}

          {(modo === 'forgot' || modo === 'reset') && (
            <button
              type="button"
              onClick={() => cambiarModo('login')}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] transition-colors"
            >
              <ArrowLeft size={13} />
              Volver a iniciar sesión
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
