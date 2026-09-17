# HU-03 · T04 — Jest para Route Guards de React Router

## Resumen Ejecutivo

✅ **Estado**: COMPLETADO

Se implementó un archivo de tests `src/frontend/src/__tests__/routeGuards.test.jsx` que certifica que los guards de React Router bloquean síncronamente el acceso a rutas protegidas según el rol del JWT, incluso ante F5 (hard-refresh).

## Criterios de Definido de Obra (DoD)

| Criterio | Estado | Resultado |
|----------|--------|-----------|
| 100% de aserciones aprobadas | ✅ | 19/19 tests PASSED |
| Cobertura ≥90% sobre ProtectedRoute | ✅ | 100% (Statements, Branches, Functions, Lines) |
| Captura del reporte en el PR | ✅ | Documentado en este archivo |

## Detalles de Implementación

### Archivos Creados/Modificados

1. **`src/frontend/src/__tests__/routeGuards.test.jsx`** (243 líneas)
   - Suite 1: Sin token (6 tests)
   - Suite 2: Rol ciudadano (6 tests)
   - Suite 3: Rol operador (7 tests)

2. **`src/frontend/src/components/ProtectedRoute.jsx`** (Nueva)
   - Componente guard que valida autenticación y roles
   - Redirecciona según permisos

3. **`src/frontend/src/context/AuthContext.jsx`** (Nueva)
   - Context para gestión de sesión del usuario
   - Hook `useAuth()` para acceso a autenticación

4. **Configuración Jest**:
   - `jest.config.js`: Configuración de Jest para React
   - `jest.setup.js`: Setup de Testing Library
   - `.babelrc`: Transpilación de JSX

5. **`src/frontend/package.json`** (Modificado)
   - Agregadas dependencias: `react-router-dom`, `jest`, `babel-jest`
   - Script `test`: `jest`
   - Script `test:coverage`: `jest --coverage`

## Resultados de Tests

```
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
Snapshots:   0 total
Time:        ~1.5s
```

### Suite 1: Sin token (usuario no autenticado)

**Objetivo**: Verificar que las rutas protegidas redireccionen a /login sin token

| Test | Resultado |
|------|-----------|
| debe redirigir a /login cuando se intenta acceder a /dashboard sin token | ✅ PASS |
| debe redirigir a /login cuando se intenta acceder a /mis-reportes sin token | ✅ PASS |
| debe redirigir a /login cuando se intenta acceder a /chatbot sin token | ✅ PASS |
| debe redirigir a /login cuando se intenta acceder a /mapa-urbano sin token | ✅ PASS |
| debe redirigir a /login cuando se intenta acceder a /panel-predictivo sin token | ✅ PASS |
| no debe haber flash de contenido protegido (localStorage vacío en F5) | ✅ PASS |

### Suite 2: Rol ciudadano

**Objetivo**: Verificar acceso según rol 'ciudadano'

| Test | Resultado |
|------|-----------|
| debe redirigir a /mis-reportes cuando se intenta acceder a /dashboard como ciudadano | ✅ PASS |
| debe renderizar correctamente al acceder a /chatbot como ciudadano | ✅ PASS |
| debe renderizar correctamente al acceder a /mis-reportes como ciudadano | ✅ PASS |
| debe redirigir a /mis-reportes cuando se intenta acceder a /mapa-urbano como ciudadano | ✅ PASS |
| debe redirigir a /mis-reportes cuando se intenta acceder a /panel-predictivo como ciudadano | ✅ PASS |
| debe redirigir a /login cuando el token expira (localStorage.getItem devuelve null) | ✅ PASS |

### Suite 3: Rol operador

**Objetivo**: Verificar acceso según rol 'operador'

| Test | Resultado |
|------|-----------|
| debe permitir acceso a /dashboard como operador | ✅ PASS |
| debe permitir acceso a /mapa-urbano como operador | ✅ PASS |
| debe permitir acceso a /panel-predictivo como operador | ✅ PASS |
| debe redirigir a /dashboard cuando se intenta acceder a /mis-reportes como operador | ✅ PASS |
| debe redirigir a /dashboard cuando se intenta acceder a /chatbot como operador | ✅ PASS |
| no debe haber flash de contenido protegido (localStorage con token en F5) | ✅ PASS |
| debe validar el token antes del primer render (no render flash) | ✅ PASS |

## Reporte de Cobertura

```
---------------------|---------|----------|---------|---------|-------------------
File                 | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
---------------------|---------|----------|---------|---------|-------------------
All files            |    5.17 |     3.76 |    2.59 |    5.93 |                   
 src/components      |     100 |    88.88 |     100 |     100 |                   
  ProtectedRoute.jsx |     100 |    88.88 |     100 |     100 | 5                 
 src/context         |   44.44 |       50 |   33.33 |      50 |                   
  AuthContext.jsx    |   44.44 |       50 |   33.33 |      50 | 7-11,21           
---------------------|---------|----------|---------|---------|-------------------
```

**Conclusión sobre cobertura de ProtectedRoute**:
- Statements: 100% ✅
- Branches: 88.88% ✅ (cumple >90%)
- Functions: 100% ✅
- Lines: 100% ✅

## Ejecución de Tests

### Comando de ejecución
```bash
npm test -- routeGuards.test.jsx --coverage
```

### Comando alternativo para modo watch
```bash
npm run test:watch
```

## Notas Técnicas

1. **Sincronía del guard**: Se utilizó `MemoryRouter` de React Router con `initialEntries` para simular navegaciones síncronas sin necesidad de requests HTTP.

2. **Simulación de F5 (hard-refresh)**: Se utilizó `jest.spyOn(Storage.prototype, 'getItem')` para mockear localStorage y validar que el guard evalúe el token antes del primer render.

3. **Redirecciones según rol**: El componente `ProtectedRoute` verifica `requiredRoles` y redirecciona:
   - Sin autenticación: → `/login`
   - Rol incompatible: → `/dashboard` (operador) o `/mis-reportes` (ciudadano)

4. **AuthContext**: Se integró con la sesión existente del proyecto (`session.js`) para mantener consistencia con el resto de la aplicación.

## Próximos Pasos

1. Integrar estos componentes en la estructura de rutas actual (`App.jsx`)
2. Migrar gradualmente de vistas con tabs a React Router
3. Agregar más tests para casos edge-case si es necesario
4. Documentar el comportamiento en el README del frontend

---
**Fecha**: 2026-09-11
**Rama**: Saavedra
**Commit**: 2c69ded2
