# Imagen de Postgres para desarrollo local y CI. Combina las dos extensiones
# que usan las migraciones de database/migrations/: PostGIS (tabla
# siniestros_fatales, indice gist sobre geom) y pgvector (busqueda de
# reportes similares por embedding). La imagen oficial postgis/postgis ya
# trae el repositorio APT de PGDG configurado, asi que agregar pgvector es
# un apt install directo, sin compilar nada.
#
# postgis/postgis:16-3.5 sigue sobre Debian bullseye, cuyo repositorio PGDG
# ya no esta en apt.postgresql.org (404 en el Release). Se apunta al archivo
# historico apt-archive.postgresql.org, que conserva postgresql-16-pgvector.
FROM postgis/postgis:16-3.5

# Aqui NO se hace apt-get upgrade. La base esta sobre Debian 11 (bullseye),
# que llego a fin de vida: los indices todavia anuncian los parches de
# seguridad (libgnutls30 3.7.1-5+deb11u10, entre otros) pero los .deb ya no
# estan en deb.debian.org y toda la actualizacion muere con 404. Las dos CVE
# criticas de libgnutls30 quedan como excepcion fechada en
# security/trivy-excepciones.yaml; la correccion de verdad es mover esta
# imagen a una base soportada, y eso es un cambio aparte porque toca los
# workflows que esperan postgis ya activo (ver DEVSECOPS_TEAM_GUIDELINES.md).
RUN sed -i 's|http://apt.postgresql.org/pub/repos/apt|https://apt-archive.postgresql.org/pub/repos/apt|g' /etc/apt/sources.list.d/*.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
