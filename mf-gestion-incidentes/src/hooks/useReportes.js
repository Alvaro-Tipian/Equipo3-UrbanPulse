import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// HT-39 / T02: sesión y cliente HTTP desde el módulo compartido (sin URL fija de n8n ni copia de getSession)
import { getSession, fetchN8n } from '@urbanpulse/shared';

// ==========================================
// T01: OBTENER REPORTES (OPERADOR)
// ==========================================
export const useReportesOperador = () => {
  return useQuery({
    queryKey: ['reportes'],
    queryFn: async () => {
      const rawData = await fetchN8n('/urbanpulse/reports-list');
      const dataArray = Array.isArray(rawData) ? rawData : (rawData && rawData.id ? [rawData] : []);

      return dataArray.map((reporte) => {
        const estadoBD = String(reporte.status || '').trim().toLowerCase().replace(/_/g, ' ');

        let estadoLegible = 'Pendiente';
        if (estadoBD === 'resuelto') estadoLegible = 'Resuelto';
        else if (estadoBD === 'en proceso') estadoLegible = 'En proceso';

        return {
          id: reporte.id,
          descripcion: reporte.description,
          fecha: reporte.created_at,
          estado: estadoLegible,
          tipo: reporte.incident_type,
          severidad: reporte.severity,
          reportado_por: reporte.reportado_por || 'Ciudadano',
        };
      });
    },
    staleTime: 10 * 1000, // Refresca rápido para sincronización en vivo
  });
};

// ==========================================
// HU-12 / T03: ACTUALIZAR REPORTE Y AUTO-REFRESCAR
// ==========================================
export const useActualizarReporte = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, nuevoEstado }) => {
      const session = getSession();
      const data = await fetchN8n('/urbanpulse/report-resolve', {
        method: 'POST',
        body: JSON.stringify({
          id,
          status: (nuevoEstado || '').toString().trim().toLowerCase(),
          usuario_id: session?.id || session?.usuario_id || null,
        }),
      });

      const item = Array.isArray(data) ? data[0] : data;
      if (!item || !item.id) {
        throw new Error('No autorizado: no tienes permisos para actualizar este reporte.');
      }
      return item;
    },
    onMutate: async ({ id, nuevoEstado }) => {
      // Cancelar consultas salientes para evitar sobreescrituras
      await queryClient.cancelQueries({ queryKey: ['reportes'] });
      await queryClient.cancelQueries({ queryKey: ['historial-reportes'] });

      const previousReports = queryClient.getQueryData(['reportes']);
      const previousHistory = queryClient.getQueryData(['historial-reportes']);

      let estadoLegible = 'Pendiente';
      if (nuevoEstado === 'resuelto') estadoLegible = 'Resuelto';
      else if (nuevoEstado === 'en_proceso') estadoLegible = 'En proceso';

      // Actualización optimista inmediata en la grilla del operador
      queryClient.setQueryData(['reportes'], (old) =>
        old?.map((reporte) => (reporte.id === id ? { ...reporte, estado: estadoLegible } : reporte))
      );

      // Actualización optimista inmediata en el historial del ciudadano
      queryClient.setQueryData(['historial-reportes'], (old) =>
        old?.map((reporte) => (reporte.id === id ? { ...reporte, status: nuevoEstado } : reporte))
      );

      return { previousReports, previousHistory };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousReports) queryClient.setQueryData(['reportes'], context.previousReports);
      if (context?.previousHistory) queryClient.setQueryData(['historial-reportes'], context.previousHistory);
    },
    // T03: Refrescar automáticamente ambas listas al completarse la mutación en la BD
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['reportes'] });
      queryClient.invalidateQueries({ queryKey: ['historial-reportes'] });
    },
  });
};