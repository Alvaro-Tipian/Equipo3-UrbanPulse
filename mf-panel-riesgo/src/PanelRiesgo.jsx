import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Info, RefreshCw, Loader2 } from 'lucide-react';
import { FRANJAS, DIAS, franjaActual, obtenerRiesgo, rankingZonas } from './datosRiesgo';
import MapaRiesgo from './MapaRiesgo';
import RankingZonas from './RankingZonas';
import TarjetaModelo from './TarjetaModelo';
import './index.css';

// HU-08: Panel de riesgo predictivo (solo operador; la ruta la protege el host).
// Si la API del modelo no responde, se muestra un aviso dentro del panel
// sin bloquear el resto de la aplicación (criterio 4).

function Selector({ etiqueta, opciones, valor, onCambiar, mostrarRango }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">{etiqueta}</p>
      <div role="radiogroup" aria-label={etiqueta} className="flex gap-2">
        {opciones.map((o) => {
          const activa = o.id === valor;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={activa}
              onClick={() => onCambiar(o.id)}
              className={`flex flex-col items-start px-4 py-2 rounded-xl border transition-all text-left ${
                activa
                  ? 'bg-[var(--color-card)] border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'bg-transparent border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {mostrarRango && <Clock size={14} />} {o.label}
              </span>
              {mostrarRango && <span className="text-[11px] opacity-80">{o.rango}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PanelRiesgo() {
  const [franja, setFranja] = useState(franjaActual);
  const [dia, setDia] = useState('hoy');
  const [intento, setIntento] = useState(0);
  // Resultado de la última consulta, marcado con la combinación que lo pidió.
  // "cargando" se deriva comparando esa marca con la combinación actual,
  // así el efecto no llama a setState de forma síncrona (regla react-hooks/set-state-in-effect).
  const [resultado, setResultado] = useState({ clave: null, datos: null, error: null });
  const clave = `${franja}|${dia}|${intento}`;
  const cargando = resultado.clave !== clave;
  const datos = cargando ? null : resultado.datos;
  const error = cargando ? null : resultado.error;

  useEffect(() => {
    let activo = true;
    obtenerRiesgo(franja, dia)
      .then((r) => {
        if (activo) setResultado({ clave, datos: r, error: null });
      })
      .catch((err) => {
        if (!activo) return;
        console.error('[panel-riesgo] riesgo-predictivo:', err);
        setResultado({ clave, datos: null, error: err.message || 'La API del modelo no respondió' });
      });
    return () => {
      activo = false;
    };
  }, [franja, dia, intento, clave]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  const zonas = useMemo(() => datos?.zonas ?? [], [datos]);
  const ranking = useMemo(() => rankingZonas(zonas, 10), [zonas]);
  const infoFranja = FRANJAS.find((f) => f.id === franja);
  const infoDia = DIAS.find((d) => d.id === dia);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-red-400">
            <AlertTriangle size={22} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Panel de Riesgo Predictivo</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Nivel de riesgo que predice el modelo por zona de Lima.
              {datos?.generado && ` Generado: ${new Date(datos.generado).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}`}
            </p>
          </div>
        </div>
        {datos?.esMock && (
          <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] text-amber-500">
            <Info size={13} /> Datos simulados (mock del contrato 4.2)
          </span>
        )}
      </div>

      {/* Selectores de franja y día */}
      <div className="flex flex-wrap gap-6">
        <Selector etiqueta="Franja horaria" opciones={FRANJAS} valor={franja} onCambiar={setFranja} mostrarRango />
        <Selector etiqueta="Día" opciones={DIAS} valor={dia} onCambiar={setDia} />
      </div>

      {/* Aviso si la API del modelo no responde: no bloquea el resto de la app */}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10">
          <p className="flex items-start gap-2 text-sm text-red-500">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            No se pudo obtener la predicción de riesgo. El resto de UrbanPulse sigue funcionando.
          </p>
          <button
            onClick={reintentar}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-sm text-[var(--color-text-primary)] hover:text-[var(--color-accent-light)]"
          >
            <RefreshCw size={14} /> Reintentar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <div className="relative">
          <MapaRiesgo zonas={zonas} />
          {cargando && (
            <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-[var(--color-card)]/90 border border-[var(--color-border)] px-3 py-1.5 rounded-xl shadow-lg backdrop-blur-md">
              <Loader2 size={13} className="animate-spin text-orange-500" />
              <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
                Calculando riesgo ({infoDia?.label}, {infoFranja?.label})...
              </span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <TarjetaModelo modelo={datos?.modelo} error={error} />
          <RankingZonas zonas={ranking} franja={infoFranja} dia={infoDia} cargando={cargando} />
        </div>
      </div>
    </div>
  );
}
