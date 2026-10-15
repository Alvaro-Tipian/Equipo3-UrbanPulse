import { FileText, Camera, MapPin, Check, Pencil, ImageOff, ExternalLink } from 'lucide-react';

// Tarjeta de confirmación del reporte.
// n8n envía el resumen como texto plano:
//   "Este es tu reporte: 📝 Descripción: ... 📷 Foto: ... 📍 Ubicación: lat, lng ¿Confirmas el envío? ..."
// Aquí se separa en partes para mostrarlo como tarjeta, con la foto del ciudadano
// y botones para confirmar o corregir sin tener que escribir "sí" o "no".

function Fila({ icono: Icono, titulo, children }) {
  return (
    <div className="flex gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0">
      <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
        <Icono size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">{titulo}</p>
        <div className="text-sm text-[var(--color-text-primary)] mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export default function ResumenReporte({ resumen, imagen, onResponder, activo }) {
  const { descripcion, fotoAdjunta, lat, lng } = resumen;
  const mapa = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

  return (
    <div className="w-full max-w-sm rounded-2xl rounded-tl-none border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-accent)]/5">
        <p className="text-sm font-bold text-[var(--color-text-primary)]">Revisa tu reporte</p>
        <p className="text-xs text-[var(--color-text-secondary)]">Confirma que los datos son correctos antes de enviarlo.</p>
      </div>

      <div className="px-4">
        <Fila icono={FileText} titulo="Descripción">
          <span className="break-words">{descripcion || '—'}</span>
        </Fila>

        <Fila icono={Camera} titulo="Foto">
          {imagen ? (
            <img
              src={imagen}
              alt="Foto del incidente"
              className="mt-1 w-full max-h-48 rounded-lg object-cover border border-[var(--color-border)]"
            />
          ) : fotoAdjunta ? (
            <span className="text-[var(--color-text-secondary)]">Foto adjuntada</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)]">
              <ImageOff size={14} /> Sin foto
            </span>
          )}
        </Fila>

        <Fila icono={MapPin} titulo="Ubicación">
          <span className="font-mono text-xs">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          <a
            href={mapa}
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
          >
            Ver en el mapa <ExternalLink size={11} />
          </a>
        </Fila>
      </div>

      {activo ? (
        <div className="grid grid-cols-2 gap-2 p-3 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => onResponder('no')}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-colors"
          >
            <Pencil size={14} /> Corregir
          </button>
          <button
            type="button"
            onClick={() => onResponder('sí')}
            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent-light)] transition-colors"
          >
            <Check size={14} /> Sí, enviar
          </button>
        </div>
      ) : (
        <p className="px-4 py-2 text-[11px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]">
          También puedes responder escribiendo «sí» o «no».
        </p>
      )}
    </div>
  );
}
