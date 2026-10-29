import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchN8n } from '@urbanpulse/shared';

// HU-09 - Hooks de operativos (contrato C2).
//   T03: incidentes por zona (2.1) y crear operativo (2.2) -> AgruparPorZona.jsx
//   T04: listar (2.3), cuadrillas (2.4) y asignar/cerrar (2.5) -> TableroOperativos.jsx

export const ESTADOS_OPERATIVO = ['planificado', 'asignado', 'en_curso', 'cerrado'];

// ------------------------------------------------------------
// Errores de n8n
// ------------------------------------------------------------
// Devuelve { codigo, ...detalle } con el cuerpo de error del contrato C2:
//   codigo: datos_invalidos | reporte_no_disponible | transicion_invalida |
//           operativo_no_encontrado | token_invalido | rol_no_permitido | ...
//   detalle: p. ej. reportes (409 al crear) o estado_actual (409 al asignar).
// Soporta que fetchN8n lance el cuerpo en err.body, err.data, err.response o
// como JSON dentro de err.message.
export const leerErrorN8n = (err) => {
  if (!err) return { codigo: 'error_desconocido' };
  if (typeof err === 'string') return { codigo: err };

  let cuerpo = err.body || err.data || err.response?.data || null;
  if (!cuerpo || typeof cuerpo !== 'object') {
    const msg = String(err.message || '');
    try {
      cuerpo = JSON.parse(msg.slice(msg.indexOf('{')));
    } catch {
      cuerpo = null;
    }
  }

  const codigo = cuerpo?.error || err.error || err.message || 'error_desconocido';
  return { ...(cuerpo || {}), codigo: String(codigo), status: err.status ?? null };
};

// Datos extra del error (p. ej. los reportes no disponibles de un 409 al crear).
export const leerDetalleErrorN8n = (err) =>
  err?.body || err?.data || err?.response?.data || null;

// fetchN8n puede resolver con { error } en vez de lanzar: lo convertimos en throw.
const exigirSinError = (data) => {
  if (data && !Array.isArray(data) && typeof data === 'object' && data.error) {
    const e = new Error(data.error);
    e.body = data;
    throw e;
  }
  return data;
};

// ------------------------------------------------------------
// T03 - 2.1 Incidentes abiertos agrupados por zona
// ------------------------------------------------------------
export const useIncidentesPorZona = () =>
  useQuery({
    queryKey: ['incidentes-por-zona'],
    queryFn: async () => {
      const data = exigirSinError(await fetchN8n('/urbanpulse/incidentes-por-zona'));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 10 * 1000,
  });

// ------------------------------------------------------------
// T03 - 2.2 Crear operativo con reportes de una zona
// ------------------------------------------------------------
export const useCrearOperativo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ zona, zona_id, reportes }) => {
      const data = exigirSinError(
        await fetchN8n('/urbanpulse/operativos', {
          method: 'POST',
          body: JSON.stringify({ zona: zona_id || zona, reportes }),
        })
      );
      if (!data || !data.id) {
        const e = new Error('datos_invalidos');
        e.body = data;
        throw e;
      }
      return data; // { id, estado: 'planificado' }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['incidentes-por-zona'] });
      queryClient.invalidateQueries({ queryKey: ['operativos'] });
    },
  });
};

// ------------------------------------------------------------
// T04 - 2.3 Lista de operativos
// ------------------------------------------------------------
export const useOperativos = () =>
  useQuery({
    queryKey: ['operativos'],
    queryFn: async () => {
      const data = exigirSinError(await fetchN8n('/urbanpulse/operativos'));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
  });

// ------------------------------------------------------------
// T04 - 2.4 Cuadrillas activas
// ------------------------------------------------------------
export const useCuadrillas = () =>
  useQuery({
    queryKey: ['cuadrillas'],
    queryFn: async () => {
      const data = exigirSinError(await fetchN8n('/urbanpulse/cuadrillas'));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

// ------------------------------------------------------------
// T04 - 2.5 Asignar cuadrilla / iniciar / cerrar
// ------------------------------------------------------------
const MENSAJES_TABLERO = {
  token_invalido: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  rol_no_permitido: 'Solo un operador puede gestionar operativos.',
  datos_invalidos: 'Datos inválidos: revisa la cuadrilla seleccionada.',
  operativo_no_encontrado: 'El operativo ya no existe.',
  transicion_invalida: 'Ese cambio de estado no está permitido.',
};

// Mensaje legible para el tablero (usa leerErrorN8n por debajo).
export const mensajeError = (err) =>
  MENSAJES_TABLERO[leerErrorN8n(err).codigo] ||'No se pudo completar la acción. Intenta de nuevo.';

export const useCambiarEstadoOperativo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ operativo_id, estado, cuadrilla_id = null }) => {
      const data = exigirSinError(
        await fetchN8n('/urbanpulse/operativos/asignar', {
          method: 'POST',
          body: JSON.stringify({ operativo_id, estado, cuadrilla_id }),
        })
      );
      if (!data || !data.id) {
        const e = new Error('respuesta_invalida');
        e.body = data;
        throw e;
      }
      return data;
    },
    onMutate: async ({ operativo_id, estado, cuadrilla_id, cuadrilla_nombre }) => {
      await queryClient.cancelQueries({ queryKey: ['operativos'] });
      const previos = queryClient.getQueryData(['operativos']);
      queryClient.setQueryData(['operativos'], (old) =>
        old?.map((op) =>
          op.id === operativo_id
            ? {
                ...op,
                estado,
                cuadrilla: cuadrilla_id
                  ? { id: cuadrilla_id, nombre: cuadrilla_nombre || op.cuadrilla?.nombre }
                  : op.cuadrilla,
              }
            : op
        )
      );
      return { previos };
    },
    onSuccess: (operativo) => {
      queryClient.setQueryData(['operativos'], (old) =>
        old?.map((op) => (op.id === operativo.id ? operativo : op))
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previos) queryClient.setQueryData(['operativos'], context.previos);
    },
    onSettled: (_data, _err, { estado }) => {
      queryClient.invalidateQueries({ queryKey: ['operativos'] });
      if (estado === 'cerrado') {
        queryClient.invalidateQueries({ queryKey: ['reportes'] });
        queryClient.invalidateQueries({ queryKey: ['historial-reportes'] });
        queryClient.invalidateQueries({ queryKey: ['incidentes-por-zona'] });
      }
    },
  });
};

// Alias: TableroOperativos.jsx lo importa con este nombre.
export const useAsignarOperativo = useCambiarEstadoOperativo;