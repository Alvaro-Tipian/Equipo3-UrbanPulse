import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RutaProtegida, { ROLES } from '../components/RutaProtegida';

// Prueba el guard REAL que usa App.jsx (no ProtectedRoute).
// Las rutas y roles son los mismos que en App.jsx.

const Pagina = ({ id }) => <div data-testid={id}>{id}</div>;

function Rutas({ session }) {
  return (
    <Routes>
      <Route path="/" element={<Pagina id="inicio" />} />
      <Route path="/login" element={<Pagina id="login" />} />
      <Route
        path="/dashboard"
        element={
          <RutaProtegida session={session}>
            <Pagina id="dashboard" />
          </RutaProtegida>
        }
      />
      <Route
        path="/historial"
        element={
          <RutaProtegida session={session} roles={[ROLES.CIUDADANO]}>
            <Pagina id="historial" />
          </RutaProtegida>
        }
      />
      <Route
        path="/incidentes"
        element={
          <RutaProtegida session={session} roles={[ROLES.OPERADOR]}>
            <Pagina id="incidentes" />
          </RutaProtegida>
        }
      />
      <Route
        path="/panel-predictivo"
        element={
          <RutaProtegida session={session} roles={[ROLES.OPERADOR]}>
            <Pagina id="panel-predictivo" />
          </RutaProtegida>
        }
      />
    </Routes>
  );
}

const ir = (ruta, session = null) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Rutas session={session} />
    </MemoryRouter>
  );

const ciudadano = { email: 'ciudadano@ejemplo.com', role: 'ciudadano' };
const operador = { username: 'qa-tester', role: 'operador' };
const operadorConRol = { username: 'qa-tester', rol: 'operador' }; // backend envía "rol"

describe('RutaProtegida - sin sesión', () => {
  it.each(['/dashboard', '/historial', '/incidentes', '/panel-predictivo'])(
    'redirige %s a /login',
    (ruta) => {
      ir(ruta);
      expect(screen.getByTestId('login')).toBeInTheDocument();
    }
  );
});

describe('RutaProtegida - ciudadano', () => {
  it('no puede entrar a /panel-predictivo: va a /', () => {
    ir('/panel-predictivo', ciudadano);
    expect(screen.getByTestId('inicio')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-predictivo')).not.toBeInTheDocument();
  });

  it('no puede entrar a /incidentes: va a /', () => {
    ir('/incidentes', ciudadano);
    expect(screen.getByTestId('inicio')).toBeInTheDocument();
  });

  it('entra a /historial', () => {
    ir('/historial', ciudadano);
    expect(screen.getByTestId('historial')).toBeInTheDocument();
  });

  it('entra a /dashboard (cualquier rol con sesión)', () => {
    ir('/dashboard', ciudadano);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});

describe('RutaProtegida - operador', () => {
  it('entra a /panel-predictivo', () => {
    ir('/panel-predictivo', operador);
    expect(screen.getByTestId('panel-predictivo')).toBeInTheDocument();
  });

  it('entra a /panel-predictivo aunque el backend envíe "rol" en vez de "role"', () => {
    ir('/panel-predictivo', operadorConRol);
    expect(screen.getByTestId('panel-predictivo')).toBeInTheDocument();
  });

  it('no puede entrar a /historial: va a /dashboard', () => {
    ir('/historial', operador);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});
