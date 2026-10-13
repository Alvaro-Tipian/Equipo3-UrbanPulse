"""Nodos Code del workflow de ingesta RAG, ejecutados en Node.js."""

import hashlib

import pytest

from conftest import ErrorDeNodo, ejecutar, respuesta_gemini

UUID = "4f6c1a2e-9b3d-4c5e-8f7a-1b2c3d4e5f60"


def evento(tipo="reporte.creado", **datos):
    return {"id": UUID, "tipo": tipo, "fecha": "2026-10-06T15:02:11-05:00", "origen": "n8n/central", "datos": datos}


# ------------------------------------------------------------ Definir alcance

def test_ejecucion_semanal_recalcula_todo():
    assert ejecutar("Definir alcance", [{"timestamp": "2026-10-12T09:00:00Z"}]) == [
        {"modo": "semanal", "distrito": "", "reporte_id": ""}
    ]


def test_evento_con_distrito_y_reporte():
    [r] = ejecutar("Definir alcance", [evento(distrito=" Miraflores ", reporte_id=UUID)])
    assert r == {"modo": "evento", "evento_id": UUID, "distrito": "Miraflores", "reporte_id": UUID}


def test_reporte_id_que_no_es_uuid_se_ignora():
    # El ejemplo del contrato de HT-51 usa un entero (1842); reports.id es UUID.
    [r] = ejecutar("Definir alcance", [evento("reporte.estado_cambiado", reporte_id=1842)])
    assert r["reporte_id"] == "" and r["modo"] == "evento"


def test_evento_de_otro_tipo_es_un_error_de_enrutamiento():
    with pytest.raises(ErrorDeNodo, match="no esta suscrita a modelo.deriva_detectada"):
        ejecutar("Definir alcance", [evento("modelo.deriva_detectada")])


# ------------------------------------------------------------ Redactar fichas

def ficha(**cambios):
    base = {
        "clave": "distrito:MIRAFLORES:tarde", "ambito": "distrito", "distrito": "MIRAFLORES",
        "distrito_nombre": "Miraflores", "franja": "tarde", "fuentes": ["ONSV", "reportes_resueltos"],
        "metricas": {
            "onsv_desde": "2024-04-01", "onsv_hasta": "2025-03-31", "siniestros": 14, "fallecidos": 1,
            "lesionados": 22, "clase_frecuente": "CHOQUE", "causa_frecuente": "EXCESO DE VELOCIDAD",
            "via_frecuente": "AVENIDA", "reportes_resueltos_90d": 5, "tipo_reporte_frecuente": "choque",
        },
        "sha256_actual": None,
    }
    base.update(cambios)
    return base


def test_ficha_de_distrito_con_datos():
    [r] = ejecutar("Redactar fichas", [ficha()])
    assert r["contenido"] == (
        "Miraflores (Lima), franja de la tarde (12:00 a 17:59). "
        "Entre 2024-04-01 y 2025-03-31 la ONSV registró 14 siniestros con víctimas en este distrito en esta franja, "
        "con 1 fallecido y 22 lesionados. "
        "Clase más frecuente: CHOQUE; causa principal más frecuente: EXCESO DE VELOCIDAD; tipo de vía más frecuente: AVENIDA. "
        "En los últimos 90 días se resolvieron 5 reportes ciudadanos en UrbanPulse para esta zona y franja; "
        "el tipo más frecuente fue choque. "
        "Fuentes: ONSV (siniestros con víctimas) y reportes ciudadanos resueltos de UrbanPulse."
    )
    assert r["contenido_sha256"] == hashlib.sha256(f"gemini-embedding-001\n{r['contenido']}".encode()).hexdigest()
    assert r["fuentes"] == ["ONSV", "reportes_resueltos"]
    assert r["modelo_embedding"] == "gemini-embedding-001"


def test_ficha_sin_siniestros_lo_dice_en_vez_de_inventar():
    m = {"onsv_desde": "2024-04-01", "onsv_hasta": "2025-03-31", "siniestros": 0, "fallecidos": 0,
         "lesionados": 0, "reportes_resueltos_90d": 0}
    [r] = ejecutar("Redactar fichas", [ficha(clave="distrito:PUCUSANA:noche", distrito_nombre="Pucusana",
                                             franja="noche", metricas=m)])
    assert "la ONSV no registró siniestros con víctimas" in r["contenido"]
    assert "no hubo reportes ciudadanos resueltos" in r["contenido"]
    assert "Clase más frecuente" not in r["contenido"]


def test_un_solo_reporte_en_singular():
    m = dict(ficha()["metricas"], reportes_resueltos_90d=1)
    [r] = ejecutar("Redactar fichas", [ficha(metricas=m)])
    assert "se resolvió 1 reporte ciudadano en UrbanPulse" in r["contenido"]


def test_ficha_de_red_vial_nacional():
    m = {"sutran_desde": "2024-01-02", "sutran_hasta": "2024-12-30", "vias": [
        {"codigo_via": "PE-1N", "siniestros": 12, "fallecidos": 2, "heridos": 10, "km_frecuente": "25"},
        {"codigo_via": "PE-22", "siniestros": 1, "fallecidos": 0, "heridos": 1, "km_frecuente": None},
    ]}
    [r] = ejecutar("Redactar fichas", [ficha(clave="red_vial_nacional:noche", ambito="red_vial_nacional",
                                             distrito=None, distrito_nombre="Red vial nacional en Lima",
                                             franja="noche", fuentes="{SUTRAN}", metricas=m)])
    assert "PE-1N (12 siniestros, 2 fallecidos, 10 heridos; kilómetro más frecuente: 25)" in r["contenido"]
    assert "PE-22 (1 siniestro, 0 fallecidos, 1 herido)" in r["contenido"]
    assert r["fuentes"] == ["SUTRAN"]  # tambien acepta el formato de array de Postgres
    assert r["distrito"] == ""


def test_ficha_sin_cambios_no_se_vuelve_a_vectorizar():
    [primera] = ejecutar("Redactar fichas", [ficha()])
    assert ejecutar("Redactar fichas", [ficha(sha256_actual=primera["contenido_sha256"])]) == []


# --------------------------------------------- Lotes y union de embeddings

def test_lotes_de_hasta_100():
    fichas = [{"clave": f"k{i}", "contenido": f"texto {i}", "modelo_embedding": "gemini-embedding-001"}
              for i in range(132)]
    lotes = ejecutar("Armar lotes de embeddings", fichas)
    assert [len(l["requests"]) for l in lotes] == [100, 32]
    req = lotes[0]["requests"][0]
    assert req == {"model": "models/gemini-embedding-001", "content": {"parts": [{"text": "texto 0"}]},
                   "taskType": "RETRIEVAL_DOCUMENT", "outputDimensionality": 768}


def test_union_empareja_cada_vector_con_su_ficha():
    fichas = [{"clave": f"k{i}", "contenido": "t", "modelo_embedding": "m", "fuentes": ["ONSV"], "metricas": {"a": i}}
              for i in range(3)]
    lotes = ejecutar("Armar lotes de embeddings", fichas)
    salida = ejecutar("Unir embeddings con fichas", respuesta_gemini(lotes),
                      nodos={"Armar lotes de embeddings": lotes})
    assert [s["clave"] for s in salida] == ["k0", "k1", "k2"]
    assert salida[0]["embedding"].startswith("[0.001,") and salida[0]["embedding"].count(",") == 767
    assert salida[2]["metricas_json"] == '{"a":2}' and salida[2]["fuentes_json"] == '["ONSV"]'


@pytest.mark.parametrize("romper, mensaje", [
    (lambda r: {"embeddings": r["embeddings"][:-1]}, "2 embeddings para 3 fichas"),
    (lambda r: {"embeddings": [{"values": [0.1] * 767}] + r["embeddings"][1:]}, "Embedding invalido para k0"),
    (lambda r: {"embeddings": [{"values": [None] * 768}] + r["embeddings"][1:]}, "Embedding invalido para k0"),
    (lambda r: {"error": {"code": 429}}, "0 embeddings para 3 fichas"),
])
def test_union_rechaza_respuestas_incompletas(romper, mensaje):
    fichas = [{"clave": f"k{i}", "contenido": "t", "modelo_embedding": "m", "fuentes": [], "metricas": {}}
              for i in range(3)]
    lotes = ejecutar("Armar lotes de embeddings", fichas)
    [respuesta] = respuesta_gemini(lotes)
    with pytest.raises(ErrorDeNodo, match=mensaje):
        ejecutar("Unir embeddings con fichas", [romper(respuesta)], nodos={"Armar lotes de embeddings": lotes})
