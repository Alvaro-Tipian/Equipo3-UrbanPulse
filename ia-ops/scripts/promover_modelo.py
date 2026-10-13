"""
Promocion champion/challenger y rollback del modelo riesgo_vial (HT-47 T03).

Lo usa mlops-pipeline.yml. El Model Registry (MLflow en DagsHub) es la unica
fuente de verdad de que version esta en produccion:

  alias "challenger"        ultima version entrenada por ml/train/train.py
  alias "champion"          version promovida (la que despliega el pipeline)
  alias "champion_anterior" champion previo, destino por defecto del rollback

Subcomandos:

  evaluar    Evalua challenger, champion y la heuristica de Central vr5 sobre
             el MISMO split de validacion del dataset recien construido (las
             metricas que train.py guardo en cada run vienen de splits
             distintos y no son comparables entre si). Decide si se promueve.
  promover   champion_anterior <- champion, champion <- version evaluada.
  rollback   champion <- version indicada (por defecto champion_anterior).
  restaurar  Devuelve champion a una version dada (si fallo el despliegue).

Las metricas reusan el codigo de Emily (ml/train/train.py): mismas variables
derivadas, mismo split temporal, misma heuristica y mismo F1-macro.
"""

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Callable, Dict, List, Optional

NOMBRE_MODELO = "riesgo_vial"
ALIAS_CHAMPION = "champion"
ALIAS_CHALLENGER = "challenger"
ALIAS_ANTERIOR = "champion_anterior"


@dataclass
class Criterio:
    nombre: str
    aprobado: bool
    detalle: str


@dataclass
class Decision:
    challenger: Optional[str]
    champion: Optional[str]
    metricas: Dict[str, Dict[str, float]]
    criterios: List[Criterio] = field(default_factory=list)

    @property
    def promover(self) -> bool:
        return bool(self.criterios) and all(c.aprobado for c in self.criterios)

    def a_dict(self) -> Dict:
        d = asdict(self)
        d["promover"] = self.promover
        return d


def decidir(
    challenger: Optional[str],
    champion: Optional[str],
    metricas: Dict[str, Dict[str, float]],
) -> Decision:
    """Reglas de promocion. `metricas` tiene una entrada por candidato
    ("challenger", "champion", "heuristico") con f1_macro y recall_alto,
    todas calculadas sobre el mismo split de validacion."""
    decision = Decision(challenger=challenger, champion=champion, metricas=metricas)
    if challenger is None:
        decision.criterios.append(Criterio("hay challenger", False, f"{NOMBRE_MODELO} no tiene alias {ALIAS_CHALLENGER}"))
        return decision
    if challenger == champion:
        decision.criterios.append(Criterio("challenger nuevo", False, f"v{challenger} ya es el champion"))
        return decision

    ch, heur = metricas["challenger"], metricas["heuristico"]
    # Criterio de aceptacion de HT-46: el modelo debe superar al calculo heuristico.
    decision.criterios.append(Criterio(
        "supera a la heuristica (F1-macro)",
        ch["f1_macro"] > heur["f1_macro"],
        f"{ch['f1_macro']:.3f} vs {heur['f1_macro']:.3f}",
    ))
    if champion is not None:
        cp = metricas["champion"]
        decision.criterios.append(Criterio(
            "no empeora F1-macro frente al champion",
            ch["f1_macro"] >= cp["f1_macro"],
            f"{ch['f1_macro']:.3f} vs {cp['f1_macro']:.3f}",
        ))
        # "alto" es la clase que importa operativamente: un modelo que la
        # detecta peor no se promueve aunque gane en el promedio.
        decision.criterios.append(Criterio(
            "no empeora el recall de 'alto' frente al champion",
            ch["recall_alto"] >= cp["recall_alto"],
            f"{ch['recall_alto']:.3f} vs {cp['recall_alto']:.3f}",
        ))
    return decision


def reporte_markdown(decision: Decision) -> str:
    lineas = [
        f"## Evaluacion champion/challenger de `{NOMBRE_MODELO}`",
        "",
        f"- Challenger: {('v' + decision.challenger) if decision.challenger else 'ninguno'}",
        f"- Champion actual: {('v' + decision.champion) if decision.champion else 'ninguno (la API sirve la heuristica)'}",
        f"- **Decision: {'PROMOVER' if decision.promover else 'NO PROMOVER'}**",
        "",
    ]
    if decision.metricas:
        lineas += ["| Candidato | F1-macro | Recall 'alto' |", "|---|---|---|"]
        for nombre, m in decision.metricas.items():
            lineas.append(f"| {nombre} | {m['f1_macro']:.3f} | {m['recall_alto']:.3f} |")
        lineas.append("")
    lineas += ["| Criterio | Resultado | Detalle |", "|---|---|---|"]
    for c in decision.criterios:
        lineas.append(f"| {c.nombre} | {'aprobado' if c.aprobado else 'rechazado'} | {c.detalle} |")
    return "\n".join(lineas) + "\n"


# --------------------------------------------------------------------------
# Model Registry
# --------------------------------------------------------------------------

def version_por_alias(cliente, alias: str) -> Optional[str]:
    from mlflow.exceptions import MlflowException

    try:
        return str(cliente.get_model_version_by_alias(NOMBRE_MODELO, alias).version)
    except MlflowException:
        return None


def promover(cliente, version: str, origen: str = "") -> Dict[str, Optional[str]]:
    anterior = version_por_alias(cliente, ALIAS_CHAMPION)
    if anterior == version:
        raise SystemExit(f"v{version} ya es el champion")
    if anterior is not None:
        cliente.set_registered_model_alias(NOMBRE_MODELO, ALIAS_ANTERIOR, anterior)
    cliente.set_registered_model_alias(NOMBRE_MODELO, ALIAS_CHAMPION, version)
    if origen:
        cliente.set_model_version_tag(NOMBRE_MODELO, version, "promovido_por", origen)
    return {"champion": version, "champion_anterior": anterior}


def rollback(cliente, version: Optional[str] = None) -> Dict[str, Optional[str]]:
    actual = version_por_alias(cliente, ALIAS_CHAMPION)
    destino = version or version_por_alias(cliente, ALIAS_ANTERIOR)
    if destino is None:
        raise SystemExit(f"No hay version de destino: indica --version o define el alias {ALIAS_ANTERIOR}")
    cliente.get_model_version(NOMBRE_MODELO, destino)  # falla si la version no existe
    if destino == actual:
        raise SystemExit(f"v{destino} ya es el champion")
    cliente.set_registered_model_alias(NOMBRE_MODELO, ALIAS_CHAMPION, destino)
    if actual is not None:
        cliente.set_registered_model_alias(NOMBRE_MODELO, ALIAS_ANTERIOR, actual)
    return {"champion": destino, "champion_anterior": actual}


def restaurar(cliente, version: Optional[str]) -> Dict[str, Optional[str]]:
    """Tras un despliegue fallido: champion vuelve a `version` (o se elimina si
    no habia champion), para que el registro no diga que esta en produccion
    algo que nunca llego a desplegarse."""
    if version:
        cliente.set_registered_model_alias(NOMBRE_MODELO, ALIAS_CHAMPION, version)
    else:
        cliente.delete_registered_model_alias(NOMBRE_MODELO, ALIAS_CHAMPION)
    return {"champion": version or None}


# --------------------------------------------------------------------------
# Evaluacion sobre el dataset (reusa ml/train/train.py)
# --------------------------------------------------------------------------

def importar_train(ruta_ml_train: str):
    if not os.path.exists(os.path.join(ruta_ml_train, "train.py")):
        raise SystemExit(f"No existe {ruta_ml_train}/train.py (HT-46). El pipeline necesita el codigo de entrenamiento.")
    sys.path.insert(0, ruta_ml_train)
    import train  # noqa: E402  (ml/train/train.py de HT-46)

    return train


def evaluar_en_validacion(train, fecha_corte: str, dataset: Optional[str], cargar_modelo: Callable[[str], object],
                          versiones: Dict[str, Optional[str]]) -> Dict[str, Dict[str, float]]:
    import pandas as pd

    df = train.cargar_dataset(pd.Timestamp(fecha_corte), dataset)
    _, val = train.split_temporal(df, pd.Timestamp(fecha_corte))
    metricas = {
        "heuristico": train.calcular_metricas(val[train.TARGET], train.score_a_nivel(train.score_heuristico(val)))
    }
    for nombre, version in versiones.items():
        if version is None:
            continue
        modelo = cargar_modelo(version)
        metricas[nombre] = train.calcular_metricas(val[train.TARGET], modelo.predict(val[train.FEATURES]))
    return {k: {m: float(v) for m, v in d.items()} for k, d in metricas.items()}


def cargar_desde_registry(version: str):
    import mlflow.sklearn

    return mlflow.sklearn.load_model(f"models:/{NOMBRE_MODELO}/{version}")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def escribir_salidas(valores: Dict[str, object]) -> None:
    destino = os.getenv("GITHUB_OUTPUT")
    if not destino:
        return
    with open(destino, "a", encoding="utf-8") as f:
        for clave, valor in valores.items():
            f.write(f"{clave}={'' if valor is None else str(valor).lower() if isinstance(valor, bool) else valor}\n")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="comando", required=True)

    p_eval = sub.add_parser("evaluar")
    p_eval.add_argument("--fecha-corte", required=True)
    p_eval.add_argument("--dataset", default=None)
    p_eval.add_argument("--ml-train", default="ml/train")
    p_eval.add_argument("--salida", default="reportes-mlops")

    p_prom = sub.add_parser("promover")
    p_prom.add_argument("--version", required=True)
    p_prom.add_argument("--origen", default="")

    p_rb = sub.add_parser("rollback")
    p_rb.add_argument("--version", default=None)

    p_res = sub.add_parser("restaurar")
    p_res.add_argument("--version", default=None)

    args = parser.parse_args(argv)

    import mlflow
    from mlflow.tracking import MlflowClient

    if not os.getenv("MLFLOW_TRACKING_URI"):
        raise SystemExit("MLFLOW_TRACKING_URI no esta configurado")
    mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
    cliente = MlflowClient()

    if args.comando == "evaluar":
        challenger = version_por_alias(cliente, ALIAS_CHALLENGER)
        champion = version_por_alias(cliente, ALIAS_CHAMPION)
        metricas: Dict[str, Dict[str, float]] = {}
        if challenger is not None and challenger != champion:
            train = importar_train(args.ml_train)
            metricas = evaluar_en_validacion(
                train, args.fecha_corte, args.dataset, cargar_desde_registry,
                {"challenger": challenger, "champion": champion},
            )
        decision = decidir(challenger, champion, metricas)
        os.makedirs(args.salida, exist_ok=True)
        with open(os.path.join(args.salida, "decision_promocion.json"), "w", encoding="utf-8") as f:
            json.dump(decision.a_dict(), f, indent=2, ensure_ascii=False)
        markdown = reporte_markdown(decision)
        with open(os.path.join(args.salida, "decision_promocion.md"), "w", encoding="utf-8") as f:
            f.write(markdown)
        print(markdown)
        escribir_salidas({"promover": decision.promover, "challenger": challenger, "champion": champion})
        return 0

    if args.comando == "promover":
        resultado = promover(cliente, args.version, args.origen)
    elif args.comando == "rollback":
        resultado = rollback(cliente, args.version)
    else:
        resultado = restaurar(cliente, args.version)
    print(json.dumps(resultado))
    escribir_salidas(resultado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
