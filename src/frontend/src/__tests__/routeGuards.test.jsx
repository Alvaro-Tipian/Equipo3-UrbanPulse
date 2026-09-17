import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';

// Componentes de prueba para cada ruta
function LoginPage() {
  return <div data-testid="login-page">Login Page</div>;
}

function Dashboard() {
  return <div data-testid="dashboard-page">Dashboard</div>;
}

function MisReportes() {
  return <div data-testid="mis-reportes-page">Mis Reportes</div>;
}

function Chatbot() {
  return <div data-testid="chatbot-page">Chatbot</div>;
}

function MapaUrbano() {
  return <div data-testid="mapa-urbano-page">Mapa Urbano</div>;
}

function PanelPredictivo() {
  return <div data-testid="panel-predictivo-page">Panel Predictivo</div>;
}

// Componente de rutas reutilizable para los tests
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requiredRoles={['operador']}>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mis-reportes"
        element={
          <ProtectedRoute requiredRoles={['ciudadano']}>
            <MisReportes />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chatbot"
        element={
          <ProtectedRoute requiredRoles={['ciudadano']}>
            <Chatbot />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mapa-urbano"
        element={
          <ProtectedRoute requiredRoles={['operador']}>
            <MapaUrbano />
          </ProtectedRoute>
        }
      />
      <Route
        path="/panel-predictivo"
        element={
          <ProtectedRoute requiredRoles={['operador']}>
            <PanelPredictivo />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function renderWithAuthContext(initialEntries = ['/'], userValue = null) {
  return render(
    <AuthContext.Provider value={{ user: userValue }}>
      <MemoryRouter initialEntries={initialEntries}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('Route Guards - Suite 1: Sin token (usuario no autenticado)', () => {
  it('debe redirigir a /login cuando se intenta acceder a /dashboard sin token', () => {
    renderWithAuthContext(['/dashboard'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('debe redirigir a /login cuando se intenta acceder a /mis-reportes sin token', () => {
    renderWithAuthContext(['/mis-reportes'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('debe redirigir a /login cuando se intenta acceder a /chatbot sin token', () => {
    renderWithAuthContext(['/chatbot'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('debe redirigir a /login cuando se intenta acceder a /mapa-urbano sin token', () => {
    renderWithAuthContext(['/mapa-urbano'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('debe redirigir a /login cuando se intenta acceder a /panel-predictivo sin token', () => {
    renderWithAuthContext(['/panel-predictivo'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('no debe haber flash de contenido protegido (localStorage vacío en F5)', () => {
    // Simular hard-refresh mockeando localStorage.getItem
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockReturnValue(null);

    renderWithAuthContext(['/dashboard'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();

    getItemSpy.mockRestore();
  });
});

describe('Route Guards - Suite 2: Rol ciudadano', () => {
  const ciudadanoUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ciudadano@ejemplo.com',
    role: 'ciudadano',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  it('debe redirigir a /mis-reportes cuando se intenta acceder a /dashboard como ciudadano', () => {
    renderWithAuthContext(['/dashboard'], ciudadanoUser);
    expect(screen.getByTestId('mis-reportes-page')).toBeInTheDocument();
  });

  it('debe renderizar correctamente al acceder a /chatbot como ciudadano', () => {
    renderWithAuthContext(['/chatbot'], ciudadanoUser);
    expect(screen.getByTestId('chatbot-page')).toBeInTheDocument();
  });

  it('debe renderizar correctamente al acceder a /mis-reportes como ciudadano', () => {
    renderWithAuthContext(['/mis-reportes'], ciudadanoUser);
    expect(screen.getByTestId('mis-reportes-page')).toBeInTheDocument();
  });

  it('debe redirigir a /mis-reportes cuando se intenta acceder a /mapa-urbano como ciudadano', () => {
    renderWithAuthContext(['/mapa-urbano'], ciudadanoUser);
    expect(screen.getByTestId('mis-reportes-page')).toBeInTheDocument();
  });

  it('debe redirigir a /mis-reportes cuando se intenta acceder a /panel-predictivo como ciudadano', () => {
    renderWithAuthContext(['/panel-predictivo'], ciudadanoUser);
    expect(screen.getByTestId('mis-reportes-page')).toBeInTheDocument();
  });

  it('debe redirigir a /login cuando el token expira (localStorage.getItem devuelve null)', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockReturnValue(null);

    renderWithAuthContext(['/chatbot'], null);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();

    getItemSpy.mockRestore();
  });
});

describe('Route Guards - Suite 3: Rol operador', () => {
  const operadorUser = {
    username: 'qa-tester',
    role: 'operador',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  it('debe permitir acceso a /dashboard como operador', () => {
    renderWithAuthContext(['/dashboard'], operadorUser);
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });

  it('debe permitir acceso a /mapa-urbano como operador', () => {
    renderWithAuthContext(['/mapa-urbano'], operadorUser);
    expect(screen.getByTestId('mapa-urbano-page')).toBeInTheDocument();
  });

  it('debe permitir acceso a /panel-predictivo como operador', () => {
    renderWithAuthContext(['/panel-predictivo'], operadorUser);
    expect(screen.getByTestId('panel-predictivo-page')).toBeInTheDocument();
  });

  it('debe redirigir a /dashboard cuando se intenta acceder a /mis-reportes como operador', () => {
    renderWithAuthContext(['/mis-reportes'], operadorUser);
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });

  it('debe redirigir a /dashboard cuando se intenta acceder a /chatbot como operador', () => {
    renderWithAuthContext(['/chatbot'], operadorUser);
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });

  it('no debe haber flash de contenido protegido (localStorage con token en F5)', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    const sessionData = JSON.stringify(operadorUser);
    getItemSpy.mockReturnValue(sessionData);

    renderWithAuthContext(['/dashboard'], operadorUser);
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();

    getItemSpy.mockRestore();
  });

  it('debe validar el token antes del primer render (no render flash)', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    const sessionData = JSON.stringify(operadorUser);
    getItemSpy.mockReturnValue(sessionData);

    renderWithAuthContext(['/dashboard'], operadorUser);
    // El contenido protegido debe estar visible inmediatamente
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    // No debe haber un parpadeo del login
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();

    getItemSpy.mockRestore();
  });
});
