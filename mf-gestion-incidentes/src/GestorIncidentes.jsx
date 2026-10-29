import { useState, useMemo } from 'react';
import { useReportesOperador, useActualizarReporte } from './hooks/useReportes';
import { AlertCircle, CheckCircle, Clock, Activity, Filter, Loader2, RotateCcw, RefreshCw, User } from 'lucide-react';
import AgruparPorZona from './AgruparPorZona';
import TableroOperativos from './TableroOperativos';
import './index.css';

const getColorSeveridad = (severidad) => {
  switch (severidad) {
    case 'alta': return 'bg-red-500/10 text-red-500 border-red-500/30';
    case 'media': return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    case 'baja': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
  }
};

const getColorEstado = (estado) => {
  const estadoStr = (estado || '').toLowerCase();
  if (estadoStr === 'resuelto') return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
  if (estadoStr === 'en proceso' || estadoStr === 'en_proceso') return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
  return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
};

export default function GestorIncidentes() {
  const { data: reportes, isLoading, isError, refetch, isRefetching } = useReportesOperador();
  const { mutate: actualizarEstado, isPending } = useActualizarReporte();
  
  const [reporteCambiando, setReporteCambiando] = useState(null);
  const [filtroCategoria, setFiltroCategoria] = useState('todas');
  const [filtroSeveridad, setFiltroSeveridad] = useState('todas');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  // HU-09 T03/T04: pestaña activa ('bandeja' | 'zonas' | 'operativos')
  const [vista, setVista] = useState('bandeja');

  const reportesFiltrados = useMemo(() => {
    if (!reportes) return [];
    return reportes.filter((reporte) => {
      const cumpleCategoria = filtroCategoria === 'todas' || reporte.tipo === filtroCategoria;
      const cumpleSeveridad = filtroSeveridad === 'todas' || reporte.severidad === filtroSeveridad;
      const estadoNormalizado = (reporte.estado || '').toLowerCase().replace(/_/g, ' ');
      const cumpleEstado = filtroEstado === 'todos' || estadoNormalizado === filtroEstado.toLowerCase();
      return cumpleCategoria && cumpleSeveridad && cumpleEstado;
    });
  }, [reportes, filtroCategoria, filtroSeveridad, filtroEstado]);

  const categoriasUnicas = useMemo(() => {
    if (!reportes) return [];
    const categorias = new Set(reportes.map(r => r.tipo).filter(Boolean));
    return Array.from(categorias);
  }, [reportes]);

  const handleCambiarEstado = (id, nuevoEstado) => {
    setReporteCambiando(id);
    actualizarEstado(
      { id, nuevoEstado },
      { onSettled: () => setReporteCambiando(null) }
    );
  };

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6 bg-[var(--color-bg-app)] text-[var(--color-text-primary)] min-h-screen transition-colors duration-200">
      
      {/* CABECERA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--color-card)] p-6 rounded-2xl shadow-sm border border-[var(--color-border)]">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-[var(--color-accent)]/10 rounded-xl border border-[var(--color-accent)]/20">
            <Activity className="text-[var(--color-accent)]" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-[var(--color-text-primary)]">Gestión de Incidentes</h2>
            <p className="text-sm text-[var(--color-text-secondary)] font-medium mt-1">Panel de control operativo en tiempo real</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isRefetching || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 transition-colors disabled:opacity-50 text-sm font-bold shadow-sm cursor-pointer"
          >
            <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <div className="px-4 py-2 bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20 rounded-full text-xs font-bold shadow-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse"></span>
            En Línea
          </div>
        </div>
      </div>

      {/* PESTAÑAS (HU-09 T03 y T04) */}
      <div className="flex flex-wrap gap-2">
        {[['bandeja', 'Bandeja'], ['zonas', 'Agrupar por zona'], ['operativos', 'Operativos']].map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => setVista(k)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border cursor-pointer transition-colors ${vista === k
              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]'}`}
            data-testid={`pestana-${k}`}
          >
            {t}
          </button>
        ))}
      </div>

      {vista === 'zonas' && <AgruparPorZona />}
      {vista === 'operativos' && <TableroOperativos />}

      {/* ESTADOS DE CARGA Y ERROR */}
      {vista === 'bandeja' && isLoading && !isRefetching && (
        <div className="flex flex-col items-center justify-center py-32">
          <Loader2 className="animate-spin h-12 w-12 text-[var(--color-accent)] mb-4" />
          <span className="text-[var(--color-text-secondary)] font-bold tracking-wide">Conectando con la base de datos...</span>
        </div>
      )}

      {vista === 'bandeja' && isError && (
        <div className="flex items-center p-5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl shadow-sm">
          <AlertCircle className="mr-3 shrink-0" size={24} />
          <p className="text-sm font-bold">Error de conexión. No se pudieron cargar los incidentes desde n8n.</p>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL */}
      {vista === 'bandeja' && !isLoading && !isError && (
        <>
          {/* BARRA DE FILTROS */}
          <div className="flex flex-wrap items-center gap-4 bg-[var(--color-card)] p-4 rounded-2xl border border-[var(--color-border)] shadow-sm">
            <div className="flex items-center gap-2 text-[var(--color-accent)] bg-[var(--color-accent)]/10 p-2.5 rounded-xl border border-[var(--color-accent)]/20">
              <Filter size={20} />
            </div>
            
            <select 
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="px-4 py-2.5 bg-[var(--color-bg-app)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] transition-colors cursor-pointer"
            >
              <option value="todos" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Todos los Estados</option>
              <option value="pendiente" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Pendientes</option>
              <option value="en proceso" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">En Proceso</option>
              <option value="resuelto" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Resueltos</option>
            </select>

            <select 
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
              className="px-4 py-2.5 bg-[var(--color-bg-app)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] transition-colors cursor-pointer"
            >
              <option value="todas" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Todas las Categorías</option>
              {categoriasUnicas.map(cat => (
                <option key={cat} value={cat} className="bg-[var(--color-card)] text-[var(--color-text-primary)]">
                  {cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>

            <select 
              value={filtroSeveridad}
              onChange={(e) => setFiltroSeveridad(e.target.value)}
              className="px-4 py-2.5 bg-[var(--color-bg-app)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] transition-colors cursor-pointer"
            >
              <option value="todas" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Cualquier Severidad</option>
              <option value="alta" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Severidad Alta</option>
              <option value="media" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Severidad Media</option>
              <option value="baja" className="bg-[var(--color-card)] text-[var(--color-text-primary)]">Severidad Baja</option>
            </select>
            
            <div className="ml-auto flex items-center text-sm text-[var(--color-text-secondary)] font-bold bg-[var(--color-bg-app)] px-5 py-2.5 rounded-xl border border-[var(--color-border)]">
              Mostrando <span className="text-[var(--color-accent)] font-black ml-1.5">{reportesFiltrados.length}</span>
            </div>
          </div>

          {/* TABLA REACTIVA */}
          <div className="overflow-hidden bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[var(--color-text-secondary)] uppercase bg-[var(--color-bg-app)] border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-6 py-4 font-black tracking-wider whitespace-nowrap">ID Ticket</th>
                    <th className="px-6 py-4 font-black tracking-wider">Descripción del Incidente</th>
                    <th className="px-6 py-4 font-black tracking-wider whitespace-nowrap">Clasificación</th>
                    <th className="px-6 py-4 font-black tracking-wider whitespace-nowrap">Fecha de Registro</th>
                    <th className="px-6 py-4 font-black tracking-wider whitespace-nowrap">Estado</th>
                    <th className="px-6 py-4 text-center font-black tracking-wider whitespace-nowrap min-w-[220px]">Gestión Operativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {reportesFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center justify-center text-[var(--color-text-secondary)]">
                          <Filter size={48} className="mb-4 opacity-30" />
                          <p className="font-bold text-xl text-[var(--color-text-primary)]">No hay incidentes</p>
                          <p className="text-sm mt-2 font-medium">Prueba ajustando los filtros superiores.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    reportesFiltrados.map((reporte) => (
                      <tr key={reporte.id} className="hover:bg-[var(--color-border)]/20 transition-colors group">
                        
                        {/* ID */}
                        <td className="px-6 py-5 font-mono font-bold text-xs whitespace-nowrap align-top">
                          <span className="bg-[var(--color-bg-app)] border border-[var(--color-border)] px-2 py-1 rounded-md text-[var(--color-text-secondary)]" title={reporte.id}>
                            #{reporte.id.toString().substring(0, 8)}
                          </span>
                        </td>

                        {/* DESCRIPCIÓN Y REPORTERO */}
                        <td className="px-6 py-5 text-[var(--color-text-primary)] max-w-[18rem] font-medium align-top">
                          <div className="line-clamp-2 mb-2" title={reporte.descripcion}>
                            {reporte.descripcion}
                          </div>
                          <div className="text-[10px] text-[var(--color-text-secondary)] font-bold uppercase tracking-wider flex items-center gap-1">
                            <User size={12} className="text-[var(--color-accent)]" />
                            <span>Por: <span className="text-[var(--color-text-primary)] lowercase normal-case">{reporte.reportado_por}</span></span>
                          </div>
                        </td>

                        {/* CLASIFICACIÓN */}
                        <td className="px-6 py-5 align-top">
                          <div className="flex flex-col items-start gap-2">
                            <span className="text-xs font-bold text-[var(--color-text-primary)] capitalize whitespace-nowrap">
                              {reporte.tipo ? reporte.tipo.replace(/_/g, ' ') : 'No clasificado'}
                            </span>
                            {reporte.severidad && (
                              <div className={`border text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider w-max whitespace-nowrap ${getColorSeveridad(reporte.severidad)}`}>
                                {reporte.severidad}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* FECHA CON HORA */}
                        <td className="px-6 py-5 text-[var(--color-text-secondary)] text-xs font-bold whitespace-nowrap align-top">
                          {new Date(reporte.fecha).toLocaleString('es-PE', { 
                            day: '2-digit', month: 'short', year: 'numeric', 
                            hour: '2-digit', minute:'2-digit' 
                          })}
                        </td>

                        {/* ESTADO */}
                        <td className="px-6 py-5 align-top">
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-black w-max whitespace-nowrap ${getColorEstado(reporte.estado)}`}>
                            {(reporte.estado || '').toLowerCase() === 'resuelto' && <CheckCircle size={14} strokeWidth={3} />}
                            {((reporte.estado || '').toLowerCase() === 'en proceso' || (reporte.estado || '').toLowerCase() === 'en_proceso') && <Loader2 size={14} strokeWidth={3} className="animate-spin" />}
                            {(reporte.estado || '').toLowerCase() === 'pendiente' && <Clock size={14} strokeWidth={3} />}
                            <span>{reporte.estado}</span>
                          </div>
                        </td>

                        {/* BOTONES DE GESTIÓN OPERATIVA */}
                        <td className="px-6 py-4 align-middle">
                          <div className="flex items-center justify-center gap-2">
                            
                            {/* BOTÓN REVISAR (Solo cuando está pendiente) */}
                            {(reporte.estado || '').toLowerCase() === 'pendiente' && (
                              <button
                                type="button"
                                onClick={() => handleCambiarEstado(reporte.id, 'en_proceso')}
                                disabled={isPending && reporteCambiando === reporte.id}
                                className="inline-flex items-center justify-center gap-1.5 min-w-[95px] px-3.5 py-2 rounded-xl text-xs font-bold border-2 border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent hover:bg-[var(--color-accent)] hover:text-white active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                              >
                                {isPending && reporteCambiando === reporte.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Clock size={13} />
                                )}
                                <span>Revisar</span>
                              </button>
                            )}

                            {/* BOTÓN RESOLVER (Para pendiente o en proceso) */}
                            {((reporte.estado || '').toLowerCase() === 'pendiente' || 
                              (reporte.estado || '').toLowerCase() === 'en proceso' || 
                              (reporte.estado || '').toLowerCase() === 'en_proceso') && (
                              <button
                                type="button"
                                onClick={() => handleCambiarEstado(reporte.id, 'resuelto')}
                                disabled={isPending && reporteCambiando === reporte.id}
                                className="inline-flex items-center justify-center gap-1.5 min-w-[95px] px-3.5 py-2 rounded-xl text-xs font-bold border-2 border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-80 active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-md"
                              >
                                {isPending && reporteCambiando === reporte.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={13} />
                                )}
                                <span>Resolver</span>
                              </button>
                            )}

                            {/* BOTÓN REVERTIR (Solo cuando está resuelto) */}
                            {(reporte.estado || '').toLowerCase() === 'resuelto' && (
                              <button
                                type="button"
                                onClick={() => handleCambiarEstado(reporte.id, 'pendiente')}
                                disabled={isPending && reporteCambiando === reporte.id}
                                className="inline-flex items-center justify-center gap-1.5 min-w-[105px] px-3.5 py-2 rounded-xl text-xs font-bold bg-transparent text-[var(--color-text-secondary)] border-2 border-[var(--color-border)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                                title="Deshacer y volver a pendiente"
                              >
                                {isPending && reporteCambiando === reporte.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={13} />
                                )}
                                <span>Revertir</span>
                              </button>
                            )}

                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}