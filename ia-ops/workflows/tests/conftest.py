import json
import os
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_ingesta_rag.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")


class ErrorDeNodo(Exception):
    pass


def nodo(nombre: str):
    return next(n for n in json.loads(WORKFLOW.read_text(encoding="utf-8"))["nodes"] if n["name"] == nombre)


def ejecutar(nombre: str, entrada, nodos=None):
    """Corre el jsCode del nodo en Node.js, como lo haria n8n."""
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nombre],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}}, default=str),
        capture_output=True, text=True, timeout=60,
    )
    salida = json.loads(proc.stdout) if proc.stdout else {}
    if proc.returncode != 0:
        raise ErrorDeNodo(salida.get("error") or proc.stderr)
    return salida


def respuesta_gemini(lotes, dimension=768):
    """Respuesta de batchEmbedContents con vectores deterministas."""
    respuestas = []
    for lote in lotes:
        embeddings = []
        for k, _ in enumerate(lote["requests"]):
            base = (len(embeddings) + k + 1) / 1000
            embeddings.append({"values": [base + i / 1e6 for i in range(dimension)]})
        respuestas.append({"embeddings": embeddings})
    return respuestas


@pytest.fixture(scope="session")
def dsn():
    valor = os.getenv("TEST_DATABASE_URL")
    if not valor:
        pytest.skip("TEST_DATABASE_URL no configurado (Postgres con pgvector, PostGIS y las migraciones)")
    return valor
