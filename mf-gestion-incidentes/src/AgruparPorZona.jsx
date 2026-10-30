import { useState, useMemo } from 'react';
import { useIncidentesPorZona, useCrearOperativo, leerErrorN8n } from './hooks/useOperativos';
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Loader2, MapPin, Plus, RefreshCw, X } from 'lucide-react';

const getColorSeveridad = (severidad) => {
  switch (severidad) {
    case 'alta': return 'bg-red-500/10 text-red-500 border-red-500/30';
    case 'media': return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    case 'baja': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
  }
};

const MENSAJES_ERROR = {
  datos_invalidos: 'Los datos del operativo no son válidos. Revisa la selección.',
  reporte_no_disponible: 'Algunos incidentes ya no están disponibles (resueltos o en otro operativo). Se quitaron de la selección.',
  rol_no_permitido: 'Solo un operador puede crear operativos.',
  token_invalido: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

export default function AgruparPorZona() {
  const { data: zonas, isLoading, isError, refetch, isRefetching } = useIncidentesPorZona();
  const { mutate: crearOperativo, isPending } = useCrearOperativo();

  const [zonaAbierta, setZonaAbierta] = useState(null);
  // Selección por zona: { [zona_id]: Set(ids) }. Un operativo es de una sola zona.
  const [seleccion, setSeleccion] = useState({});
  const [formZona, setFormZona] = useState(null);
  const [aviso, setAviso] = useState(null); // { tipo: 'ok' | 'error', texto }

  // Incidentes disponibles por zona según la última lista de n8n.
  // La selección se filtra contra esto al leerla: si un incidente ya no está
  // (p. ej. lo tomó otro operador: 409), deja de contar como seleccionado.
  const vigentes = useMemo(
    () => new Map((zonas || []).map((z) => [z.zona_id, new Set(z.incidentes.map((i) => i.id))])),
    [zonas]
  );

  const seleccionados = (zonaId) => {
    const ids = seleccion[zonaId];
    const ok = vigentes.get(zonaId);
    if (!ids || !ok) return new Set();
    return new Set([...ids].filter((id) => ok.has(id)));
  };

  const toggleIncidente = (zonaId, id) => {
    const actual = seleccionados(zonaId);
    actual.has(id) ? actual.delete(id) : actual.add(id);
    setSeleccion((prev) => ({ ...prev, [zonaId]: actual }));
  };

  const toggleTodos = (zona) => {
    const todos = seleccionados(zona.zona_id).size === zona.incidentes.length;
    setSeleccion((prev) => ({
      ...prev,
      [zona.zona_id]: todos ? new Set() : new Set(zona.incidentes.map((i) => i.id)),
    }));
  };

  const zonaDelFormulario = useMemo(
    () => (zonas || []).find((z) => z.zona_id === formZona) || null,
    [zonas, formZona]
  );

  const handleCrear = () => {
    const ids = [...seleccionados(formZona)];
    if (!ids.length) return;
    setAviso(null);

    crearOperativo(
      { zona_id: formZona, reportes: ids },
      {
        onSuccess: (op) => {
          setAviso({ tipo: 'ok', texto: `Operativo #${String(op.id).substring(0, 8)} creado en ${zonaDelFormulario?.zona} con ${ids.length} incidente(s). Quedó como planificado.` });
          setSeleccion((prev) => ({ ...prev, [formZona]: new Set() }));
          setFormZona(null);
        },
        onError: (err) => {
          const { codigo, reportes } = leerErrorN8n(err);
          if (codigo === 'reporte_no_disponible' && reportes.length) {
            setSeleccion((prev) => {
              const actual = new Set(prev[formZona] || []);
              reportes.forEach((id) => actual.delete(id));
              return { ...prev, [formZona]: actual };
            });
          }
          setAviso({ tipo: 'error', texto: MENSAJES_ERROR[codigo] || 'No se pudo crear el operativo. Intenta de nuevo.' });
        },
      }
    );
  };

  if (isLoading && !isRefetching) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="animate-spin h-12 w-12 text-[var(--color-accent)] mb-4" />
        <span className="text-[var(--color-text-secondary)] font-bold tracking-wide">Agrupando incidentes por zona...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center p-5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl shadow-sm">
        <AlertCircle className="mr-3 shrink-0" size={24} />
        <p className="text-sm font-bold">No se pudieron cargar los incidentes por zona desde n8n.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="vista-agrupar-zona">
      {/* BARRA */}
      <div className="flex flex-wrap items-center gap-3 bg-[var(--color-card)] p-4 rounded-2xl border border-[var(--color-border)] shadow-sm">
        <MapPin className="text-[var(--color-accent)]" size={20} />
        <p className="text-sm font-bold text-[var(--color-text-secondary)]">
          Incidentes abiertos sin operativo, en <span className="text-[var(--color-accent)]">{zonas.length}</span> zona(s)
        </p>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 text-sm font-bold cursor-pointer"
        >
          <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* AVISO */}
      {aviso && (
        <div
          role="status"
          className={`flex items-start gap-3 p-4 rounded-xl border text-sm font-bold ${aviso.tipo === 'ok'
            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
            : 'bg-red-500/10 text-red-400 border-red-500/30'}`}
        >
          {aviso.tipo === 'ok' ? <CheckCircle size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
          <span className="flex-1">{aviso.texto}</span>
          <button onClick={() => setAviso(null)} className="cursor-pointer opacity-70 hover:opacity-100" aria-label="Cerrar aviso"><X size={16} /></button>
        </div>
      )}

      {zonas.length === 0 && (
        <div className="py-20 text-center bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)]">
          <CheckCircle size={48} className="mx-auto mb-4 opacity-30 text-[var(--color-accent)]" />
          <p className="font-bold text-xl">No hay incidentes por agrupar</p>
          <p className="text-sm mt-2 text-[var(--color-text-secondary)]">Todos los abiertos ya están en un operativo.</p>
        </div>
      )}

      {/* ZONAS */}
      {zonas.map((zona) => {
        const abierta = zonaAbierta === zona.zona_id;
        const sel = seleccionados(zona.zona_id);
        return (
          <div key={zona.zona_id} className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden" data-testid={`zona-${zona.zona_id}`}>
            <div className="flex items-center gap-3 p-4">
              <button
                onClick={() => setZonaAbierta(abierta ? null : zona.zona_id)}
                className="flex items-center gap-3 flex-1 text-left cursor-pointer"
                aria-expanded={abierta}
              >
                {abierta ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="font-black text-lg">{zona.zona}</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                  {zona.total} incidente(s)
                </span>
                {sel.size > 0 && (
                  <span className="text-xs font-bold text-[var(--color-text-secondary)]">{sel.size} seleccionado(s)</span>
                )}
              </button>
              <button
                onClick={() => { setFormZona(zona.zona_id); setZonaAbierta(zona.zona_id); setAviso(null); }}
                disabled={sel.size === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--color-accent)] text-white hover:opacity-80 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
              >
                <Plus size={14} /> Crear operativo
              </button>
            </div>

            {abierta && (
              <div className="border-t border-[var(--color-border)]">
                <label className="flex items-center gap-3 px-6 py-3 text-xs font-black uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-bg-app)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sel.size === zona.incidentes.length && zona.incidentes.length > 0}
                    onChange={() => toggleTodos(zona)}
                    className="accent-[var(--color-accent)] w-4 h-4"
                  />
                  Seleccionar todos
                </label>
                <ul className="divide-y divide-[var(--color-border)]">
                  {zona.incidentes.map((inc) => (
                    <li key={inc.id}>
                      <label className="flex items-center gap-4 px-6 py-3 hover:bg-[var(--color-border)]/20 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sel.has(inc.id)}
                          onChange={() => toggleIncidente(zona.zona_id, inc.id)}
                          className="accent-[var(--color-accent)] w-4 h-4"
                          data-testid={`incidente-${inc.id}`}
                        />
                        <span className="font-mono text-xs text-[var(--color-text-secondary)]" title={inc.id}>#{String(inc.id).substring(0, 8)}</span>
                        <span className="text-sm font-bold capitalize flex-1">{inc.tipo ? inc.tipo.replace(/_/g, ' ') : 'No clasificado'}</span>
                        {inc.severidad && (
                          <span className={`border text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase ${getColorSeveridad(inc.severidad)}`}>{inc.severidad}</span>
                        )}
                        <span className="text-xs font-bold text-[var(--color-text-secondary)] whitespace-nowrap">
                          {inc.creado ? new Date(inc.creado).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {/* FORMULARIO «CREAR OPERATIVO» */}
      {zonaDelFormulario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-crear-operativo">
          <div className="w-full max-w-md bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] shadow-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 id="titulo-crear-operativo" className="text-xl font-black">Crear operativo</h3>
              <button onClick={() => setFormZona(null)} disabled={isPending} className="cursor-pointer opacity-70 hover:opacity-100" aria-label="Cerrar"><X size={20} /></button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="font-bold text-[var(--color-text-secondary)]">Zona</dt>
              <dd className="font-black">{zonaDelFormulario.zona}</dd>
              <dt className="font-bold text-[var(--color-text-secondary)]">Incidentes</dt>
              <dd className="font-black">{seleccionados(formZona).size} de {zonaDelFormulario.total}</dd>
              <dt className="font-bold text-[var(--color-text-secondary)]">Estado inicial</dt>
              <dd className="font-black">Planificado</dd>
            </dl>

            <p className="text-xs text-[var(--color-text-secondary)]">
              La cuadrilla se asigna después, desde el tablero de operativos.
            </p>

            {aviso?.tipo === 'error' && (
              <p className="text-xs font-bold text-red-400">{aviso.texto}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFormZona(null)}
                disabled={isPending}
                className="px-4 py-2 rounded-xl text-sm font-bold border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCrear}
                disabled={isPending || seleccionados(formZona).size === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-[var(--color-accent)] text-white hover:opacity-80 active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-md"
                data-testid="confirmar-operativo"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
