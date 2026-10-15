import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate, Navigate, Link } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Map as MapIcon,
  LayoutDashboard,
  Settings,
  Activity,
  Sun,
  Moon,
  History,
  User,
  LogOut,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import '@tomtom-international/web-sdk-maps/dist/maps.css';
import { getInitialTheme, applyTheme } from './theme';
import { getSession, clearSession, subscribeSession } from '@urbanpulse/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { inicializarRemotes, cargarRemote } from './remotes';
import RemoteBoundary, { lazyRemote } from './components/RemoteBoundary';
console.log('HOST TE_N8N_BASE_URL =', import.meta.env.TE_N8N_BASE_URL);
import './index.css';
import RutaProtegida, { ROLES, getRol } from './components/RutaProtegida';

const queryClient = new QueryClient();

// Microfrontends remotos federados

const MapaUrbano = lazyRemote(() => cargarRemote('mf_mapa_urbano', './MapaUrbano'));
const Dashboard = lazyRemote(() => cargarRemote('mf_dashboard', './Dashboard'));
const Chatbot = lazyRemote(() => cargarRemote('mf_chatbot', './Chatbot'));
const GestorIncidentes = lazyRemote(() => cargarRemote('mf_gestion_incidentes', './GestorIncidentes'));
const HistorialView = lazyRemote(() => cargarRemote('mf_historial_reportes', './HistorialView'));
const AuthContainer = lazyRemote(() => cargarRemote('mf_auth', './LoginView'));
const AjustesView = lazyRemote(() => cargarRemote('mf_ajustes', './AjustesView'));
const PanelRiesgo = lazyRemote(() => cargarRemote('mf_panel_riesgo', './PanelRiesgo'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Normaliza el rol: el backend a veces envía `role` y a veces `rol`



function Spinner({ mensaje }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--color-accent)]">
      <div className="animate-spin h-8 w-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mb-4"></div>
      {mensaje}
    </div>
  );
}

// Envoltorio común para cada microfrontend: ErrorBoundary + Suspense + contenedor
function VistaRemota({ nombre, fallback, className = 'h-full w-full', children }) {
  return (
    <div className={`${className} animate-fade-in`}>
      <RemoteBoundary nombre={nombre}>
        <Suspense fallback={fallback}>{children}</Suspense>
      </RemoteBoundary>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista de inicio (ciudadano / sin sesión)
// ---------------------------------------------------------------------------

function Inicio() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-fade-in overflow-y-auto">
      <div className="p-4 bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] mb-6 shadow-[0_0_30px_rgba(168,85,247,0.15)]">
        <Activity size={48} className="text-[var(--color-accent)]" />
      </div>
      <h1 className="text-4xl font-bold mb-3 tracking-tight">
        URBAN<span className="text-[var(--color-accent)]">PULSE</span>
      </h1>
      <p className="text-[var(--color-text-secondary)] max-w-lg text-lg leading-relaxed mb-3">
        Sistema predictivo de incidentes urbanos impulsado por Inteligencia Artificial.
      </p>
      <span className="text-xs text-[var(--color-accent)] flex items-center gap-1.5 mb-10">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse"></span>
        Sistema En Línea
      </span>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
        {[
          { to: '/chatbot', label: 'Chat', desc: 'Reporta un incidente conversando con el agente de IA.', icon: MessageSquare },
          { to: '/mapa', label: 'Mapa', desc: 'Visualiza incidentes y congestión en tiempo real.', icon: MapIcon },
          { to: '/dashboard', label: 'Dashboard', desc: 'Revisa KPIs y tendencias de la ciudad.', icon: LayoutDashboard },
        ].map(({ to, label, desc, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-start text-left gap-3 p-5 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 hover:-translate-y-0.5 transition-all"
          >
            <div className="p-2 bg-[var(--color-panel)] rounded-lg border border-[var(--color-border)] text-[var(--color-accent)]">
              <Icon size={20} />
            </div>
            <span className="font-bold text-[var(--color-text-primary)]">{label}</span>
            <span className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App principal
// ---------------------------------------------------------------------------

function MainApp() {
  const [remotesListos, setRemotesListos] = useState(false);
  const [errorRemotes, setErrorRemotes] = useState(null);
  const [intento, setIntento] = useState(0);
  const [theme, setTheme] = useState(getInitialTheme);
  const [session, setSession] = useState(getSession);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelado = false;

    inicializarRemotes()
      .then(() => {
        if (!cancelado) setRemotesListos(true);
      })
      .catch((err) => {
        console.error('[UrbanPulse] Error inicializando remotes:', err);
        if (!cancelado) setErrorRemotes(err);
      });

    return () => {
      cancelado = true;
    };
  }, [intento]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => subscribeSession(setSession), []);

  // Error al cargar la topología: permitir reintentar en lugar de quedarse colgado
  if (errorRemotes) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">
        <AlertTriangle size={40} className="text-red-400" />
        <p className="font-semibold">No se pudo cargar la topología del sistema.</p>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-md">
          Revisa tu conexión o que los microfrontends estén desplegados e inténtalo de nuevo.
        </p>
        <button
          onClick={() => { setErrorRemotes(null); setIntento((n) => n + 1); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors"
        >
          <RefreshCw size={16} />
          <span className="text-xs font-medium tracking-wide">Reintentar</span>
        </button>
      </div>
    );
  }

  if (!remotesListos) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[var(--color-bg-app)] text-[var(--color-accent)]">
        <div className="animate-spin h-8 w-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mb-4"></div>
        <p className="font-medium tracking-wide">Cargando topología del sistema...</p>
      </div>
    );
  }

  const rol = session ? getRol(session) : null;
  const esOperador = rol === ROLES.OPERADOR;

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleLogout = () => {
    clearSession();
    navigate('/', { replace: true });
  };

  // Mismos roles y mismas vistas que la versión original
  let menuItems = [];

  if (!session) {
    menuItems = [
      { to: '/', label: 'INICIO', icon: Home },
      { to: '/chatbot', label: 'CHAT', icon: MessageSquare },
      { to: '/mapa', label: 'MAPA', icon: MapIcon },
      { to: '/dashboard', label: 'DASHBOARD', icon: LayoutDashboard }, // redirige a login
      { to: '/ajustes', label: 'AJUSTES', icon: Settings },
    ];
  } else if (esOperador) {
    menuItems = [
      { to: '/dashboard', label: 'DASHBOARD', icon: LayoutDashboard },
      { to: '/mapa', label: 'MAPA', icon: MapIcon },
      { to: '/incidentes', label: 'GESTIÓN DE INCIDENTES', icon: Activity },
      { to: '/panel-predictivo', label: 'RIESGO PREDICTIVO', icon: AlertTriangle }, // HU-08
      { to: '/ajustes', label: 'AJUSTES', icon: Settings },
    ];
  } else {
    menuItems = [
      { to: '/', label: 'INICIO', icon: Home },
      { to: '/chatbot', label: 'CHAT', icon: MessageSquare },
      { to: '/mapa', label: 'MAPA', icon: MapIcon },
      { to: '/dashboard', label: 'DASHBOARD', icon: LayoutDashboard },
      { to: '/historial', label: 'HISTORIAL', icon: History },
      { to: '/ajustes', label: 'AJUSTES', icon: Settings },
    ];
  }

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">

      {/* SIDEBAR */}
      <aside className="w-72 flex flex-col bg-[var(--color-panel)] border-r border-[var(--color-border)] z-10 shadow-2xl">

        {/* LOGO */}
        <div className="h-20 flex items-center px-6 border-b border-[var(--color-border)]">
          <div className="p-2 bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] mr-3 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
            <Activity className="text-[var(--color-accent)]" size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-widest">
            URBAN<span className="text-[var(--color-accent)]">PULSE</span>
          </h1>
        </div>

        {/* NAVEGACIÓN */}
        <nav className="flex-1 py-8 px-4 space-y-3 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const esPredictivo = item.to === '/panel-predictivo';
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `w-full flex items-center px-4 py-3.5 rounded-xl transition-all duration-300 border group ${
                  isActive
                    ? 'bg-[var(--color-card)] text-[var(--color-accent)] border-[var(--color-border)] shadow-[inset_0_0_20px_rgba(168,85,247,0.05)]'
                    : `bg-transparent text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--color-card)] hover:border-[var(--color-border)]/50 ${
                        esPredictivo ? 'hover:text-red-500' : 'hover:text-[var(--color-accent-light)]'
                      }`
                }`}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={20}
                      className={`mr-4 transition-transform duration-300 ${isActive ? 'scale-110 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'group-hover:scale-110'}`}
                    />
                    <span className="font-semibold text-xs tracking-wider whitespace-nowrap">
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* PERFIL / USUARIO */}
        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-panel)] space-y-3">
          {session ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)]">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--color-bg-app)] border border-[var(--color-border)] text-[var(--color-accent)] shrink-0">
                <User size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                  {session.email || session.username}
                </p>
                <p className="text-[10px] text-[var(--color-text-secondary)]">{rol}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-red-400 transition-colors shrink-0"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] transition-colors"
            >
              <User size={16} />
              <span className="text-xs font-medium tracking-wide">Iniciar sesión</span>
            </button>
          )}

          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] hover:border-[var(--color-border)]/50 transition-colors"
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            <span className="text-xs font-medium tracking-wide">
              {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            </span>
          </button>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 relative overflow-hidden bg-[var(--color-bg-app)]">
        <Routes>

          {/* INICIO: el operador no tiene Inicio, se le envía a su dashboard */}
          <Route
            path="/"
            element={esOperador ? <Navigate to="/dashboard" replace /> : <Inicio />}
          />

          {/* LOGIN: si ya hay sesión, no tiene sentido mostrarlo */}
          <Route
            path="/login"
            element={
              session ? (
                <Navigate to={esOperador ? '/dashboard' : '/'} replace />
              ) : (
                <VistaRemota nombre="mf_auth" fallback={<Spinner mensaje="Cargando módulo de autenticación..." />}>
                  <AuthContainer />
                </VistaRemota>
              )
            }
          />

          {/* CHAT */}
          <Route
            path="/chatbot"
            element={
              <VistaRemota
                nombre="mf_chatbot"
                fallback={
                  <div className="flex flex-col items-center justify-center h-full text-[var(--color-accent)]">
                    <MessageSquare size={40} className="mb-4 animate-pulse opacity-50" />
                    Inicializando Agente Conversacional...
                  </div>
                }
              >
                <Chatbot />
              </VistaRemota>
            }
          />

          {/* DASHBOARD (requiere sesión, cualquier rol) */}
          <Route
            path="/dashboard"
            element={
              <RutaProtegida session={session}>
                <VistaRemota
                  nombre="mf_dashboard"
                  className="h-full overflow-y-auto p-8"
                  fallback={<Spinner mensaje="Conectando con el panel analítico..." />}
                >
                  <Dashboard />
                </VistaRemota>
              </RutaProtegida>
            }
          />

          {/* MAPA */}
          <Route
            path="/mapa"
            element={
              <div className="h-full w-full p-6 animate-fade-in">
                <div className="w-full h-full rounded-2xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg shadow-[#000000]/50 relative">
                  <RemoteBoundary nombre="mf_mapa_urbano">
                    <Suspense
                      fallback={
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-accent)] bg-[var(--color-card)]">
                          <MapIcon size={40} className="mb-4 animate-pulse opacity-50" />
                          Cargando topología...
                        </div>
                      }
                    >
                      <MapaUrbano />
                    </Suspense>
                  </RemoteBoundary>
                </div>
              </div>
            }
          />

          {/* HISTORIAL (solo ciudadano) */}
          <Route
            path="/historial"
            element={
              <RutaProtegida session={session} roles={[ROLES.CIUDADANO]}>
                <VistaRemota nombre="mf_historial_reportes" fallback={<Spinner mensaje="Cargando historial de reportes..." />}>
                  <HistorialView session={session} />
                </VistaRemota>
              </RutaProtegida>
            }
          />

          {/* AJUSTES */}
          <Route
            path="/ajustes"
            element={
              <VistaRemota nombre="mf_ajustes" fallback={<Spinner mensaje="Cargando configuración..." />}>
                <AjustesView theme={theme} onCambiarTema={setTheme} />
              </VistaRemota>
            }
          />

          {/* GESTIÓN DE INCIDENTES (solo operador) */}
          <Route
            path="/incidentes"
            element={
              <RutaProtegida session={session} roles={[ROLES.OPERADOR]}>
                <VistaRemota
                  nombre="mf_gestion_incidentes"
                  className="h-full overflow-y-auto p-8"
                  fallback={<Spinner mensaje="Conectando con el módulo de gestión..." />}
                >
                  <GestorIncidentes />
                </VistaRemota>
              </RutaProtegida>
            }
          />

          {/* PANEL DE RIESGO PREDICTIVO - HU-08 (solo operador) */}
          <Route
            path="/panel-predictivo"
            element={
              <RutaProtegida session={session} roles={[ROLES.OPERADOR]}>
                <VistaRemota
                  nombre="mf_panel_riesgo"
                  className="h-full overflow-y-auto p-8"
                  fallback={<Spinner mensaje="Conectando con el motor predictivo de IA..." />}
                >
                  <PanelRiesgo />
                </VistaRemota>
              </RutaProtegida>
            }
          />

          {/* URL inválida → inicio */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MainApp />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
