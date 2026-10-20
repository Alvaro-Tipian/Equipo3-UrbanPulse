import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { NIVELES } from './datosRiesgo';

// HU-08 / T03: ranking de las 10 zonas más riesgosas con sus motivos (contrato 4.2: zonas[].motivos)
export default function RankingZonas({ zonas, franja, dia, cargando }) {
  const [abierta, setAbierta] = useState(0);

  return (
    <section className="p-4 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)]">
      <h3 className="text-sm font-bold text-[var(--color-text-primary)]">Zonas más riesgosas</h3>
      <p className="text-[11px] text-[var(--color-text-secondary)] mb-4">
        {dia?.label} · {franja?.label} ({franja?.rango})
      </p>

      <ol className="space-y-1.5">
        {zonas.map((z, i) => {
          const nivel = NIVELES[z.nivel];
          const expandida = abierta === i;
          return (
            <li key={z.zona_id} className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <button
                onClick={() => setAbierta(expandida ? null : i)}
                aria-expanded={expandida}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-panel)] transition-colors"
              >
                <span className="text-xs w-5 text-[var(--color-text-secondary)]">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-[var(--color-text-primary)] truncate">{z.nombre}</span>
                  <span className="block text-[11px] text-[var(--color-text-secondary)] truncate">{z.distrito}</span>
                </span>
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md text-white shrink-0"
                  style={{ backgroundColor: nivel?.color ?? 'rgb(148,163,184)' }}
                  title={`Riesgo ${nivel?.label ?? z.nivel} · confianza del modelo ${Math.round(z.probabilidad * 100)}%`}
                >
                  {nivel?.label ?? z.nivel} · {Math.round(z.probabilidad * 100)}%
                </span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-[var(--color-text-secondary)] transition-transform ${expandida ? 'rotate-180' : ''}`}
                />
              </button>

              {expandida && (
                <div className="px-3 pb-3 pt-1 bg-[var(--color-panel)]">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Motivos</p>
                  {z.motivos?.length ? (
                    <ul className="space-y-1">
                      {z.motivos.map((m) => (
                        <li key={m} className="flex gap-2 text-xs text-[var(--color-text-primary)] leading-relaxed">
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-[var(--color-accent)] shrink-0" />
                          {m}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--color-text-secondary)]">El modelo no reportó motivos para esta zona.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}

        {!zonas.length && !cargando && (
          <li className="text-xs text-[var(--color-text-secondary)]">Sin datos para esta franja.</li>
        )}
      </ol>
    </section>
  );
}
