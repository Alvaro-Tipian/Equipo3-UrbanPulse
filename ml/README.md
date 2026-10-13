# Dataset de riesgo vial — HT-46

## Unidad de análisis
zona × franja × día de la semana.

**Zona = punto de monitoreo de TomTom** (`puntos_monitoreo`), no celda de 1 km
ni distrito puro. Se decidió así porque los puntos de monitoreo ya traen
congestión (TomTom) y permiten un join espacial directo con los siniestros
de ONSV (que sí tienen lat/lon). Se agrega `distrito` como columna de
referencia (moda de los siniestros asignados a cada zona), pero no es la
unidad de agregación. Decisión comunicada a Patrick el [fecha].

## Fuentes usadas
- `siniestros_fatales` (ONSV, filtrado a Lima): siniestros, severidad, tipo de vía.
- `traffic_readings` (TomTom): congestión media por zona × franja.
- `reports` (reportes ciudadanos): conteo de reportes en los últimos 30 días.

## Fuente excluida
- `siniestros_sutran`: sin geocodificar (0/8079 filas con `geom` al
  05/10/2026 — verificado con `SELECT count(*), count(geom) FROM siniestros_sutran`).
  Convertir KILOMETRO + CODIGO_VIA a lat/lon requiere referenciación lineal
  sobre la Red Vial Nacional del MTC; queda como mejora pendiente, no
  asignada en este sprint.

## Columnas del dataset
| Columna | Descripción |
|---|---|
| zona_id | Nombre del punto de monitoreo (TomTom) |
| distrito | Distrito más frecuente entre los siniestros de esa zona |
| franja | manana / tarde / noche |
| dia_semana | 0=lunes … 6=domingo |
| siniestros_12m | Conteo de siniestros en la ventana móvil de 12 meses |
| severidad_media | Promedio de (fallecidos + lesionados) por siniestro |
| congestion_media | % de congestión promedio TomTom en esa zona×franja |
| reportes_30d | Reportes ciudadanos cerca de la zona en los últimos 30 días |
| tipo_via_frecuente | Moda del tipo de vía |
| nivel_riesgo | bajo / medio / alto (terciles calculados sobre train) |
| semana_corte | Semana de referencia del snapshot |

## Reproducibilidad
`python ml/data/build_dataset.py --fecha-corte YYYY-MM-DD` — con la misma
fecha de corte, el hash SHA-256 del parquet resultante es idéntico.
## HT-46 T02 — Entrenamiento y comparación (hallazgo importante)

Se entrenaron y compararon 3 enfoques contra `dataset_2025-03-31.parquet`
(fecha de corte elegida porque es la más reciente con reporte completo del
ONSV — ver sección de abajo): heurístico (fórmula de `Central vr5`),
regresión logística (`class_weight="balanced"`, como pide la guía) y
Gradient Boosting (`HistGradientBoostingClassifier`, con una búsqueda
pequeña de hiperparámetros).

**Resultado (F1-macro en validación temporal):**

| Enfoque | F1-macro | recall "alto" |
|---|---|---|
| Heurístico (Central vr5) | 0.332 | 0.000 |
| Regresión logística (balanceada) | 0.141–0.233 | 0.000 |
| Gradient Boosting | 0.332 | 0.000 |

**Ninguno de los modelos entrenados supera al heurístico.** Se investigó
a fondo (no es falta de ajuste): se probó `class_weight="balanced"`
(empeora — inunda de falsos positivos de "medio"), se probó mover el
umbral de decisión calibrado sobre el propio train (mejor F1 binario
posible en train: 0.006, prácticamente nulo), y se comparó Random Forest
vs Gradient Boosting (ROC-AUC binario bajo/no-bajo: 0.50 vs 0.69 — mejoró
la separabilidad real, pero no alcanza para ganarle al heurístico).

**Causa raíz:** con las features actuales (`siniestros_12m`,
`severidad_media`, `congestion_media`, `reportes_30d` + categóricas), la
señal es débil a esta granularidad (zona × franja × día, 99%+ "bajo").
**Para mejorar esto de verdad hace falta nueva información en el
dataset** — por ejemplo una tendencia de las últimas 2-4 semanas en vez
de solo el acumulado de 12 meses — lo que implica tocar
`build_dataset.py` (T01) y volver a consultar Neon. Es una decisión de
alcance pendiente con el equipo (Patrick), no resoluble dentro de T02.

El modelo se registró igual en el Model Registry de MLflow
(`riesgo_vial`, alias `challenger`) con el tag `supera_heuristico=False`,
para que quede explícito que **no debe promoverse a `champion` (HT-48)**
sin ese trabajo adicional.

## Nota sobre la cobertura real de datos (afecta T01 y T03)

El dataset usado para T02 (`--fecha-corte 2025-03-31`) se eligió porque
`siniestros_fatales` (fuente ONSV) tiene reporte completo solo hasta
~marzo 2025; desde abril 2025 la cantidad de registros cae fuertemente
(de ~110/mes a 20-60/mes) por rezago de carga de las UPIAT-PNP, no por
una baja real de siniestros. Usar una fecha de corte más reciente (p.
ej. la fecha de "hoy" del sistema) deja la ventana de validación sin
datos reales. **Esto también afecta a la API en producción (T03):**
cualquier predicción en vivo que calcule `siniestros_12m` contra "hoy"
va a subestimar sistemáticamente el riesgo de los últimos meses por el
mismo rezago — hay que avisarlo al equipo antes de desplegar T03.
