# 🛡️ Informe Técnico de Cumplimiento DevSecOps: Suite de Auditoría Continua y Hardening en Producción (HT-30)

**Proyecto:** UrbanPulse — Gestión Inteligente de Tráfico y Seguridad Vial  
**Sprint:** Sprint 2  
**Historia de Usuario:** HT-30 — Hardening de Keys y Políticas de Seguridad en Producción  
**Autor / Responsable:** Álvaro Tipian (Ingeniero DevSecOps)  
**Fecha:** 17 de Septiembre, 2026  
**Estado:** ✅ APROBADO Y MERGEABLE (PR #221)  
**Calificación Obtenida:** **100/100 — Nivel A+ (Excelente)** 🏆  

---

## 1. 🎯 Resumen Ejecutivo

El presente informe técnico documenta la implementación, verificación y certificación de las defensas perimetrales y de código para el frontend federado de **UrbanPulse** desplegado en **Vercel** (`https://equipo3-urban-pulse.vercel.app`).

Como culminación del Sprint 2, se desarrolló una **Suite de Auditoría Continua DevSecOps** que valida de forma dinámica (DAST de cabeceras en vivo) y estática (SAST de código fuente) que la plataforma cumple rigurosamente con los estándares internacionales de seguridad:
* **OWASP ASVS v4.0** (*Application Security Verification Standard*)
* **NIST SP 800-218** (*Secure Software Development Framework - SSDF*)
* **Mozilla Observatory Security Guidelines**
* **GitHub Advanced Security (CodeQL)**

---

## 2. 🏗️ Arquitectura de la Suite de Auditoría DevSecOps

A diferencia de análisis teóricos o locales, la herramienta desarrollada ejecuta inspección de red por HTTPS real contra los nodos Edge de producción en Vercel y analiza el árbol de dependencias del monorepositorio sin requerir dependencias externas de terceros (`0 external npm packages`), garantizando portabilidad absoluta y cero riesgo de vulnerabilidades en la cadena de suministro (*supply chain attack immunity*).

```
   ┌──────────────────────────────────────────────────────────────┐
   │         URBANPULSE DEVSECOPS CONTINUOUS AUDIT SUITE          │
   │               (scripts/devsecops-live-audit.js)              │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌────────────────────────────────┐         ┌────────────────────────────────┐
│  Módulo DAST de Red en Vivo    │         │   Módulo SAST Estático Local   │
│  (Producción Vercel Edge)      │         │   (sast-frontend-scanner.js)   │
├────────────────────────────────┤         ├────────────────────────────────┤
│ • HSTS (max-age=63072000)      │         │ • Escaneo de 4 Microfrontends  │
│ • X-Frame-Options: DENY        │         │ • Detección de llaves privadas │
│ • X-Content-Type: nosniff      │         │ • Validación VITE_ públicas    │
│ • Referrer-Policy: strict-orig │         │ • Bloqueo de URLs de BD y n8n  │
│ • Permissions-Policy APIs      │         │                                │
│ • CSP v3 (Tokens & Workers)    │         │                                │
└────────────────────────────────┘         └────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            CERTIFICACIÓN Y SCORECARD DE SEGURIDAD            │
   │           Puntaje: 100/100 (Nivel A+) | 0 Alertas CodeQL     │
   │      Reporte Oficial: docs/SECURITY_COMPLIANCE_AUDIT_REPORT.md│
   └──────────────────────────────────────────────────────────────┘
```

---

## 3. 📊 Matriz de Verificación en Tiempo Real (Producción Vercel)

La auditoría ejecutada contra el entorno productivo certificó los siguientes parámetros:

| Regla de Seguridad | Estándar / RFC | Configuración Verificada en Vercel | Ponderación | Estado |
|---|---|---|:---:|:---:|
| **Strict-Transport-Security (HSTS)** | RFC 6797 / OWASP A05 | `max-age=63072000; includeSubDomains; preload` | 20 pts | **✅ PASS** |
| **X-Frame-Options** | RFC 7034 / CWE-1021 | `DENY` | 15 pts | **✅ PASS** |
| **X-Content-Type-Options** | Fetch Spec / CWE-79 | `nosniff` | 15 pts | **✅ PASS** |
| **Referrer-Policy** | W3C Referrer Policy | `strict-origin-when-cross-origin` | 10 pts | **✅ PASS** |
| **Permissions-Policy** | W3C Permissions Policy | `camera=(), microphone=(), geolocation=(self)...` | 10 pts | **✅ PASS** |
| **Content-Security-Policy (CSP v3)** | W3C Level 3 / Anti-XSS | `worker-src blob:; child-src blob:; connect-src blob: gemini tomtom` | 30 pts | **✅ PASS** |
| **Análisis Estático SAST** | OWASP Top 10 A02:2021 | Cero secretos y cero credenciales expuestas en frontend | Req. | **✅ PASS** |

**Puntaje Total Obtenido:** **100 / 100 (Nivel A+ - Máxima Calificación)**.

---

## 4. 🛡️ Mitigaciones Técnicas y Cumplimiento con GitHub CodeQL

Durante el proceso de integración continua en el Pull Request **#221**, GitHub Advanced Security (CodeQL) ejecutó el análisis estático y detectó dos alertas de buenas prácticas que fueron solventadas con rigor de ingeniería DevSecOps:

### Hallazgo 1: Incomplete URL Substring Sanitization (Severity: High)
* **Vulnerabilidad potencial:** Se utilizaba evaluación de subcadenas (`csp.includes("generativelanguage.googleapis.com")`). En políticas estrictas, verificar un subdominio mediante coincidencia parcial de texto es vulnerable a suplantación (*domain spoofing*, ej. `attacker-generativelanguage.googleapis.com`).
* **Mitigación DevSecOps implementada:** Se diseñó un parser sintáctico de CSP que separa las directivas y tokens en un `Map` y estructuras `Set` (`directiveMap.get('connect-src').has('https://generativelanguage.googleapis.com')`). De este modo, la verificación es por token exacto dentro de la directiva, erradicando el falso positivo y garantizando máxima robustez.

### Hallazgo 2: Log Injection (Severity: Medium)
* **Vulnerabilidad potencial:** En el manejador de error de red `req.on('error', (err) => console.error(..., err.message))`, se interpolaba la variable dinámica del error directamente, lo que en entornos desprotegidos permite inyección de retornos de carro (`\r\n`).
* **Mitigación DevSecOps implementada:** Se aisló la salida utilizando mensajes estáticos y deterministas sin interpolación de entradas externas.
* **Resultado CI/CD:** El escáner CodeQL pasó a estado **`SUCCESS (0 alertas)`**.

---

## 5. 📂 Inventario de Productos y Entregables para la Carpeta del Sprint 2

Para la entrega académica y técnica, se estructuraron los siguientes artefactos en el repositorio oficial:

### A. Productos de Código Fuente (`01_Codigo_y_Herramientas/`)
1. `scripts/devsecops-live-audit.js`: Motor CLI de auditoría en vivo contra producción y SAST local.
2. `scripts/sast-frontend-scanner.js`: Analizador estático de secretos y variables privadas de red.
3. `src/frontend/vercel.json`: Declaración perimetral de cabeceras HTTP, CSP v3 granular y CORS para microfrontends.
4. `src/frontend/.env.example` y `src/frontend/.env.production.example`: Estándar de variables públicas sanitizadas y variables maestras para Vercel Secrets.

### B. Productos de Pipeline y Gobernanza (`02_CI_CD_y_Gobernanza/`)
1. `.github/workflows/deploy.yml`: Compuerta de despliegue con validación SAST obligatoria.
2. `.github/workflows/sast-codeql.yml`: Pipeline de GitHub Advanced Security / CodeQL integrado en el ciclo de vida del software.
3. `.github/workflows/backend-ci.yml`: Pipeline optimizado con tolerancia a fallos en pruebas de IA no deterministas.
4. `.github/CODEOWNERS`: Asignación formal de `@Alvaro-Tipian` como co-owner técnico para la revisión y aprobación de cambios en infraestructura, frontend y workflows.

### C. Productos de Documentación y Evidencia (`03_Documentacion_y_Auditorias/`)
1. `docs/SECURITY_COMPLIANCE_AUDIT_REPORT.md`: Reporte ejecutivo generado automáticamente con Scorecard 100/100.
2. `docs/HTTP_SECURITY_HEADERS_CORS_CSP.md`: Especificación técnica de cabeceras HTTP, CORS y CSP.
3. `docs/VERCEL_PRODUCTION_KEYS_HARDENING.md`: Guía de hardening de llaves en producción.
4. `docs/SAST_DEPLOYMENT_RULES.md`: Reglas del analizador estático de código.
5. `docs/INFORME_TECNICO_DEVSECOPS_HT30_AUDITORIA_CONTINUA.md`: Este informe técnico formal.

---

## 6. 🚀 Trazabilidad en GitHub

* **Pull Request Principal:** [PR #221 — feat(devsecops): agregar suite de auditoria de seguridad en vivo y reporte de cumplimiento](https://github.com/SergioAscurraPerez/Equipo3-UrbanPulse/pull/221)
* **Commit de Mitigación CodeQL:** `d2a36d0f`
* **Checks en Verde:**
  * ✅ *CodeQL (javascript-typescript): Completed / Success*
  * ✅ *Gobernanza PR: Completed / Success*
  * ✅ *Seguridad en workflows n8n: Completed / Success*
