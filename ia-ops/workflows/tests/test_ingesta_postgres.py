"""Ingesta RAG de punta a punta contra Postgres (pgvector + PostGIS + todas
las migraciones): las consultas SQL exactas del workflow, los nodos Code en
Node.js y una respuesta de Gemini simulada. Todo corre en una transaccion que
se revierte al final.

  TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/urbanpulse_db pytest
"""

import uuid

import pytest

from conftest import ejecutar, nodo, respuesta_gemini

psycopg = pytest.importorskip("psycopg")

CALCULAR = nodo("Calcular fichas")["parameters"]["query"]
GUARDAR = nodo("Guardar fichas")["parameters"]["query"]
REPORTE_MIRAFLORES = str(uuid.uuid4())


def sembrar(cur):
    cur.execute("TRUNCATE siniestros_fatales, siniestros_sutran, conocimiento_vial")
    cur.execute("DELETE FROM reports")
    siniestros = [
        # codigo, fecha, hora, clase, fallecidos, lesionados, provincia, distrito, via, lat, lon
        ("S1", "2025-03-10", "14:20", "CHOQUE", 1, 2, "LIMA", "MIRAFLORES", "AVENIDA", -12.1211, -77.0297),
        ("S2", "2025-02-01", "15:05", "CHOQUE", 0, 3, "LIMA", "Miraflores", "AVENIDA", -12.1190, -77.0350),
        ("S3", "2025-01-15", "16:40", "ATROPELLO", 0, 1, "LIMA", "MIRAFLORES", "CALLE", -12.1300, -77.0250),
        ("S4", "2025-03-20", "08:10", "ATROPELLO", 1, 0, "LIMA", "SURCO", "AVENIDA", -12.1450, -76.9900),
        ("S5", "2025-03-21", "22:30", "DESPISTE", 0, 2, "LIMA", "Breña", "JIRON", -12.0590, -77.0500),
        ("S6", "2023-01-01", "14:00", "CHOQUE", 5, 5, "LIMA", "MIRAFLORES", "AVENIDA", -12.1211, -77.0297),
        ("S7", "2025-03-01", "14:00", "CHOQUE", 2, 2, "CALLAO", "BELLAVISTA", "AVENIDA", -12.0600, -77.1000),
    ]
    for s in siniestros:
        cur.execute(
            "INSERT INTO siniestros_fatales (codigo_siniestro, fecha_iso, hora_siniestro, clase_siniestro,"
            " fallecidos, lesionados, departamento, provincia, distrito, tipo_via, latitud, longitud,"
            " causa_factor_principal, geom)"
            " VALUES (%s, %s, %s, %s, %s, %s, 'LIMA', %s, %s, %s, %s, %s, 'VELOCIDAD',"
            " ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
            (*s, s[10], s[9]),
        )
    cur.execute(
        "INSERT INTO reports (id, description, incident_type, latitude, longitude, status, created_at, resolved_at)"
        " VALUES (%s, 'Choque en Larco', 'choque', -12.1205, -77.0300, 'resuelto',"
        " '2026-10-01 20:10:00+00', now() - interval '2 days')",
        (REPORTE_MIRAFLORES,),
    )
    cur.execute(
        "INSERT INTO reports (description, incident_type, latitude, longitude, status)"
        " VALUES ('Bache', 'bache', -12.1205, -77.0300, 'pending')"
    )
    for fecha, hora, via, km in [("2024-12-01", "19:00", "PE-1N", "25"), ("15/11/2024", "20:30", "PE-1N", "25"),
                                 ("2024-10-01", "21:00", "PE-22", "3"), ("2024-10-02", "10:00", "PE-1S", "40")]:
        cur.execute(
            "INSERT INTO siniestros_sutran (fecha_siniestro, hora_siniestro, departamento, codigo_via, kilometro,"
            " fallecidos, heridos) VALUES (%s, %s, 'LIMA', %s, %s, 1, 2)",
            (fecha, hora, via, km),
        )


def calcular(conn, modo="semanal", distrito="", reporte_id=""):
    with psycopg.RawCursor(conn) as cur:
        cur.execute(CALCULAR, (modo, distrito, reporte_id))
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, fila)) for fila in cur.fetchall()]


def ingerir(conn, filas):
    """Lo que hace el workflow despues de "Calcular fichas"."""
    fichas = ejecutar("Redactar fichas", filas)
    if not fichas:
        return []
    lotes = ejecutar("Armar lotes de embeddings", fichas)
    unidas = ejecutar("Unir embeddings con fichas", respuesta_gemini(lotes), nodos={"Armar lotes de embeddings": lotes})
    with psycopg.RawCursor(conn) as cur:
        for f in unidas:
            cur.execute(GUARDAR, (f["clave"], f["ambito"], f["distrito"], f["franja"], f["contenido"],
                                  f["fuentes_json"], f["metricas_json"], f["contenido_sha256"], f["embedding"],
                                  f["modelo_embedding"]))
    return unidas


@pytest.fixture()
def conn(dsn):
    with psycopg.connect(dsn) as c:
        with c.cursor() as cur:
            sembrar(cur)
        yield c
        c.rollback()


def test_ejecucion_semanal_crea_las_fichas_de_los_43_distritos(conn):
    filas = calcular(conn)
    assert len(filas) == 43 * 3 + 3
    guardadas = ingerir(conn, filas)
    assert len(guardadas) == 132

    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), count(DISTINCT distrito), min(vector_dims(embedding)), max(vector_dims(embedding)),"
            " bool_and(cardinality(fuentes) > 0) FROM conocimiento_vial"
        )
        assert cur.fetchone() == (132, 43, 768, 768, True)


def test_metricas_de_miraflores(conn):
    por_clave = {f["clave"]: f for f in calcular(conn)}
    m = por_clave["distrito:MIRAFLORES:tarde"]["metricas"]
    # S1-S3 (12 meses hasta el dato mas reciente); S6 es de 2023 y queda fuera.
    assert (m["siniestros"], m["fallecidos"], m["lesionados"]) == (3, 1, 6)
    assert m["clase_frecuente"] == "CHOQUE"
    assert (m["onsv_desde"], m["onsv_hasta"]) == ("2024-03-22", "2025-03-21")
    # El reporte resuelto (15:10 en Lima) cae en Miraflores por cercania; el pendiente no cuenta.
    assert m["reportes_resueltos_90d"] == 1 and m["tipo_reporte_frecuente"] == "choque"
    assert por_clave["distrito:MIRAFLORES:noche"]["metricas"]["siniestros"] == 0


def test_variantes_de_nombre_y_otras_provincias(conn):
    por_clave = {f["clave"]: f for f in calcular(conn)}
    assert por_clave["distrito:SANTIAGO DE SURCO:manana"]["metricas"]["siniestros"] == 1  # "SURCO"
    assert por_clave["distrito:BRENA:noche"]["metricas"]["siniestros"] == 1               # "Breña"
    assert not any("BELLAVISTA" in k for k in por_clave)                                   # Callao


def test_sutran_por_franja_con_ambos_formatos_de_fecha(conn):
    por_clave = {f["clave"]: f for f in calcular(conn)}
    vias = por_clave["red_vial_nacional:noche"]["metricas"]["vias"]
    assert vias[0] == {"codigo_via": "PE-1N", "siniestros": 2, "fallecidos": 2, "heridos": 4, "km_frecuente": "25"}
    assert [v["codigo_via"] for v in vias] == ["PE-1N", "PE-22"]
    assert por_clave["red_vial_nacional:manana"]["fuentes"] == ["SUTRAN"]


def test_segunda_ejecucion_no_vuelve_a_pedir_embeddings(conn):
    ingerir(conn, calcular(conn))
    assert ingerir(conn, calcular(conn)) == []


def test_evento_actualiza_solo_el_distrito_y_la_franja_que_cambiaron(conn):
    ingerir(conn, calcular(conn))
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO siniestros_fatales (codigo_siniestro, fecha_iso, hora_siniestro, clase_siniestro,"
            " fallecidos, lesionados, departamento, provincia, distrito, latitud, longitud, geom)"
            " VALUES ('S8', '2025-03-05', '09:00', 'CHOQUE', 0, 1, 'LIMA', 'LIMA', 'MIRAFLORES',"
            " -12.12, -77.03, ST_SetSRID(ST_MakePoint(-77.03, -12.12), 4326))"
        )
    filas = calcular(conn, "evento", "Miraflores", "")
    assert {f["clave"] for f in filas} == {f"distrito:MIRAFLORES:{x}" for x in ("manana", "tarde", "noche")}
    actualizadas = ingerir(conn, filas)
    assert [f["clave"] for f in actualizadas] == ["distrito:MIRAFLORES:manana"]


def test_evento_sin_distrito_lo_resuelve_por_el_reporte(conn):
    filas = calcular(conn, "evento", "", REPORTE_MIRAFLORES)
    assert {f["distrito"] for f in filas} == {"MIRAFLORES"}


def test_evento_que_no_cae_en_lima_no_toca_nada(conn):
    assert calcular(conn, "evento", "Bellavista", "") == []
    assert calcular(conn, "evento", "", str(uuid.uuid4())) == []


def test_busqueda_top5_por_similitud(conn):
    ingerir(conn, calcular(conn))
    with conn.cursor() as cur:
        cur.execute("SET LOCAL enable_seqscan = off")
        consulta = "[" + ",".join(str(0.001 + i / 1e6) for i in range(768)) + "]"
        cur.execute(
            "EXPLAIN SELECT clave FROM conocimiento_vial ORDER BY embedding <=> %s::vector LIMIT 5", (consulta,)
        )
        plan = " ".join(r[0] for r in cur.fetchall())
        assert "idx_conocimiento_vial_embedding" in plan
        cur.execute("SELECT clave FROM conocimiento_vial ORDER BY embedding <=> %s::vector LIMIT 5", (consulta,))
        assert len(cur.fetchall()) == 5
