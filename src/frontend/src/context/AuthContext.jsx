import React, { createContext, useState, useEffect } from 'react';
import { getSession, subscribeSession } from '../session';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getSession);

  useEffect(() => subscribeSession(setUser), []);

  return (
    <AuthContext.Provider value={{ user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe estar dentro de un AuthProvider');
  }
  return context;
}
