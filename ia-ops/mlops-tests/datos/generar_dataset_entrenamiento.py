"""Genera los fixtures del dataset de entrenamiento (HT-48 CA1).

Replica el contrato de la tabla `reports`
(database/migrations/20260814000001_create_reports_table.sql) mas la columna
`distrito`, que la tabla no guarda pero el entrenamiento necesita: la cobertura
geografica se controla por distrito, y derivarlo de las coordenadas es trabajo
del export, no de las pruebas.

Produce dos archivos:

* ``dataset_entrenamiento.csv``         -- lote valido, debe pasar la suite.
* ``dataset_entrenamiento_invalido.csv`` -- el mismo lote con un defecto de cada
  tipo que el criterio de aceptacion nombra. Existe para las meta-pruebas: si la
  suite no detiene este archivo, no esta protegiendo el entrenamiento.

Se invoca desde generar_fixtures.py; no hace falta ejecutarlo por separado.
"""

from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

SEMILLA = 20261005

# Fecha de referencia del lote. Fija, para que el archivo sea reproducible: una
# fecha "hoy" real haria que el CSV cambiara cada dia y el chequeo de CI fallara.
FECHA_CORTE = date(2026, 10, 5)
DIAS_HISTORIA = 180

# Bounding box de Lima Metropolitana y Callao. La suite rechaza cualquier
# reporte fuera de aqui: coordenadas invertidas o con el signo cambiado son el
# error de carga mas comun, y entrenan al modelo sobre ubicaciones que no existen.
LIMA_LAT = (-12.52, -11.72)
LIMA_LNG = (-77.20, -76.70)

# Distritos cubiertos, con su centroide aproximado. La cobertura por distrito es
# un criterio de aceptacion: un dataset que solo trae reportes de Miraflores y
# San Isidro produce un modelo que no sabe nada de Lima Norte.
DISTRITOS = {
    "Cercado de Lima": (-12.0464, -77.0428),
    "Miraflores": (-12.1211, -77.0297),
    "San Isidro": (-12.0977, -77.0365),
    "Santiago de Surco": (-12.1450, -76.9930),
    "La Molina": (-12.0800, -76.9400),
    "San Juan de Lurigancho": (-11.9700, -77.0100),
    "Villa El Salvador": (-12.2130, -76.9360),
    "Comas": (-11.9400, -77.0600),
    "Callao": (-12.0560, -77.1180),
    "Ate": (-12.0260, -76.9180),
    "San Miguel": (-12.0770, -77.0840),
    "Barranco": (-12.1490, -77.0210),
    "Chorrillos": (-12.1700, -77.0150),
    "Los Olivos": (-11.9700, -77.0700),
    "San Borja": (-12.1000, -76.9950),
}

# 40 = 5 vueltas al PLAN de 8 combinaciones (categoria, severidad). Que el
# numero sea multiplo del plan no es casual: asi cada distrito recibe
# exactamente la misma composicion de incidentes, y las pruebas de equidad
# comparan distritos sin que la diferencia venga del muestreo. Con una mezcla
# sorteada al azar, 40 reportes por distrito bastan para que las tasas oscilen
# varios puntos y la prueba se vuelva intermitente.
REPORTES_POR_DISTRITO = 40

# Taxonomia del prompt clasificacion_incidente. Mantenerlas sincronizadas es
# parte del contrato: si el prompt emite una categoria que el dataset no
# conoce, el modelo entrenado no sabra que hacer con ella.
CATEGORIAS = {
    "SINIESTRO_VIAL": {
        "severidades": ["ALTA", "MEDIA"],
        "descripciones": [
            "Choque entre un bus y un auto particular en la via principal",
            "Atropello de un peaton en el cruce peatonal",
            "Volcadura de una camioneta a la altura del kilometro 4",
            "Colision por alcance entre tres vehiculos en hora punta",
        ],
    },
    "INFRAESTRUCTURA": {
        "severidades": ["MEDIA", "BAJA"],
        "descripciones": [
            "Semaforo apagado desde hace dos dias en la interseccion",
            "Bache profundo en el carril derecho de la avenida",
            "Senalizacion horizontal borrada en el cruce escolar",
            "Poste de alumbrado publico caido sobre la berma",
        ],
    },
    "CONGESTION": {
        "severidades": ["MEDIA", "BAJA"],
        "descripciones": [
            "Congestion vehicular severa por obra municipal en curso",
            "Trafico detenido por desvio mal senalizado",
            "Cola de mas de diez cuadras en el ingreso a la via expresa",
        ],
    },
    "ANOMALIA_AMBIENTAL": {
        "severidades": ["BAJA", "MEDIA"],
        "descripciones": [
            "Acumulacion de desmonte invadiendo media calzada",
            "Humo denso proveniente de quema informal junto a la via",
            "Derrame de aceite en la pista tras una averia mecanica",
        ],
    },
}

# La prioridad operativa se deriva de la severidad: es la regla que el modelo
# debe aprender, asi que el dataset tiene que ser coherente con ella.
PRIORIDAD_POR_SEVERIDAD = {"ALTA": 5, "MEDIA": 3, "BAJA": 1}

# Composicion fija de cada distrito: una pasada por estas 8 combinaciones
# reparte las categorias y severidades por igual en todos ellos. Son dos
# combinaciones por categoria a proposito, para que las cuatro tengan el mismo
# numero de reportes: con categorias de distinto tamano, un solo error de mas en
# la categoria pequena dispara su tasa y la prueba de paridad queda al filo del
# umbral sin que exista ningun sesgo real.
PLAN = [
    ("SINIESTRO_VIAL", "ALTA"),
    ("SINIESTRO_VIAL", "MEDIA"),
    ("INFRAESTRUCTURA", "MEDIA"),
    ("INFRAESTRUCTURA", "BAJA"),
    ("CONGESTION", "MEDIA"),
    ("CONGESTION", "BAJA"),
    ("ANOMALIA_AMBIENTAL", "BAJA"),
    ("ANOMALIA_AMBIENTAL", "MEDIA"),
]

ESTADOS = ["pending", "en_proceso", "resolved"]

COLUMNAS = [
    "id",
    "created_at",
    "description",
    "incident_type",
    "severity",
    "priority",
    "status",
    "latitude",
    "longitude",
    "distrito",
]


def generar_filas() -> list[dict]:
    rng = random.Random(SEMILLA)
    filas = []
    siguiente_id = 1

    for distrito, (lat_centro, lng_centro) in DISTRITOS.items():
        for indice in range(REPORTES_POR_DISTRITO):
            categoria, severidad = PLAN[indice % len(PLAN)]
            perfil = CATEGORIAS[categoria]

            # Dispersion alrededor del centroide, acotada para no salirse del
            # distrito ni del bounding box de Lima.
            latitud = round(lat_centro + rng.uniform(-0.018, 0.018), 6)
            longitud = round(lng_centro + rng.uniform(-0.018, 0.018), 6)

            filas.append(
                {
                    "id": siguiente_id,
                    "created_at": (
                        FECHA_CORTE - timedelta(days=rng.randint(1, DIAS_HISTORIA))
                    ).isoformat(),
                    "description": rng.choice(perfil["descripciones"]),
                    "incident_type": categoria,
                    "severity": severidad,
                    "priority": PRIORIDAD_POR_SEVERIDAD[severidad],
                    "status": rng.choice(ESTADOS),
                    "latitude": latitud,
                    "longitude": longitud,
                    "distrito": distrito,
                }
            )
            siguiente_id += 1

    filas.sort(key=lambda f: (f["created_at"], f["id"]))
    return filas


def invalidar(filas: list[dict]) -> list[dict]:
    """Inyecta un defecto de cada tipo que el criterio de aceptacion nombra.

    No se trata de corromper el archivo al azar: cada defecto corresponde a una
    validacion concreta, de modo que la meta-prueba puede exigir que la suite
    las marque todas y no solo la primera que encuentre.
    """
    invalidas = [dict(f) for f in filas]

    # Coordenada fuera de Lima: latitud de Arequipa.
    invalidas[0]["latitude"] = -16.409
    invalidas[0]["longitude"] = -71.537

    # Fecha en el futuro respecto a la fecha de corte.
    invalidas[1]["created_at"] = (FECHA_CORTE + timedelta(days=30)).isoformat()

    # Categoria fuera de la taxonomia permitida.
    invalidas[2]["incident_type"] = "OTRO"

    # Nulos en columnas criticas.
    invalidas[3]["latitude"] = None
    invalidas[4]["incident_type"] = None
    invalidas[5]["description"] = None

    # Severidad desconocida.
    invalidas[6]["severity"] = "URGENTISIMA"

    # Cobertura rota: se elimina por completo un distrito.
    invalidas = [f for f in invalidas if f["distrito"] != "Comas"]

    return invalidas


# ---------------------------------------------------------------------------
# Prioridades predichas por el modelo (HT-48 CA2)
# ---------------------------------------------------------------------------

COLUMNAS_PRIORIDAD = [
    "report_id",
    "distrito",
    "incident_type",
    "severity",
    "prioridad_real",
    "prioridad_predicha",
]

# Posiciones dentro de cada distrito donde el modelo se equivoca. Son fijas e
# iguales en todos los distritos: un error sorteado al azar haria que la tasa de
# fallo variara entre distritos por puro muestreo, que es precisamente lo que la
# prueba de sesgo intenta distinguir de un sesgo real.
#
# Una por categoria (indices 1, 2, 4 y 7 del PLAN), para que el error tampoco se
# concentre en un tipo de incidente. Las cuatro caen sobre combinaciones de
# severidad MEDIA para que todas fallen en el mismo sentido (subvaloracion): si
# unas subvaloraran y otras sobrevaloraran, la brecha de subprioridad entre
# categorias naceria en el umbral sin que exista sesgo.
# Resultado: 4 fallos de 40 por distrito, exactitud 0.90 y brecha cero.
POSICIONES_CON_ERROR = (1, 2, 12, 23)

# Distritos donde el lote sesgado infla la prioridad. Se eligieron tres
# distritos de menores ingresos a proposito: ese es el modo de fallo que
# preocupa, porque la prioridad decide a que reportes acude primero el municipio.
DISTRITOS_SESGADOS = {"San Juan de Lurigancho", "Comas", "Villa El Salvador"}


def _por_distrito(filas: list[dict]) -> dict[str, list[dict]]:
    agrupadas: dict[str, list[dict]] = {}
    for fila in filas:
        agrupadas.setdefault(fila["distrito"], []).append(fila)
    for reportes in agrupadas.values():
        reportes.sort(key=lambda f: f["id"])
    return agrupadas


def generar_prioridades(filas: list[dict]) -> list[dict]:
    """Salida del modelo de priorizacion sobre los mismos reportes."""
    predicciones = []

    for reportes in _por_distrito(filas).values():
        for posicion, reporte in enumerate(reportes):
            real = PRIORIDAD_POR_SEVERIDAD[reporte["severity"]]
            if posicion in POSICIONES_CON_ERROR:
                # Se equivoca por un escalon, que es el error realista: confundir
                # media con baja, no alta con baja.
                predicha = 3 if real == 1 else real - 2
            else:
                predicha = real

            predicciones.append(
                {
                    "report_id": reporte["id"],
                    "distrito": reporte["distrito"],
                    "incident_type": reporte["incident_type"],
                    "severity": reporte["severity"],
                    "prioridad_real": real,
                    "prioridad_predicha": predicha,
                }
            )

    predicciones.sort(key=lambda p: p["report_id"])
    return predicciones


def sesgar_prioridades(predicciones: list[dict]) -> list[dict]:
    """Marca como maxima prioridad todo lo que viene de ciertos distritos.

    El ground truth no se toca: los reportes de esos distritos no son mas graves,
    solo estan etiquetados como si lo fueran. Las pruebas de equidad deben
    marcarlo.
    """
    sesgadas = []
    for prediccion in predicciones:
        copia = dict(prediccion)
        if copia["distrito"] in DISTRITOS_SESGADOS:
            copia["prioridad_predicha"] = 5
        sesgadas.append(copia)
    return sesgadas


# Categoria que el lote sesgado por tipo entierra. Es un fallo realista y
# documentado en modelos de priorizacion: el modelo aprende que los baches "no
# son urgentes" y los manda al fondo de la cola, incluso los que bloquean un
# carril. El sesgo por distrito no sirve para probar este detector, porque al
# medirlo por categoria solo se ve su rebote.
CATEGORIA_SESGADA = "INFRAESTRUCTURA"


def sesgar_prioridades_por_tipo(predicciones: list[dict]) -> list[dict]:
    """Entierra una categoria completa en la prioridad minima."""
    sesgadas = []
    for prediccion in predicciones:
        copia = dict(prediccion)
        if copia["incident_type"] == CATEGORIA_SESGADA:
            copia["prioridad_predicha"] = 1
        sesgadas.append(copia)
    return sesgadas


def escribir(ruta: Path, filas: list[dict], columnas: list[str] | None = None) -> None:
    with ruta.open("w", encoding="utf-8", newline="") as manejador:
        escritor = csv.DictWriter(
            manejador, fieldnames=columnas or COLUMNAS, lineterminator="\n"
        )
        escritor.writeheader()
        escritor.writerows(filas)
    print(f"{ruta.name}: {len(filas)} filas")


def generar(directorio: Path) -> None:
    base = generar_filas()
    escribir(directorio / "dataset_entrenamiento.csv", base)
    escribir(directorio / "dataset_entrenamiento_invalido.csv", invalidar(base))

    prioridades = generar_prioridades(base)
    escribir(directorio / "prioridades_predichas.csv", prioridades, COLUMNAS_PRIORIDAD)
    escribir(
        directorio / "prioridades_sesgadas.csv",
        sesgar_prioridades(prioridades),
        COLUMNAS_PRIORIDAD,
    )
    escribir(
        directorio / "prioridades_sesgadas_tipo.csv",
        sesgar_prioridades_por_tipo(prioridades),
        COLUMNAS_PRIORIDAD,
    )


if __name__ == "__main__":
    generar(Path(__file__).parent)
