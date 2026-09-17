# 🛡️ Política de Seguridad de UrbanPulse (Security Policy)

## 1. Versiones con Soporte de Seguridad
El equipo de DevSecOps de UrbanPulse mantiene activamente la seguridad de las siguientes ramas y versiones:

| Versión / Rama | Entorno | Soporte Activo |
|---|---|:---:|
| main | Producción Vercel (https://equipo3-urban-pulse.vercel.app) | :white_check_mark: |
| 
elease/sprint-2 | Pruebas de Integración y Calidad | :white_check_mark: |
| develop | Desarrollo Activo | :white_check_mark: |

---

## 2. Reporte Responsable de Vulnerabilidades (Responsible Disclosure)
La seguridad e integridad de los datos de tráfico y usuarios de **UrbanPulse** es una prioridad absoluta. Si has identificado una vulnerabilidad de seguridad o riesgo de exposición de credenciales:

1. **NO abras un Issue público** en el repositorio.
2. Reporta el hallazgo de manera privada y confidencial a través de la pestaña **[Security > Advisories > Report a vulnerability](https://github.com/SergioAscurraPerez/Equipo3-UrbanPulse/security/advisories/new)** de GitHub.
3. O contacta directamente a los responsables de seguridad y gobernanza del proyecto:
   * **Álvaro Tipian** — DevSecOps Lead (@Alvaro-Tipian)
   * **Sergio Ascurra** — Arquitecto de Software (@SergioAscurraPerez)

### Información requerida en el reporte:
* Tipo de vulnerabilidad (OWASP Top 10, XSS, Fuga de secretos, CSP Bypass, etc.).
* Pasos reproducibles o prueba de concepto (PoC).
* Componente o microfrontend afectado (mf-dashboard, mf-mapa-urbano, mf-chatbot, backend o infraestructura).

---

## 3. Acuerdos de Nivel de Servicio (SLA) para Mitigación
* **Recepción y acuse de recibo inicial:** Menos de 24 horas.
* **Evaluación de impacto y triaje técnico:** Menos de 48 horas.
* **Despliegue de parche correctivo (Hotfix):** Menos de 5 días hábiles para severidades Altas o Críticas.

---

## 4. Controles DevSecOps y Estándares de Cumplimiento
Este repositorio implementa defensas continuas automatizadas:
* **SAST (Static Application Security Testing):** GitHub CodeQL + scripts/sast-frontend-scanner.js.
* **DAST Perimetral:** Auditoría dinámica de cabeceras HTTP en producción (scripts/devsecops-live-audit.js).
* **Estándares Normativos:** Cumplimiento con **OWASP ASVS v4.0** y **NIST SP 800-218**.
