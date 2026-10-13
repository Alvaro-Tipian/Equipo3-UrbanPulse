import json

import register_prompts as rp
from conftest import RAIZ


def test_registro_del_repo_es_valido():
    assert rp.validar(rp.cargar_registro()) == []


def test_detecta_archivo_faltante_e_ids_repetidos(tmp_path):
    prompts = rp.cargar_registro()
    roto = [dict(prompts[0]), dict(prompts[0], file_path="ia-ops/prompts/no-existe.md")]
    errores = rp.validar(roto)
    assert any("ids de prompt repetidos" in e for e in errores)
    assert any("no-existe.md" in e for e in errores)


def test_registrar_es_idempotente(registry, tmp_path):
    (tmp_path / "p").mkdir()
    (tmp_path / "p" / "a.md").write_text("Clasifica el incidente.", encoding="utf-8")
    prompts = [{
        "id": "a", "name": "A", "version": "1.0.0", "file_path": "p/a.md", "model": "gemini",
        "temperature": 0.1, "max_output_tokens": 10, "mlflow_experiment": "prompts_prueba",
    }]
    [primero] = rp.registrar(prompts, raiz=str(tmp_path))
    [segundo] = rp.registrar(prompts, raiz=str(tmp_path))
    assert primero["estado"] == "registrado"
    assert segundo == {"id": "a", "estado": "sin cambios", "run_id": primero["run_id"]}

    (tmp_path / "p" / "a.md").write_text("Clasifica el incidente. Responde en JSON.", encoding="utf-8")
    [tercero] = rp.registrar(prompts, raiz=str(tmp_path))
    assert tercero["estado"] == "registrado"
    assert tercero["run_id"] != primero["run_id"]
