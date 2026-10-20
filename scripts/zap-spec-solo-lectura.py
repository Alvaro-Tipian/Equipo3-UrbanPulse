"""Deriva de la spec OpenAPI de ZAP una copia con solo las rutas GET (HT-45 T02).

    python3 scripts/zap-spec-solo-lectura.py <spec.yaml> <salida.yaml>

Alimenta el escaneo PASIVO contra produccion. Al importar una spec, ZAP envia
una peticion a cada operacion que declara: con un POST eso registraria
usuarios, crearia reportes o cambiaria el estado de reportes reales. Se
conservan solo las operaciones GET, y el script falla si en la salida queda
cualquier otro metodo, para que un cambio futuro en la spec no cuele una
escritura contra produccion sin que nadie lo note.
"""

import sys

import yaml

METODOS_ESCRITURA = {"post", "put", "patch", "delete"}


def solo_lectura(spec: dict) -> dict:
    rutas = {}
    for ruta, operaciones in (spec.get("paths") or {}).items():
        if "get" in operaciones:
            # Los parametros a nivel de ruta aplican a todas sus operaciones.
            rutas[ruta] = {k: v for k, v in operaciones.items() if k in ("get", "parameters")}
    return {**spec, "paths": rutas}


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    entrada, salida = sys.argv[1:]
    with open(entrada, encoding="utf-8") as f:
        spec = yaml.safe_load(f)

    resultado = solo_lectura(spec)
    escrituras = [
        f"{metodo.upper()} {ruta}"
        for ruta, operaciones in resultado["paths"].items()
        for metodo in operaciones
        if metodo in METODOS_ESCRITURA
    ]
    if escrituras:
        print(f"::error::La spec de solo lectura contiene escrituras: {escrituras}", file=sys.stderr)
        return 1
    if not resultado["paths"]:
        print("::error::La spec no tiene ninguna ruta GET que escanear.", file=sys.stderr)
        return 1

    with open(salida, "w", encoding="utf-8") as f:
        yaml.safe_dump(resultado, f, allow_unicode=True, sort_keys=False)

    omitidas = sorted(set(spec["paths"]) - set(resultado["paths"]))
    print(f"Rutas GET que se escanean ({len(resultado['paths'])}):")
    for ruta in resultado["paths"]:
        print(f"  {ruta}")
    print(f"Rutas omitidas porque escriben datos ({len(omitidas)}):")
    for ruta in omitidas:
        print(f"  {ruta}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
