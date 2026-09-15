# Imagen de Postgres para desarrollo local y CI. Combina las dos extensiones
# que usan las migraciones de database/migrations/: PostGIS (tabla
# siniestros_fatales, indice gist sobre geom) y pgvector (busqueda de
# reportes similares por embedding). La imagen oficial postgis/postgis ya
# trae el repositorio APT de PGDG configurado, asi que agregar pgvector es
# un apt install directo, sin compilar nada.
FROM postgis/postgis:16-3.5

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
