"""Genera los CSV de fixtures del banco de pruebas MLOps (HT-48).

Se ejecuta a mano cuando haga falta regenerar los datos:

    python ia-ops/mlops-tests/datos/generar_fixtures.py

Produce dos archivos, ambos versionados en el repositorio:

* ``predicciones_muestra.csv``  -- lote de referencia "sano". Es el que validan
  por defecto la suite de Great Expectations y las pruebas de sesgo, y debe
  pasar todos los umbrales.
* ``predicciones_sesgadas.csv`` -- el mismo lote con un sesgo inyectado a
  proposito contra los estratos socioeconomicos C y D. Existe para las
  meta-pruebas: si el detector de sesgo no marca este archivo, el detector esta
  roto y las pruebas verdes no significan nada.

El generador usa una semilla fija: dos ejecuciones producen archivos identicos,
asi que un diff en los CSV siempre refleja un cambio intencional de este script.

Nota: mientras HT-46 (modelo de riesgo vial) no publique predicciones reales,
estos archivos cumplen el rol de contrato de datos esperado. Las columnas
replican la tabla `prediccion_riesgo`
(database/migrations/20260928000001_create_prediccion_riesgo_table.sql) mas dos
columnas que la tabla no guarda pero que las pruebas necesitan:
`nivel_socioeconomico` (atributo sensible) y `ocurrio_siniestro` (ground truth).
"""

from __future__ import annotations

import csv
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SEMILLA = 20261002
MODEL_VERSION = "riesgo-vial-0.1.0"

# Zonas de Lima con su estrato socioeconomico. El estrato es el atributo
# sensible de las pruebas de equidad: el modelo no debe usarlo ni aproximarlo.
ZONAS = {
    "LIM-01": "A", "LIM-02": "A", "LIM-03": "A",
    "LIM-04": "B", "LIM-05": "B", "LIM-06": "B",
    "LIM-07": "C", "LIM-08": "C", "LIM-09": "C",
    "LIM-10": "D", "LIM-11": "D", "LIM-12": "D",
}

# Las franjas si son un factor legitimo de riesgo: de noche y en hora punta hay
# mas siniestralidad, y eso el modelo si debe capturarlo.
FRANJAS = {"madrugada": 0.20, "manana": 0.56, "tarde": 0.50, "noche": 0.82}

# Cada estrato recibe exactamente la misma escalera de factores de zona, uno por
# zona. Asi el riesgo queda equilibrado entre estratos por construccion y el
# lote sano pasa los umbrales de equidad; cualquier disparidad que detecten las
# pruebas sobre este archivo seria un error del propio detector.
ESCALERA_ZONA = [-0.06, 0.00, 0.06]

# Amplitud del ruido. Se mantiene por debajo del margen que separa cada celda
# (franja x zona) de los cortes 0.4 y 0.7, para que el nivel categorico de una
# celda no dependa del azar.
RUIDO = 0.05

# 30 dias (1440 filas) en vez de unos pocos: las metricas de equidad que miran
# el ground truth se calculan sobre el subconjunto de celdas donde hubo
# siniestro, y con lotes pequenos ese subconjunto es tan chico que la regla del
# 80% oscila por puro ruido muestral y la prueba se vuelve intermitente.
DIAS = 30
FECHA_INICIO = date(2026, 10, 5)

COLUMNAS = [
    "id",
    "creado_en",
    "zona_id",
    "franja",
    "fecha_objetivo",
    "nivel",
    "probabilidad",
    "model_version",
    "nivel_socioeconomico",
    "ocurrio_siniestro",
]


def clasificar(probabilidad: float) -> str:
    """Traduce la probabilidad al nivel categorico que consume el frontend.

    Los cortes (0.4 / 0.7) son los mismos que usa el prompt nlq_ciudadano para
    decidir cuando emitir una advertencia de seguridad; si cambian alla, tienen
    que cambiar aqui y en expectativas/suite_prediccion_riesgo.py.
    """
    if probabilidad >= 0.7:
        return "alto"
    if probabilidad >= 0.4:
        return "medio"
    return "bajo"


def generar_filas() -> list[dict]:
    rng = random.Random(SEMILLA)
    creado_en = datetime(2026, 10, 4, 6, 0, tzinfo=timezone.utc)

    # Factor propio de cada zona (densidad vial, estado del pavimento). Se
    # reparte la misma escalera dentro de cada estrato, de modo que el estrato
    # no aporte informacion sobre el riesgo.
    factor_zona = {}
    for estrato in sorted(set(ZONAS.values())):
        zonas_del_estrato = [z for z, e in ZONAS.items() if e == estrato]
        for zona, factor in zip(sorted(zonas_del_estrato), ESCALERA_ZONA):
            factor_zona[zona] = factor

    filas = []
    siguiente_id = 1

    for desplazamiento in range(DIAS):
        fecha_objetivo = FECHA_INICIO + timedelta(days=desplazamiento)
        for zona, estrato in ZONAS.items():
            for franja, base in FRANJAS.items():
                probabilidad = base + factor_zona[zona] + rng.uniform(-RUIDO, RUIDO)
                # Se redondea ANTES de clasificar: la tabla guarda NUMERIC(4,3),
                # asi que clasificar el valor sin redondear dejaria filas donde
                # el nivel no se corresponde con la probabilidad almacenada
                # (p. ej. 0.3996 -> "bajo" pero persistido como 0.400).
                probabilidad = round(min(max(probabilidad, 0.01), 0.98), 3)

                filas.append(
                    {
                        "id": siguiente_id,
                        "creado_en": creado_en.isoformat(),
                        "zona_id": zona,
                        "franja": franja,
                        "fecha_objetivo": fecha_objetivo.isoformat(),
                        "nivel": clasificar(probabilidad),
                        "probabilidad": probabilidad,
                        "model_version": MODEL_VERSION,
                        "nivel_socioeconomico": estrato,
                        # Se completa mas abajo, una vez conocidas todas las
                        # filas de la celda (zona, franja).
                        "ocurrio_siniestro": 0,
                    }
                )
                siguiente_id += 1

    _asignar_siniestros(filas)
    return filas


def _asignar_siniestros(filas: list[dict]) -> None:
    """Marca el ground truth de forma determinista, celda por celda.

    Sortear cada siniestro con una Bernoulli daria un lote mas "natural", pero
    introduce una varianza que las pruebas de equidad no saben distinguir de un
    sesgo real: con muestras chicas por estrato, el cociente de recalls oscila
    muy por debajo del umbral del 80% sin que el modelo tenga defecto alguno.

    En su lugar, dentro de cada celda (zona, franja) se marcan como siniestro
    las N fechas de mayor probabilidad, con N = round(probabilidad media x dias).
    La frecuencia observada reproduce la probabilidad predicha, y como la
    escalera de factores es identica en todos los estratos, el recall queda
    equiparado por construccion: lo que midan las pruebas sobre este lote es
    senal, no azar.
    """
    celdas: dict[tuple[str, str], list[dict]] = {}
    for fila in filas:
        celdas.setdefault((fila["zona_id"], fila["franja"]), []).append(fila)

    for filas_celda in celdas.values():
        probabilidad_media = sum(f["probabilidad"] for f in filas_celda) / len(filas_celda)
        cuantos = round(probabilidad_media * len(filas_celda))
        for fila in sorted(filas_celda, key=lambda f: f["probabilidad"], reverse=True)[:cuantos]:
            fila["ocurrio_siniestro"] = 1


def sesgar(filas: list[dict]) -> list[dict]:
    """Infla el riesgo de los estratos C y D sin tocar el ground truth.

    Simula el modo de fallo que mas preocupa al equipo: que el modelo aprenda a
    usar el estrato como proxy y marque como peligrosas zonas de bajos ingresos
    donde no ocurren mas siniestros. El resultado debe hacer fallar las pruebas
    de equidad.
    """
    sesgadas = []
    for fila in filas:
        copia = dict(fila)
        if copia["nivel_socioeconomico"] in {"C", "D"}:
            probabilidad = round(min(copia["probabilidad"] + 0.30, 0.99), 3)
            copia["probabilidad"] = probabilidad
            copia["nivel"] = clasificar(probabilidad)
        sesgadas.append(copia)
    return sesgadas


def derivar(filas: list[dict]) -> list[dict]:
    """Desplaza la distribucion de riesgo para simular deriva del modelo.

    Reproduce el escenario que preocupa a operaciones: el modelo sigue
    respondiendo y sus salidas siguen siendo validas una por una -- rango
    correcto, nivel coherente, sin nulos -- pero la distribucion completa se ha
    movido. Ninguna validacion fila a fila lo detecta; solo una comparacion
    contra el lote de referencia.

    Causas reales de un desplazamiento asi: obras que cambian el trafico de toda
    una zona, una temporada distinta, o un modelo que se quedo viejo frente a la
    ciudad que intenta describir.
    """
    derivadas = []
    for fila in filas:
        copia = dict(fila)
        probabilidad = round(min(copia["probabilidad"] + 0.22, 0.99), 3)
        copia["probabilidad"] = probabilidad
        copia["nivel"] = clasificar(probabilidad)
        derivadas.append(copia)
    return derivadas


def escribir(ruta: Path, filas: list[dict]) -> None:
    # lineterminator="\n" en vez del "\r\n" que usa csv por defecto: los CSV se
    # versionan con LF (ver .gitattributes) y CI compara el archivo regenerado
    # contra el del repositorio. Sin esto, el chequeo fallaria siempre al correr
    # en Linux sobre archivos commiteados desde Windows.
    with ruta.open("w", encoding="utf-8", newline="") as manejador:
        escritor = csv.DictWriter(manejador, fieldnames=COLUMNAS, lineterminator="\n")
        escritor.writeheader()
        escritor.writerows(filas)
    print(f"{ruta.name}: {len(filas)} filas")


if __name__ == "__main__":
    import generar_dataset_entrenamiento

    directorio = Path(__file__).parent
    base = generar_filas()
    escribir(directorio / "predicciones_muestra.csv", base)
    escribir(directorio / "predicciones_sesgadas.csv", sesgar(base))
    escribir(directorio / "predicciones_con_deriva.csv", derivar(base))

    # El dataset de entrenamiento y las prioridades predichas viven en su propio
    # modulo, pero se regeneran desde aqui para que CI tenga un solo comando.
    generar_dataset_entrenamiento.generar(directorio)
