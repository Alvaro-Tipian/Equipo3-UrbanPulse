import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children, requiredRoles = [] }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
    const defaultPath = user.role === 'operador' ? '/dashboard' : '/mis-reportes';
    return <Navigate to={defaultPath} replace />;
  }

  return children;
}
