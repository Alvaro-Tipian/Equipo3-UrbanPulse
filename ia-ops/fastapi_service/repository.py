"""
Registro de predicciones en Neon (tabla prediccion_riesgo, HT-49 T01).

Cada prediccion que sirve la API queda guardada con sus variables de entrada,
el nivel predicho y la version del modelo: es la materia prima del monitoreo
de deriva (HT-49 T02) y de la medicion del desempeno real.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional, Protocol

logger = logging.getLogger("urbanpulse.repository")

SQL_INSERTAR = (
    "INSERT INTO prediccion_riesgo "
    "(zona_id, franja, fecha_objetivo, variables, nivel, probabilidad, model_version) "
    "VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s)"
)


class RepositorioPredicciones(Protocol):
    habilitado: bool

    def guardar(self, registros: List[Dict[str, Any]]) -> None: ...

    def comprobar(self) -> bool: ...


class RepositorioDeshabilitado:
    """Sin DATABASE_URL (desarrollo local): no guarda nada y lo dice."""

    habilitado = False

    def guardar(self, registros: List[Dict[str, Any]]) -> None:
        return None

    def comprobar(self) -> bool:
        return False


class RepositorioPostgres:
    habilitado = True

    def __init__(self, dsn: str, max_conexiones: int = 4):
        from psycopg_pool import ConnectionPool

        # open=False + open() explicito: el pool no bloquea el arranque si Neon
        # esta dormido (plan free); las conexiones se abren al primer uso.
        self._pool = ConnectionPool(dsn, min_size=0, max_size=max_conexiones, open=False, timeout=10)
        self._pool.open(wait=False)

    def guardar(self, registros: List[Dict[str, Any]]) -> None:
        filas = [
            (
                r["zona_id"],
                r["franja"],
                r["fecha_objetivo"],
                json.dumps(r["variables"], ensure_ascii=False),
                r["nivel"],
                r["probabilidad"],
                r["model_version"],
            )
            for r in registros
        ]
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(SQL_INSERTAR, filas)

    def comprobar(self) -> bool:
        try:
            with self._pool.connection() as conn:
                conn.execute("SELECT 1")
            return True
        except Exception as e:
            logger.warning("Neon no responde: %s", e)
            return False


def desde_entorno() -> RepositorioPredicciones:
    dsn: Optional[str] = os.getenv("DATABASE_URL")
    if not dsn:
        logger.warning("DATABASE_URL no configurado: las predicciones NO se guardaran en prediccion_riesgo")
        return RepositorioDeshabilitado()
    return RepositorioPostgres(dsn)
