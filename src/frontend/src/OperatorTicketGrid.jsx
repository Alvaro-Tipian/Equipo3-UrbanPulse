import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

const N8N_BASE = 'https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook';

const ESTADOS = [
  { valor: 'pending', etiqueta: 'Pendiente', clase: 'text-amber-400 border-amber-400/40 bg-amber-400/10' },
  { valor: 'en_proceso', etiqueta: 'En Proceso', clase: 'text-blue-400 border-blue-400/40 bg-blue-400/10' },
  { valor: 'resuelto', etiqueta: 'Resuelto', clase: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10' },
];

function estadoInfo(valor) {
  return ESTADOS.find((e) => e.valor === valor) || ESTADOS[0];
}

function normalizarLista(datos) {
  // n8n (responseMode: lastNode) devuelve un objeto suelto si hay una sola fila
  if (Array.isArray(datos)) return datos;
  return datos && datos.id ? [datos] : [];
}

async function leerJson(respuesta) {
  const texto = await respuesta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

export default function OperatorTicketGrid({ session }) {
  const [tickets, setTickets] = useState([]);
  const [estadoCarga, setEstadoCarga] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  const usuarioId = session?.id || null;

  const pedirTickets = useCallback(async () => {
    const urlBase = import.meta.env.TE_N8N_REPORTS_LIST_URL || `${N8N_BASE}/urbanpulse/reports-list`;
    const respuesta = await fetch(urlBase);
    if (!respuesta.ok) throw new Error(`El servidor respondió ${respuesta.status}`);
    return normalizarLista(await leerJson(respuesta));
  }, []);

  useEffect(() => {
    let activo = true;

    pedirTickets()
      .then((lista) => {
        if (!activo) return;
        setTickets(lista);
        setEstadoCarga('listo');
      })
      .catch((err) => {
        if (!activo) return;
        setError(err.message || 'No se pudieron cargar los tickets.');
        setEstadoCarga('error');
      });

    return () => { activo = false; };
  }, [pedirTickets]);

  const recargar = () => {
    setEstadoCarga('cargando');
    setError(null);
    pedirTickets()
      .then((lista) => { setTickets(lista); setEstadoCarga('listo'); })
      .catch((err) => { setError(err.message || 'No se pudieron cargar los tickets.'); setEstadoCarga('error'); });
  };

  const cambiarEstado = async (ticket, nuevoEstado) => {
    setGuardandoId(ticket.id);
    try {
      const url = import.meta.env.TE_N8N_REPORT_RESOLVE_URL || `${N8N_BASE}/urbanpulse/report-resolve`;
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ticket.id, status: nuevoEstado, usuario_id: usuarioId }),
      });

      if (!respuesta.ok) throw new Error(`El servidor respondió ${respuesta.status}`);

      const actualizado = await leerJson(respuesta);
      if (!actualizado || (Array.isArray(actualizado) ? actualizado.length === 0 : !actualizado.id)) {
        throw new Error('el ticket ya no existe');
      }

      // Sin recargar la página: se aplica el cambio directo sobre el estado
      // local para que la grilla refleje el nuevo estado al instante.
      setTickets((previos) =>
        previos.map((t) =>
          t.id === ticket.id
            ? { ...t, status: nuevoEstado, resolved_at: nuevoEstado === 'resuelto' ? new Date().toISOString() : null }
            : t
        )
      );
    } catch (err) {
      setError(`No se pudo actualizar el ticket: ${err.message}`);
    } finally {
      setGuardandoId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Tickets</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Todos los reportes de la ciudad. Cambia el estado según se va atendiendo cada ticket.
            </p>
          </div>
          <button
            onClick={recargar}
            disabled={estadoCarga === 'cargando'}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={16} className={estadoCarga === 'cargando' ? 'animate-spin' : ''} />
            <span className="text-sm font-medium">Actualizar</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/30 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {estadoCarga === 'cargando' && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--color-accent)]">
            <Loader2 size={32} className="animate-spin mb-4" />
            <p className="text-[var(--color-text-secondary)]">Cargando tickets...</p>
          </div>
        )}

        {estadoCarga === 'listo' && tickets.length === 0 && (
          <p className="text-center text-[var(--color-text-secondary)] py-20">
            No hay tickets registrados todavía.
          </p>
        )}

        {tickets.length > 0 && (
          <div className="space-y-3">
            {tickets.map((ticket) => {
              const info = estadoInfo(ticket.status);

              return (
                <div
                  key={ticket.id}
                  data-testid={`row-${ticket.id}`}
                  className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-5 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${info.clase}`}>
                        {info.etiqueta}
                      </span>
                      {ticket.severity && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border text-[var(--color-text-secondary)] border-[var(--color-border)]">
                          {ticket.severity}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-[var(--color-text-primary)] mb-2 break-words">
                      {ticket.description || 'Sin descripción'}
                    </p>

                    <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--color-text-secondary)]">
                      {ticket.reportado_por && <span>Reportado por {ticket.reportado_por}</span>}
                      {ticket.priority != null && <span>Prioridad {ticket.priority}</span>}
                      {ticket.created_at && <span>{new Date(ticket.created_at).toLocaleString()}</span>}
                    </div>
                  </div>

                  <select
                    data-testid={`estado-selector-${ticket.id}`}
                    value={ticket.status}
                    disabled={guardandoId === ticket.id}
                    onChange={(e) => cambiarEstado(ticket, e.target.value)}
                    className="bg-[var(--color-bg-app)] text-[var(--color-text-primary)] text-xs font-medium rounded-xl border border-[var(--color-border)] px-3 py-2 shrink-0 focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
                  >
                    {ESTADOS.map((e) => (
                      <option key={e.valor} value={e.valor}>{e.etiqueta}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
