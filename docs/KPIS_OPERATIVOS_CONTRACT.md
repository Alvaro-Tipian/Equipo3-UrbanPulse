# Contrato C4: KPIs de operativos (HU-11)

**Autor:** Sergio Ascurra (Arquitecto)  
**Fecha:** 30/10/2026  
**Sub-tarea:** HU-11 T01 (webhook y contrato)  
**Workflow:** "UrbanPulse - Dashboard KPIs" (`src/n8n-workflows/production/UrbanPulse - Dashboard KPIs vr2.json`)  
**Consume:** Sergio Ascurra (HU-11 T02 y T03, `mf-dashboard`), Fabio Saavedra (HU-11 T05)  
**Pruebas:** `ia-ops/workflows/tests/test_kpis_operativos.py`

---

## 0. Autenticación

Usa la copia en línea de "Validar token" del contrato C1 con `rol_minimo = "operador"` y sin `permitir_sin_token`.

- Petición: `Authorization: Bearer <token del login>`.
- Sin token, con firma alterada o vencido: `401 { "error": "token_invalido" }`.
- Token de ciudadano: `403 { "error": "rol_no_permitido" }`.

---

## 1. `GET /urbanpulse/kpis-operativos`

```json
{
  "operativos": [{
    "id": "uuid",
    "zona": "Miraflores",
    "tipo_principal": "bache",
    "incluidos": 5,
    "resueltos": 4,
    "efectividad": 0.8,
    "horas_atencion": 26.5
  }],
  "tiempo_por_tipo": [{
    "tipo": "bache",
    "semana": "2026-W44",
    "horas_promedio": 31.2
  }],
  "actualizado": "2026-10-27T18:30:00Z"
}
```

### 1.1 `operativos`

Operativos cerrados en las últimas 4 semanas, del cierre más reciente al más antiguo. El contrato no define "sprint" en la base, así que la ventana cubre el sprint en curso sin depender de sus fechas.

| Campo | Regla |
|---|---|
| `zona` | Nombre para mostrar (`distritos_lima.nombre`, o `Sin distrito`). |
| `tipo_principal` | `incident_type` más frecuente del operativo, o `sin clasificar`. |
| `incluidos` | Reportes del operativo. |
| `resueltos` | Reportes del operativo con `status = 'resuelto'`. |
| `efectividad` | `resueltos / incluidos`, de 0 a 1, con 2 decimales. |
| `horas_atencion` | Horas entre `creado_en` y `cerrado_en`, con 1 decimal (mismo cálculo que `POST /operativos/asignar`, contrato C2). |

Cerrar un operativo pasa sus reportes a `resuelto` en la misma operación (ADR-016). Por eso hoy la efectividad de un operativo cerrado es 1, salvo que un reporte se reabra después.

### 1.2 `tiempo_por_tipo`

Promedio de horas entre `created_at` y `resolved_at` por `incident_type` y semana ISO (hora de Lima), con los reportes resueltos en las últimas 4 semanas. Incluye los reportes resueltos con o sin operativo, para comparar el tiempo de atención antes y después de los operativos. Los reportes sin `incident_type` no cuentan.

Viene ordenado por `semana` y `tipo`. Si un tipo no tuvo reportes resueltos en una semana, esa fila no existe.

### 1.3 Sin datos

Sin operativos cerrados, `operativos` llega como `[]` y la vista muestra «Aún no hay operativos cerrados».
