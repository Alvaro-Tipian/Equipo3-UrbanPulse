import { useState, useMemo } from 'react';
import { useOperativos, useCuadrillas, useAsignarOperativo, leerErrorN8n } from './hooks/useOperativos';
import { AlertCircle, Check, CheckCircle, ClipboardList, Clock, Construction, Loader2, MapPin, Play, RefreshCw, Signpost, Sparkles, TrafficCone, Users, Wrench, X } from 'lucide-react';

// HU-09 T04: columnas del tablero en el orden del flujo (contrato C2, 2.5).
const COLUMNAS = [
  { estado: 'planificado', titulo: 'Planificado', icono: ClipboardList, color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
  { estado: 'asignado', titulo: 'Asignado', icono: Users, color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
  { estado: 'en_curso', titulo: 'En curso', icono: Play, color: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30' },
  { estado: 'cerrado', titulo: 'Cerrado', icono: CheckCircle, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' },
];

const MENSAJES_ERROR = {
  transicion_invalida: 'Ese cambio de estado no está permitido. El tablero se actualizó con el estado real.',
  operativo_no_encontrado: 'El operativo ya no existe.',
  datos_invalidos: 'La cuadrilla no existe o no está activa.',
  rol_no_permitido: 'Solo un operador puede gestionar operativos.',
  token_invalido: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};

// Ícono y nombre legible por especialidad de cuadrilla (contrato C2, 2.4).
const ESPECIALIDADES = {
  bacheo: { icono: Construction, nombre: 'Bacheo' },
  senalizacion: { icono: Signpost, nombre: 'Señalización' },
  semaforos: { icono: TrafficCone, nombre: 'Semáforos' },
  limpieza: { icono: Sparkles, nombre: 'Limpieza' },
};
const especialidadDe = (clave) => ESPECIALIDADES[clave] || { icono: Wrench, nombre: clave || 'General' };

// HU-09 T04: selector de cuadrilla en una columna, con nombre completo.
function SelectorCuadrilla({ opId, cuadrillas, valor, actual, onElegir, deshabilitado, cargando }) {
  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-secondary)] py-2">
        <Loader2 size={13} className="animate-spin" /> Cargando cuadrillas...
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="Cuadrilla" className="flex flex-col gap-1.5" data-testid={`cuadrilla-${opId}`}>
      {cuadrillas.map((c) => {
        const { icono: Icono, nombre } = especialidadDe(c.especialidad);
        const elegida = valor === c.id;
        const esActual = actual === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={elegida}
            onClick={() => onElegir(c.id)}
            disabled={deshabilitado || esActual}
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-xl border-2 text-left transition-all active:scale-[0.98] disabled:cursor-not-allowed cursor-pointer
              ${elegida
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-transparent bg-[var(--color-card)] hover:border-[var(--color-accent)]/40'}
              ${esActual ? 'opacity-50' : ''}`}
            data-testid={`opcion-cuadrilla-${opId}-${c.id}`}
          >
            <span className={`shrink-0 p-1.5 rounded-lg ${elegida ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-bg-app)] text-[var(--color-accent)]'}`}>
              <Icono size={14} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-black text-[var(--color-text-primary)]">{c.nombre}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                {esActual ? 'Asignada actualmente' : nombre}
              </span>
            </span>
            {elegida && <Check size={15} strokeWidth={3} className="shrink-0 text-[var(--color-accent)]" />}
          </button>
        );
      })}
    </div>
  );
}

const formatearFecha = (iso) => (iso
  ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : null);

export default function TableroOperativos() {
  const { data: operativos, isLoading, isError, refetch, isRefetching } = useOperativos();
  const { data: cuadrillas = [], isLoading: cargandoCuadrillas } = useCuadrillas();
  const { mutate: asignar, isPending, variables } = useAsignarOperativo();

  // Cuadrilla elegida en el selector de cada tarjeta: { [operativo_id]: cuadrilla_id }
  const [eleccion, setEleccion] = useState({});
  // Tarjeta con el selector de cuadrilla desplegado (solo una a la vez).
  const [selectorAbierto, setSelectorAbierto] = useState(null);
  const [confirmarCierre, setConfirmarCierre] = useState(null);
  const [aviso, setAviso] = useState(null);

  const porEstado = useMemo(() => {
    const grupos = Object.fromEntries(COLUMNAS.map((c) => [c.estado, []]));
    (operativos || []).forEach((op) => { if (grupos[op.estado]) grupos[op.estado].push(op); });
    return grupos;
  }, [operativos]);

  const cambiar = (op, estado, cuadrillaId = null) => {
    setAviso(null);
    const cuadrilla = cuadrillas.find((c) => c.id === cuadrillaId);
    asignar(
      { operativo_id: op.id, estado, cuadrilla_id: cuadrillaId, cuadrilla_nombre: cuadrilla?.nombre },
      {
        onSuccess: (res) => {
          const textos = {
            asignado: `Operativo #${String(res.id).substring(0, 8)} asignado a ${res.cuadrilla?.nombre || 'la cuadrilla'}.`,
            en_curso: `Operativo #${String(res.id).substring(0, 8)} en curso.`,
            cerrado: `Operativo #${String(res.id).substring(0, 8)} cerrado. Sus ${res.reportes} incidente(s) quedaron resueltos.`,
          };
          setAviso({ tipo: 'ok', texto: textos[estado] });
          setEleccion((prev) => ({ ...prev, [op.id]: undefined }));
          setSelectorAbierto(null);
        },
        onError: (err) => {
          const { codigo } = leerErrorN8n(err);
          setAviso({ tipo: 'error', texto: MENSAJES_ERROR[codigo] || 'No se pudo actualizar el operativo. Intenta de nuevo.' });
        },
      }
    );
  };

  const ocupado = (op) => isPending && variables?.operativo_id === op.id;

  if (isLoading && !isRefetching) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="animate-spin h-12 w-12 text-[var(--color-accent)] mb-4" />
        <span className="text-[var(--color-text-secondary)] font-bold tracking-wide">Cargando operativos...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center p-5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl shadow-sm">
        <AlertCircle className="mr-3 shrink-0" size={24} />
        <p className="text-sm font-bold">No se pudieron cargar los operativos desde n8n.</p>
      </div>
    );
  }

  const abrirSelector = (op) => {
    setEleccion((prev) => ({ ...prev, [op.id]: undefined }));
    setSelectorAbierto(op.id);
  };

  const renderAcciones = (op) => {
    const reasignar = op.estado === 'asignado';
    const abierto = selectorAbierto === op.id;
    const elegida = eleccion[op.id] ?? '';

    if (op.estado === 'planificado' || op.estado === 'asignado') {
      // Selector desplegado: lista de cuadrillas + confirmar / cancelar.
      if (abierto) {
        return (
          <div className="space-y-2 p-2 -mx-1 rounded-xl bg-[var(--color-card)]/60 border border-[var(--color-border)]">
            <p className="px-1 text-[10px] font-black uppercase tracking-wider text-[var(--color-text-secondary)]">
              {reasignar ? 'Cambiar cuadrilla' : 'Elige una cuadrilla'}
            </p>
            <SelectorCuadrilla
              opId={op.id}
              cuadrillas={cuadrillas}
              valor={elegida === '' ? '' : Number(elegida)}
              actual={op.cuadrilla?.id}
              onElegir={(id) => setEleccion((prev) => ({ ...prev, [op.id]: id }))}
              deshabilitado={ocupado(op)}
              cargando={cargandoCuadrillas}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectorAbierto(null)}
                disabled={ocupado(op)}
                className="px-3 py-2 rounded-xl text-xs font-bold border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => cambiar(op, 'asignado', Number(elegida))}
                disabled={!elegida || ocupado(op)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--color-accent)] text-white hover:opacity-80 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md"
                data-testid={`asignar-${op.id}`}
              >
                {ocupado(op) ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {reasignar ? 'Reasignar' : 'Asignar'}
              </button>
            </div>
          </div>
        );
      }

      // Planificado: un solo botón para abrir el selector.
      if (!reasignar) {
        return (
          <button
            type="button"
            onClick={() => abrirSelector(op)}
            disabled={ocupado(op)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            data-testid={`abrir-asignar-${op.id}`}
          >
            {ocupado(op) ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
            Asignar cuadrilla
          </button>
        );
      }

      // Asignado: Iniciar y Cerrar; cambiar de cuadrilla queda como enlace.
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => cambiar(op, 'en_curso')}
              disabled={ocupado(op)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--color-accent)] text-white hover:opacity-80 active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-md"
              data-testid={`iniciar-${op.id}`}
            >
              {ocupado(op) && variables?.estado === 'en_curso' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Iniciar
            </button>
            <button
              type="button"
              onClick={() => setConfirmarCierre(op)}
              disabled={ocupado(op)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 border-emerald-500/50 text-emerald-500 hover:bg-emerald-500 hover:text-white active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              data-testid={`cerrar-${op.id}`}
            >
              <CheckCircle size={13} /> Cerrar
            </button>
          </div>
          <button
            type="button"
            onClick={() => abrirSelector(op)}
            disabled={ocupado(op)}
            className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 cursor-pointer"
            data-testid={`abrir-asignar-${op.id}`}
          >
            <Users size={12} /> Cambiar cuadrilla
          </button>
        </div>
      );
    }

    if (op.estado === 'en_curso') {
      return (
        <button
          type="button"
          onClick={() => setConfirmarCierre(op)}
          disabled={ocupado(op)}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-white hover:opacity-80 active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-md"
          data-testid={`cerrar-${op.id}`}
        >
          {ocupado(op) ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
          Cerrar operativo
        </button>
      );
    }

    return null; // cerrado: sin acciones (reabrir no está en el contrato)
  };

  return (
    <div className="space-y-4" data-testid="tablero-operativos">
      {/* BARRA */}
      <div className="flex flex-wrap items-center gap-3 bg-[var(--color-card)] p-4 rounded-2xl border border-[var(--color-border)] shadow-sm">
        <ClipboardList className="text-[var(--color-accent)]" size={20} />
        <p className="text-sm font-bold text-[var(--color-text-secondary)]">
          <span className="text-[var(--color-accent)]">{operativos.length}</span> operativo(s)
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

      {/* COLUMNAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNAS.map(({ estado, titulo, icono: Icono, color }) => (
          <section
            key={estado}
            className="flex flex-col bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] shadow-sm min-h-[12rem]"
            data-testid={`columna-${estado}`}
          >
            <header className="flex items-center gap-2 p-4 border-b border-[var(--color-border)]">
              <span className={`p-1.5 rounded-lg border ${color}`}><Icono size={16} /></span>
              <h3 className="font-black">{titulo}</h3>
              <span className="ml-auto px-2.5 py-0.5 rounded-full text-xs font-black bg-[var(--color-bg-app)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                {porEstado[estado].length}
              </span>
            </header>

            <div className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[36rem]">
              {porEstado[estado].length === 0 && (
                <p className="text-center text-xs font-bold text-[var(--color-text-secondary)] py-8 opacity-60">Sin operativos</p>
              )}

              {porEstado[estado].map((op) => (
                <article
                  key={op.id}
                  className={`p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-app)] space-y-3 transition-opacity ${ocupado(op) ? 'opacity-60' : ''}`}
                  data-testid={`operativo-${op.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-[var(--color-text-secondary)]" title={op.id}>#{String(op.id).substring(0, 8)}</span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--color-text-secondary)]">{op.reportes} incidente(s)</span>
                  </div>

                  <p className="flex items-center gap-1.5 font-black">
                    <MapPin size={14} className="text-[var(--color-accent)] shrink-0" /> {op.zona}
                  </p>

                  {op.cuadrilla && (
                    <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-primary)]">
                      <Users size={13} className="text-[var(--color-accent)]" /> {op.cuadrilla.nombre}
                    </p>
                  )}

                  <ul className="text-[11px] font-bold text-[var(--color-text-secondary)] space-y-0.5">
                    <li className="flex items-center gap-1"><Clock size={11} /> Creado: {formatearFecha(op.creado_en)}</li>
                    {op.asignado_en && <li className="flex items-center gap-1"><Users size={11} /> Asignado: {formatearFecha(op.asignado_en)}</li>}
                    {op.cerrado_en && <li className="flex items-center gap-1"><CheckCircle size={11} /> Cerrado: {formatearFecha(op.cerrado_en)}</li>}
                  </ul>

                  {renderAcciones(op)}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* CONFIRMAR CIERRE */}
      {confirmarCierre && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-cerrar-operativo">
          <div className="w-full max-w-md bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] shadow-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 id="titulo-cerrar-operativo" className="text-xl font-black">Cerrar operativo</h3>
              <button onClick={() => setConfirmarCierre(null)} className="cursor-pointer opacity-70 hover:opacity-100" aria-label="Cerrar"><X size={20} /></button>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">
              El operativo <span className="font-mono font-bold text-[var(--color-text-primary)]">#{String(confirmarCierre.id).substring(0, 8)}</span> de{' '}
              <span className="font-bold text-[var(--color-text-primary)]">{confirmarCierre.zona}</span> pasará a cerrado y sus{' '}
              <span className="font-bold text-[var(--color-text-primary)]">{confirmarCierre.reportes} incidente(s)</span> quedarán resueltos. No se puede reabrir.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmarCierre(null)}
                className="px-4 py-2 rounded-xl text-sm font-bold border-2 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => { cambiar(confirmarCierre, 'cerrado'); setConfirmarCierre(null); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:opacity-80 active:scale-95 transition-all cursor-pointer shadow-md"
                data-testid="confirmar-cierre"
              >
                <CheckCircle size={14} /> Cerrar operativo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
