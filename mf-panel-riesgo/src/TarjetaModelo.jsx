import { Cpu, Activity, CalendarDays, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';

// HU-08 / T03: tarjeta del modelo en producción.
// Se alimenta del bloque `modelo` del webhook de riesgo predictivo (contrato 4.2):
// { version, f1_macro, entrenado, sesgo_ok, monitoreo: { fecha, deriva } }

function fecha(valor) {
  if (!valor) return '—';
  // "2026-10-03" se interpreta como fecha local, sin desfase de zona horaria
  const [a, m, d] = String(valor).slice(0, 10).split('-').map(Number);
  const f = a && m && d ? new Date(a, m - 1, d) : new Date(valor);
  return Number.isNaN(f.getTime()) ? valor : f.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Fila({ icono: Icono, titulo, children }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-t border-[var(--color-border)] first:border-t-0">
      <span className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <Icono size={14} /> {titulo}
      </span>
      <span className="text-xs text-right text-[var(--color-text-primary)]">{children}</span>
    </div>
  );
}

function Insignia({ ok, textoOk, textoMal, textoPendiente = 'Sin datos' }) {
  // ok === null/undefined: el dato todavía no existe (no se inventa true ni false)
  if (ok === null || ok === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-slate-500/10 text-[var(--color-text-secondary)] border-[var(--color-border)]">
        {textoPendiente}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
        ok
          ? 'bg-green-500/15 text-green-500 border-green-500/30'
          : 'bg-red-500/15 text-red-500 border-red-500/30'
      }`}
    >
      {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {ok ? textoOk : textoMal}
    </span>
  );
}

export default function TarjetaModelo({ modelo, error }) {
  const contenedor = 'p-4 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)]';

  if (error || !modelo) {
    return (
      <section className={contenedor}>
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)] mb-2">
          <Cpu size={16} /> Modelo en producción
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {error ? 'No disponible: la API del modelo no respondió.' : 'Cargando...'}
        </p>
      </section>
    );
  }

  // null = todavía no hay ningún monitoreo registrado (HT-49)
  const deriva = modelo.monitoreo ? modelo.monitoreo.deriva : null;

  return (
    <section className={contenedor}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
          <Cpu size={16} /> Modelo en producción
        </h3>
        <span className="text-sm font-bold font-mono text-[var(--color-accent)]">{modelo.version || '—'}</span>
      </div>

      <Fila icono={Activity} titulo="F1 (macro)">
        <span className="font-semibold">{typeof modelo.f1_macro === 'number' ? modelo.f1_macro.toFixed(2) : '—'}</span>
      </Fila>
      <Fila icono={CalendarDays} titulo="Fecha de entrenamiento">{fecha(modelo.entrenado)}</Fila>
      <Fila icono={modelo.sesgo_ok === false ? ShieldAlert : ShieldCheck} titulo="Pruebas de sesgo">
        <Insignia ok={modelo.sesgo_ok} textoOk="Aprobadas" textoMal="No aprobadas" textoPendiente="Pendiente (HT-48)" />
      </Fila>
      <Fila icono={AlertTriangle} titulo="Último monitoreo">
        <span className="flex flex-col items-end gap-1">
          <Insignia ok={deriva === null ? null : !deriva} textoOk="Sin deriva" textoMal="Alerta de deriva" textoPendiente="Sin monitoreo aún" />
          {modelo.monitoreo?.fecha && (
            <span className="text-[10px] text-[var(--color-text-secondary)]">{fecha(modelo.monitoreo.fecha)}</span>
          )}
        </span>
      </Fila>
    </section>
  );
}
