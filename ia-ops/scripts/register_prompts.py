"""
Versionado de prompts en MLflow (HT-47 T01).

Lee ia-ops/prompts/prompt_registry.json y registra cada plantilla .md como
artefacto de un run en su experimento de MLflow, con el hash SHA-256 del
archivo como tag. Si ya existe un run con ese hash, no registra nada: correr
el script dos veces no crea versiones duplicadas, y cada run del experimento
corresponde a un cambio real del prompt.

Uso:
  python ia-ops/scripts/register_prompts.py --validar   # sin MLflow (PR)
  python ia-ops/scripts/register_prompts.py             # registra (main)
"""

import argparse
import hashlib
import json
import os
import sys
from typing import Dict, List, Optional

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REGISTRO = os.path.join(RAIZ, "ia-ops", "prompts", "prompt_registry.json")
CAMPOS = ("id", "name", "version", "file_path", "model", "temperature", "max_output_tokens", "mlflow_experiment")


def cargar_registro(ruta: str = REGISTRO) -> List[Dict]:
    with open(ruta, encoding="utf-8") as f:
        registro = json.load(f)
    prompts = registro.get("prompts")
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("prompt_registry.json no tiene una lista 'prompts'")
    return prompts


def validar(prompts: List[Dict], raiz: str = RAIZ) -> List[str]:
    errores = []
    ids = [p.get("id") for p in prompts]
    if len(ids) != len(set(ids)):
        errores.append("Hay ids de prompt repetidos")
    for p in prompts:
        faltan = [c for c in CAMPOS if c not in p]
        if faltan:
            errores.append(f"{p.get('id', '?')}: faltan campos {faltan}")
            continue
        ruta = os.path.join(raiz, p["file_path"])
        if not os.path.isfile(ruta):
            errores.append(f"{p['id']}: no existe {p['file_path']}")
        elif not open(ruta, encoding="utf-8").read().strip():
            errores.append(f"{p['id']}: {p['file_path']} esta vacio")
    return errores


def sha256(ruta: str) -> str:
    with open(ruta, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def registrar(prompts: List[Dict], raiz: str = RAIZ) -> List[Dict]:
    import mlflow

    resultados = []
    for p in prompts:
        ruta = os.path.join(raiz, p["file_path"])
        huella = sha256(ruta)
        experimento = mlflow.set_experiment(p["mlflow_experiment"])
        existentes = mlflow.search_runs(
            experiment_ids=[experimento.experiment_id],
            filter_string=f"tags.prompt_sha256 = '{huella}'",
            max_results=1,
            output_format="list",
        )
        if existentes:
            resultados.append({"id": p["id"], "estado": "sin cambios", "run_id": existentes[0].info.run_id})
            continue
        with mlflow.start_run(run_name=f"{p['id']}_v{p['version']}") as run:
            mlflow.set_tags({"prompt_id": p["id"], "prompt_sha256": huella, "prompt_version": p["version"]})
            mlflow.log_params({c: p[c] for c in ("model", "temperature", "max_output_tokens", "version")})
            mlflow.log_artifact(ruta, artifact_path="prompt_templates")
        resultados.append({"id": p["id"], "estado": "registrado", "run_id": run.info.run_id})
    return resultados


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validar", action="store_true", help="Solo valida el registro, sin conectarse a MLflow")
    args = parser.parse_args(argv)

    prompts = cargar_registro()
    errores = validar(prompts)
    if errores:
        for e in errores:
            print(f"::error::{e}")
        return 1
    print(f"Registro de prompts valido: {len(prompts)} prompts")
    if args.validar:
        return 0

    try:  # uso local: credenciales de DagsHub en el .env de la raiz
        from dotenv import load_dotenv

        load_dotenv(os.path.join(RAIZ, ".env"))
    except ImportError:
        pass
    uri = os.getenv("MLFLOW_TRACKING_URI")
    if not uri:
        print("::error::MLFLOW_TRACKING_URI no esta configurado")
        return 1
    import mlflow

    mlflow.set_tracking_uri(uri)
    for r in registrar(prompts):
        print(f"{r['id']}: {r['estado']} (run {r['run_id']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
