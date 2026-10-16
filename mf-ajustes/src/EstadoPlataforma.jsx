import { useCallback, useEffect, useState } from 'react';
import {
  Server, GitBranch, Cpu, Ticket, RefreshCw, Loader2, AlertTriangle, ExternalLink, Clock,
} from 'lucide-react';
import { obtenerEstadoPlataforma, PORTAL_SERVICE_DESK, LATENCIA_LENTA_MS } from './datosPlataforma';

// HU-13 / T02: estado ampliado de la plataforma (solo operador), contrato 4.3.
// Se muestra DENTRO de la sección "Estado de los servicios" de AjustesView.

function semaforo(servicio) {
  if (!servicio.ok) return { punto: 'bg-red-400', texto: 'text-red-400', label: 'Sin respuesta' };
  if (servicio.latencia_ms != null && servicio.latencia_ms > LATENCIA_LENTA_MS) {
    return { punto: 'bg-amber-400', texto: 'text-amber-400', label: 'Lento' };
  }
  return { punto: 'bg-emerald-400', texto: 'text-emerald-400', label: 'Operativo' };
}

const ESTADO_GENERAL = {
  OPERATIVO: { label: 'Operativo', clase: 'bg-emerald-400/15 text-emerald-400' },
  DEGRADADO: { label: 'Degradado', clase: 'bg-amber-400/15 text-amber-400' },
  CAIDO: { label: 'Caído', clase: 'bg-red-400/15 text-red-400' },
};

function fechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

function soloFecha(valor) {
  if (!valor) return '—';
  const [a, m, d] = String(valor).slice(0, 10).split('-').map(Number);
  const f = a && m && d ? new Date(a, m - 1, d) : new Date(valor);
  return Number.isNaN(f.getTime()) ? valor : f.toLocaleDateString('es-PE', { dateStyle: 'medium' });
}

function Bloque({ icono: Icono, titulo, children }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--color-bg-app)] border border-[var(--color-border)]">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-3">
        <Icono size={16} className="text-[var(--color-accent)]" /> {titulo}
      </p>
      {children}
    </div>
  );
}

function Linea({ etiqueta, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-[var(--color-text-secondary)] shrink-0">{etiqueta}</span>
      <span className="text-[var(--color-text-primary)] text-right break-words">{children ?? '—'}</span>
    </div>
  );
}

export default function EstadoPlataforma() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [ultimaConsulta, setUltimaConsulta] = useState(null);

  const [intento, setIntento] = useState(0);

  // Consulta el webhook al montar y en cada "Actualizar".
  // Los setState van dentro de .then/.catch (asíncronos), no en el cuerpo del efecto
  // (regla react-hooks/set-state-in-effect).
  useEffect(() => {
    let activo = true;
    obtenerEstadoPlataforma()
      .then((r) => {
        if (!activo) return;
        setDatos(r);
        setError(null);
      })
      .catch((err) => {
        if (!activo) return;
        console.error('[ajustes] estado-plataforma:', err);
        setError('No se pudo consultar el estado de la plataforma.');
      })
      .finally(() => {
        if (!activo) return;
        setUltimaConsulta(new Date());
        setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [intento]);

  // Botón "Actualizar" / "Reintentar" (evento del usuario)
  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setIntento((n) => n + 1);
  }, []);

  const sd = datos?.serviceDesk;
  const portal = sd?.portal || PORTAL_SERVICE_DESK;
  const deriva = datos?.modelo?.deriva;
  const general = ESTADO_GENERAL[datos?.estadoGeneral];

  return (
    <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            Estado de la plataforma
            {general && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${general.clase}`}>{general.label}</span>
            )}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] mt-1">
            <Clock size={12} />
            Última comprobación:{' '}
            {datos?.comprobado ? fechaHora(datos.comprobado) : ultimaConsulta ? fechaHora(ultimaConsulta.toISOString()) : '—'}
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--color-bg-app)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
          <span className="text-sm">Actualizar</span>
        </button>
      </div>

      {cargando && !datos && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Consultando servicios...
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 text-sm text-red-400 mb-4">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {datos && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Bloque icono={Server} titulo="Servicios">
            <ul className="space-y-2">
              {datos.servicios.map((s) => {
                const e = semaforo(s);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-[var(--color-text-primary)]">
                      <span className={`w-2.5 h-2.5 rounded-full ${e.punto}`} aria-hidden="true" /> {s.nombre}
                    </span>
                    <span className={`text-xs ${e.texto}`}>
                      {e.label}{s.latencia_ms != null && ` · ${s.latencia_ms} ms`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Bloque>

          <Bloque icono={GitBranch} titulo="Último despliegue a producción">
            {datos.ultimoDespliegue ? (
              <>
                <Linea etiqueta="Fecha">{fechaHora(datos.ultimoDespliegue.fecha)}</Linea>
                <Linea etiqueta="Commit">
                  <span className="font-mono">{datos.ultimoDespliegue.commit}</span>
                </Linea>
                <Linea etiqueta="Workflow">{datos.ultimoDespliegue.workflow}</Linea>
              </>
            ) : <p className="text-xs text-[var(--color-text-secondary)]">Sin datos de despliegue.</p>}
          </Bloque>

          <Bloque icono={Cpu} titulo="Modelo en uso">
            <Linea etiqueta="Versión"><span className="font-mono">{datos.modelo.version}</span></Linea>
            {datos.modelo.f1 != null && <Linea etiqueta="F1 (último monitoreo)">{datos.modelo.f1.toFixed(2)}</Linea>}
            <Linea etiqueta="Último monitoreo">
              {soloFecha(datos.modelo.fechaMonitoreo)}
              {datos.modelo.vigente === false && datos.modelo.fechaMonitoreo && <span className="text-amber-400"> · desactualizado</span>}
            </Linea>
            <Linea etiqueta="Resultado">
              {deriva === null ? (
                <span className="text-[var(--color-text-secondary)]">Sin datos de monitoreo</span>
              ) : (
                <span className={deriva ? 'text-red-400' : 'text-emerald-400'}>
                  {deriva ? 'Alerta de deriva' : 'Sin deriva'}
                </span>
              )}
            </Linea>
          </Bloque>

          <Bloque icono={Ticket} titulo="Service Desk de TI">
            <Linea etiqueta="Tickets abiertos">{sd?.ticketsAbiertos}</Linea>
            <Linea etiqueta="SLA cumplido (mes)">{sd?.slaPct != null ? `${sd.slaPct}%` : null}</Linea>
            {sd?.slaPct != null && (
              <div className="h-2 mt-1 rounded-full bg-[var(--color-border)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${Math.min(100, Math.max(0, sd.slaPct))}%` }}
                />
              </div>
            )}
            <a
              href={portal}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"
            >
              Abrir portal del Service Desk <ExternalLink size={13} />
            </a>
          </Bloque>
        </div>
      )}
    </div>
  );
}
