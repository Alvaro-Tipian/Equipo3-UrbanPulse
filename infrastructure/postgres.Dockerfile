# Imagen de Postgres para desarrollo local y CI. Combina las dos extensiones
# que usan las migraciones de database/migrations/: PostGIS (tabla
# siniestros_fatales, indice gist sobre geom) y pgvector (busqueda de
# reportes similares y conocimiento_vial).
#
# HT-36 T05: antes partia de postgis/postgis:16-3.5, que sigue sobre Debian 11
# (bullseye, fin de vida): los parches de seguridad ya no se distribuian y sus
# CVE criticas (libgnutls30 y el gosu compilado con Go 1.18) quedaban como
# excepcion en security/trivy-excepciones.yaml. postgis/postgis:16-3.6 esta
# sobre Debian 13 (trixie), con soporte, y conserva el script de inicio que
# activa PostGIS al crear la base: backend-integration-tests.yml y
# rag-ingesta-ci.yml esperan "SELECT postgis_version()" antes de migrar.
#
# pgvector se copia de su imagen oficial sobre la MISMA base (Debian 13,
# Postgres 16 de PGDG). vector.so solo depende de libc, y las extensiones son
# compatibles entre versiones menores de Postgres 16. Asi no hace falta apt
# en el build, y el paquete viene ya compilado por el proyecto pgvector.
#
# Etiquetas sin version de parche a proposito: cada build toma los arreglos de
# seguridad que publican las imagenes base, y el gate de Trivy (trivy-scan.yml)
# revisa el resultado en cada PR y todos los lunes. Es una imagen solo de
# desarrollo y CI: en produccion la base de datos es Neon.
FROM pgvector/pgvector:pg16-trixie AS pgvector

FROM postgis/postgis:16-3.6

COPY --from=pgvector /usr/lib/postgresql/16/lib/vector.so /usr/lib/postgresql/16/lib/
COPY --from=pgvector /usr/lib/postgresql/16/lib/bitcode/vector /usr/lib/postgresql/16/lib/bitcode/vector
COPY --from=pgvector /usr/lib/postgresql/16/lib/bitcode/vector.index.bc /usr/lib/postgresql/16/lib/bitcode/
COPY --from=pgvector /usr/share/postgresql/16/extension/vector* /usr/share/postgresql/16/extension/
