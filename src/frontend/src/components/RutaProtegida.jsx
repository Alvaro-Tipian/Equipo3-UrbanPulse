import { Navigate } from 'react-router-dom';

// Guard de rutas que usa App.jsx (HU-08 / T01).
// Exige sesión y, opcionalmente, uno de los roles indicados.
// OJO: esto solo protege la UI. El backend debe validar el rol en cada endpoint.

export const ROLES = {
  OPERADOR: 'operador',
  CIUDADANO: 'ciudadano',
};

// El backend a veces envía `role` y a veces `rol`
export const getRol = (session) => session?.role || session?.rol || ROLES.CIUDADANO;

export default function RutaProtegida({ session, roles, children }) {
  if (!session) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(getRol(session))) {
    const destino = getRol(session) === ROLES.OPERADOR ? '/dashboard' : '/';
    return <Navigate to={destino} replace />;
  }
  return children;
}
