# HT-48 — Pruebas automatizadas del flujo MLOps

**Responsable:** Fabio Saavedra (QA) · **Fecha:** 2026-10-12 · **Bloque:** Testing MLOps

## Resumen ejecutivo

🟡 **Estado: 4 de 5 tareas completas. T03 está escrita pero nunca se ha ejecutado con éxito contra Gemini.**

Se construyó un banco de pruebas que actúa como quality gate del pipeline MLOps: valida el dataset antes de entrenar, mide calidad y sesgo del modelo, detecta deriva y evalúa los prompts. La parte que no llama a ningún modelo de lenguaje corre en verde en CI. La regresión de prompts con promptfoo tenía configurado un modelo que ya no existe; se corrigió, pero falta una clave de Gemini con cuota suficiente para ejecutarla.

## Estado por tarea

| Tarea | Criterio de aceptación | Estado | Evidencia |
| --- | --- | --- | --- |
| **T01** Validación de datos con Great Expectations | Un dataset con errores detiene el pipeline | ✅ Completa | `test_dataset_entrenamiento.py`; el dataset inválido hace fallar la suite |
| **T02** Pruebas del modelo con pytest | Un modelo peor o sesgado no se promueve | ✅ Completa, sobre datos simulados | `test_prioridad_modelo.py`, `test_sesgo_modelo.py` |
| **T03** Dataset dorado y suite de promptfoo | La suite reporta precisión, formato y resistencia a manipulación | 🟡 Escrita, sin ejecutar | 56 reportes etiquetados y tres configuraciones; ver "Hallazgo" |
| **T04** Quality gates y reporte HTML | El reporte se descarga desde cada ejecución | 🟡 Hecha en local, pendiente de commit | `mlops-tests.yml` publica HTML de pytest y de promptfoo |
| **T05** Prueba del monitoreo con deriva simulada | La prueba de deriva simulada pasa en el pipeline | ✅ Completa | `test_deriva.py`; en verde en CI |

## Qué se valida y con qué umbral

| Frente | Comprobación | Umbral |
| --- | --- | --- |
| Dataset (T01) | Volumen mínimo | ≥ 500 reportes |
| | Cobertura por distrito | ≥ 20 reportes por distrito |
| | Coordenadas dentro de Lima, fechas válidas, categorías permitidas, sin nulos críticos | Sin excepciones |
| Modelo (T02) | Exactitud de la prioridad | ≥ 0,85 |
| | No regresión frente al modelo en producción | Tolerancia 0,02 |
| | Paridad de error entre distritos y tipos de incidente | Brecha máxima 0,10 |
| | Impacto dispar por estrato socioeconómico | Ratio ≥ 0,80 |
| Prompts (T03) | Precisión de categoría sobre el dataset dorado | ≥ 85 % |
| | Respuestas con JSON válido | 100 % |
| | Jailbreak, inyección de prompts, PII, fuera de dominio | Todos los casos |
| Deriva (T05) | PSI frente al lote de referencia | Alerta desde 0,20 |

Cada detector tiene además su **meta-prueba**: un lote inválido, sesgado o con deriva construido a propósito que la suite debe marcar. Si no lo marca, el detector está roto.

## Archivos principales

| Ruta | Contenido |
| --- | --- |
| `ia-ops/mlops-tests/expectativas/` | Suites de Great Expectations. |
| `ia-ops/mlops-tests/tests/` | 5 archivos de pytest, 34 funciones de prueba. |
| `ia-ops/mlops-tests/deteccion/deriva.py` | Cálculo de PSI y construcción de la alerta. |
| `ia-ops/mlops-tests/datos/` | Fixtures deterministas y sus generadores. |
| `ia-ops/mlops-tests/promptfoo/` | Dataset dorado, configuraciones y cálculo de umbrales. |
| `.github/workflows/mlops-tests.yml` | Workflow reutilizable que el pipeline de HT-47 invoca como gate. |

## Integración como quality gate (T04)

- `mlops-pipeline.yml` invoca `mlops-tests.yml` y los jobs de registro, entrenamiento y promoción dependen de él: sin pruebas en verde no se promueve.
- La parte de datos, sesgo y deriva corre en cada push y PR que toque algo relacionado.
- promptfoo solo corre en la promoción manual, porque consume cuota de Gemini.
- **Reporte HTML (cambio de hoy):** pytest genera `pytest-mlops.html` y cada suite de promptfoo su propio HTML; se suben como artefactos `mlops-reporte-pytest` y `mlops-reporte-promptfoo`, pase o no el gate.

## Resultados

| Verificación | Resultado |
| --- | --- |
| Suite de datos, sesgo y deriva en CI (`main`) | ✅ En verde |
| Reporte HTML de pytest | Verificado en un entorno aparte con la versión fijada (`pytest-html` 4.1.1); pendiente de verlo en CI |
| Salida HTML de promptfoo | Verificada en una corrida en seco |
| Suites de promptfoo contra Gemini | ❌ Sin ejecutar |

## Hallazgo: las suites de promptfoo no podían pasar

Las tres configuraciones apuntaban a `gemini-1.5-flash`. Ese modelo ya no está disponible y la API responde 404, así que ninguna corrida habría funcionado. Se cambiaron a `gemini-flash-latest`, el mismo alias que usa el flujo de producción. No se han vuelto a ejecutar por falta de cuota.

## Pendientes y limitaciones

- **Clave de Gemini con cuota suficiente en el secret `GEMINI_API_KEY_CI`.** El dataset dorado hace 56 llamadas; el plan gratuito permite 20 al día por modelo. Debe ser una clave distinta de la de producción.
- **Commit y PR** de los cambios de T04 y de la corrección del modelo.
- **T02 corre sobre fixtures simulados.** Cuando HT-46 publique predicciones reales, basta exportarlas a CSV con las mismas columnas y apuntar las variables de entorno; las pruebas no cambian.
- **T05 verifica la señal, no el efecto.** Comprueba que el monitor de HT-49 emite `DERIVA_DETECTADA=true`, de la que dependen el ticket y el reentrenamiento. No comprueba que el ticket de Jira se cree realmente.
- La suite exige Python 3.12 por las dependencias de Great Expectations.
