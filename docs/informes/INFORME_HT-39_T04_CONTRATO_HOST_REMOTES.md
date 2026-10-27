# HT-39 · T04 — Prueba de contrato host–remotes con Playwright

**Responsable:** Fabio Saavedra (QA) · **Fecha:** 2026-10-12 · **Bloque:** Microfrontend

## Resumen ejecutivo

🟡 **Estado: implementada y verificada en local; pendiente de commit y de su primera corrida en GitHub Actions.**

Se automatizó una prueba que levanta el host y sus siete microfrontends y comprueba que el acuerdo entre ambos lados se cumple: el manifiesto declara cada remote, cada `remoteEntry.js` responde y cada módulo expuesto monta dentro del host. La prueba se añadió como job a `frontend-ci`.

## Por qué hace falta

Desde HT-39 el host ya no conoce a sus remotes al compilar: lee `/remotes.<entorno>.json` y pide los módulos por nombre (`cargarRemote('mf_x', './Modulo')`). Host y remotes compilan por separado, así que renombrar un `exposes`, cambiar un puerto o quitar una entrada del manifiesto pasa lint y build en ambos lados y solo falla al montar, delante del usuario, con el aviso "Módulo no disponible".

## Criterio de aceptación

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| La prueba corre en cada Pull Request | 🟡 Parcial | Corre en los PR que tocan `src/frontend/**`, `mf-*/**`, `packages/shared/**` o el propio spec. Un PR que no toque el frontend no la dispara (ver "Decisiones"). |

## Qué se comprueba

17 pruebas en `ia-ops/tests/tests/contrato-host-remotes.spec.ts`:

| Bloque | Pruebas | Qué verifica |
| --- | --- | --- |
| Manifiesto | 2 | El host sirve `remotes.local.json` con una entrada por remote consumido, y la lista del spec coincide con los `cargarRemote()` de `App.jsx`. |
| `remoteEntry.js` | 7 (una por remote) | La URL del manifiesto responde 200 con contenido JavaScript, no el `index.html` de la SPA. |
| Montaje | 7 (una por remote) | El módulo expuesto se renderiza dentro del host y no aparece "Módulo no disponible". |
| Degradación | 1 | Con un remote caído, el host lo aísla con `RemoteBoundary` y los demás siguen montando. |

Remotes cubiertos: `mf_auth`, `mf_chatbot`, `mf_mapa_urbano`, `mf_dashboard`, `mf_historial_reportes`, `mf_ajustes` y `mf_gestion_incidentes`.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `ia-ops/tests/tests/contrato-host-remotes.spec.ts` | Nuevo. La suite de contrato. |
| `.github/workflows/frontend-ci.yml` | Job nuevo `contrato-host-remotes` y filtros de ruta ampliados. |

## Resultados

| Verificación | Resultado |
| --- | --- |
| Corrida local | 17 de 17 en verde |
| Corrida en frío (cachés de Vite borradas, como en CI) | 17 de 17 en verde, 1 min 18 s |
| Prueba de mutación: `exposes` de `mf-ajustes` renombrado a propósito | La prueba de montaje de `mf_ajustes` falló, como debía; el archivo se restauró |
| Corrida en GitHub Actions | Pendiente: el cambio no está commiteado |

## Decisiones

- **Filtro de rutas en vez de "todos los PR".** `frontend-ci` ya filtraba por rutas. Se amplió a todo lo que puede romper el contrato en lugar de quitar el filtro, porque quitarlo haría correr también CodeQL, SAST y lint en cada PR del repositorio. Si el criterio exige literalmente todos los PR, basta con eliminar el bloque `paths`.
- **Se reintenta el clic, no solo la aserción.** En frío, la primera carga de un remote hace que Vite optimice dependencias y recargue la página, que vuelve a Inicio. Sin el reintento la prueba fallaba de forma intermitente en dos remotes.
- **La lista de remotes se valida contra `App.jsx`.** Si alguien añade un remote al host sin añadirlo al contrato, la suite falla en lugar de seguir en verde sin probarlo.

## Pendientes y limitaciones

- Commit, PR y primera corrida en CI.
- `mf-panel-riesgo` queda fuera: es una plantilla de Vite sin Module Federation y el host no lo consume. Cuando HU-08 lo añada a `App.jsx`, la suite fallará hasta que se agregue su entrada.
- La prueba usa el manifiesto local (`remotes.local.json`) con servidores de desarrollo; no valida las URLs de `remotes.production.json`. `remotes.staging.json` tiene hoy todas las URLs vacías.
- Efecto secundario: los demás jobs de `frontend-ci` ahora también se disparan con cambios en `mf-auth`, `mf-ajustes`, `mf-gestion-incidentes` y `mf-historial-reportes`.
