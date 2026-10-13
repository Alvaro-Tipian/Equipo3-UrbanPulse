# Banco de pruebas del flujo MLOps (HT-48)

Pruebas automatizadas sobre el dataset de entrenamiento, el modelo de
priorización, el modelo de riesgo y los prompts registrados en `ia-ops/prompts/`.

> **Requiere Python 3.12.** Great Expectations 1.x fija `numpy<2.0` y
> `pandas<2.2`, y numpy 1.26 no publica wheels para Python 3.13 o 3.14: en esos
> intérpretes `pip` intenta compilar numpy desde el código fuente y falla.

## Qué se valida

| Criterio | Archivo | Qué cubre |
| --- | --- | --- |
| **CA1** — dataset antes de entrenar | `expectativas/suite_dataset_entrenamiento.py`, `tests/test_dataset_entrenamiento.py` | Volumen mínimo, cobertura por distrito, coordenadas dentro de Lima, fechas válidas, categorías permitidas, sin nulos críticos. Si falla, el pipeline se detiene. |
| **CA2** — calidad y equidad del modelo | `tests/test_prioridad_modelo.py` | Métrica mínima, regresión frente al modelo en producción, y paridad de error entre distritos y tipos de incidente. |
| **CA3** — regresión de prompts | `promptfoo/*.promptfooconfig.yaml`, `promptfoo/evaluar-umbrales.mjs` | Dataset dorado de 56 reportes etiquetados (precisión ≥ 85 %, 100 % JSON válido), más guardrails: jailbreak, inyección de prompts, anonimización de PII, rechazo de temas fuera de dominio. |
| **CA4** — quality gate | `.github/workflows/mlops-tests.yml` | El workflow es reutilizable (`workflow_call`) para que el pipeline de HT-47 lo invoque antes de promover. |
| **CA5** — deriva | `deteccion/deriva.py`, `tests/test_deriva.py` | PSI contra el lote de referencia, con un lote derivado a propósito, y la alerta que consume el monitoreo de HT-49. |
| Riesgo por zona | `expectativas/suite_prediccion_riesgo.py`, `tests/test_sesgo_modelo.py` | Contrato de la tabla `prediccion_riesgo` y equidad por estrato socioeconómico. |

## Cómo correrlo

```bash
cd ia-ops/mlops-tests
python -m venv .venv && source .venv/Scripts/activate   # en Linux/macOS: .venv/bin/activate
pip install -r requirements.txt

pytest                        # todo lo que no consume cuota de API
pytest -k sesgo -v            # solo equidad
pytest tests/test_deriva.py   # solo deriva
```

Regresión de prompts (consume cuota real de Gemini, requiere `GOOGLE_API_KEY`):

```bash
npx promptfoo@latest eval -c promptfoo/dorado.promptfooconfig.yaml \
  --output reportes/promptfoo-dorado.json
node promptfoo/evaluar-umbrales.mjs reportes/promptfoo-dorado.json

npx promptfoo@latest eval -c promptfoo/clasificacion.promptfooconfig.yaml
npx promptfoo@latest eval -c promptfoo/nlq.promptfooconfig.yaml
```

## Dos decisiones que conviene entender

**La equidad se mide como paridad de error, no como paridad demográfica.**
Exigir que la prioridad alta se reparta por igual entre tipos de incidente
obligaría al modelo a priorizar un atasco igual que un atropello, que es lo
contrario de lo que debe hacer. Lo que sí debe repartirse por igual es el
**error**: el modelo tiene que acertar con la misma frecuencia en Comas que en
San Isidro, y con los baches igual que con los choques.

**Todos los fixtures están balanceados por construcción.** Cada distrito recibe
exactamente la misma composición de incidentes y el modelo simulado comete el
mismo número de errores en cada grupo. No es cosmético: con una composición
sorteada al azar, 40 reportes por distrito bastan para que las tasas oscilen
varios puntos y las pruebas de equidad fallen sin que exista ningún sesgo real.

## Los datos de prueba

Todos se regeneran de forma determinista con un único comando:

```bash
python datos/generar_fixtures.py
```

| Archivo | Papel |
| --- | --- |
| `dataset_entrenamiento.csv` | 600 reportes sobre 15 distritos de Lima. Debe pasar la suite. |
| `dataset_entrenamiento_invalido.csv` | Un defecto de **cada** tipo que nombra el CA1. |
| `prioridades_predichas.csv` | Salida del modelo de priorización, con el valor real al lado. |
| `prioridades_sesgadas.csv` | Prioridad inflada en tres distritos de menores ingresos. |
| `prioridades_sesgadas_tipo.csv` | Una categoría entera enterrada en prioridad mínima. |
| `predicciones_muestra.csv` | Riesgo por zona y franja, lote de referencia. |
| `predicciones_sesgadas.csv` | El mismo lote sesgado contra los estratos C y D. |
| `predicciones_con_deriva.csv` | Distribución desplazada, para la detección de deriva. |
| `metricas_produccion.json` | Métricas del modelo campeón, para detectar regresiones. |

Los archivos `*_invalido`, `*_sesgad*` y `*_con_deriva` existen para las
**meta-pruebas**: si los detectores no los marcan, están rotos y una suite en
verde no significa nada. CI verifica además que los CSV versionados coincidan
con sus generadores.

## Dependencias de otras tareas

| Tarea | Responsable | Qué falta |
| --- | --- | --- |
| HT-46 — modelo de riesgo vial | Emily Peralta | Las predicciones reales. Hasta entonces los fixtures hacen de contrato de datos. |
| HT-47 — pipeline MLOps | Álvaro Tipián | Que el pipeline invoque este workflow como gate (el `workflow_call` ya está listo). |
| HT-49 — monitoreo de deriva | Sebastián | Que el flujo de n8n consuma la alerta de `construir_alerta()` para abrir el ticket y lanzar el reentrenamiento. |

Cuando los modelos estén entrenados no hace falta tocar las pruebas: basta
exportar sus salidas a CSV con las mismas columnas y apuntar las variables de
entorno.

```bash
DATASET_ENTRENAMIENTO_CSV=/ruta/reports.csv \
PRIORIDADES_CSV=/ruta/prioridades.csv \
PREDICCIONES_CSV=/ruta/riesgo.csv \
pytest
```

El export tendrá que materializar las columnas derivadas que las tablas no
guardan pero las pruebas necesitan: `distrito` (de las coordenadas),
`nivel_socioeconomico` (atributo sensible) y las etiquetas reales contra las que
se mide el acierto.
