import { BookOpen, Info } from 'lucide-react';

// HT-50 / T04: mensaje informativo del RAG (contrato 4.8).
// Se diferencia de la tarjeta de reporte: el ciudadano CONSULTA, no registra un incidente.
//
// { "tipo": "consulta", "respuesta": "...",
//   "fuentes": [{ "distrito": "Cercado de Lima", "franja": "noche", "fuente": "SUTRAN (corte 30/09/2026)" }],
//   "sin_informacion": false }

const FRANJAS = { manana: 'mañana', tarde: 'tarde', noche: 'noche' };

// Las fichas de la red vial (SUTRAN) no tienen distrito, y "fuente" puede llegar
// como texto o como lista (["ONSV", "UrbanPulse"]) según la ficha de conocimiento_vial.
function etiquetaFuente(f) {
  const distrito = f.distrito || 'Red vial nacional';
  const origen = f.fuente ?? f.fuentes;
  const fuente = Array.isArray(origen) ? origen.join(' y ') : origen;
  return [distrito, FRANJAS[f.franja] ?? f.franja, fuente].filter(Boolean).join(' · ');
}

export default function RespuestaRAG({ respuesta, fuentes = [], sinInformacion = false }) {
  return (
    <div className="w-full rounded-2xl rounded-tl-none border border-[var(--color-border)] border-l-4 border-l-sky-400 bg-[var(--color-card)] p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-400 mb-2">
        <BookOpen size={13} /> Respuesta informativa
      </p>

      {/* Siempre como texto plano: el contenido del modelo nunca se interpreta como HTML */}
      <p className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-line">{respuesta}</p>

      {sinInformacion ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]">
          <Info size={13} className="shrink-0 mt-0.5" />
          Si estás viendo un problema en la vía, puedes reportarlo como incidente: descríbelo aquí mismo y adjunta una foto.
        </p>
      ) : (
        fuentes.length > 0 && (
          <div className="mt-3">
            <ul className="flex flex-wrap gap-1.5" aria-label="Fuentes">
              {fuentes.map((f, i) => (
                <li
                  key={`${f.distrito}-${f.franja}-${f.fuente}-${i}`}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--color-bg-app)] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                >
                  {etiquetaFuente(f)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
              Respuesta basada en datos de SUTRAN, ONSV y reportes ciudadanos.
            </p>
          </div>
        )
      )}
    </div>
  );
}
