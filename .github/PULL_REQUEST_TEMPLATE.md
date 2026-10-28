## 🔗 Vinculación con Gestión (GitHub Projects)
- **Issue vinculado:** Closes #

## 📝 Descripción del Cambio
*Describe detalladamente qué hace este Pull Request y por qué es necesario.*

## 🏗️ Instrucciones de Despliegue (TALLER DE PROYECTOS)
*Según los lineamientos del TALLER DE PROYECTOS, si este PR incluye cambios en la infraestructura, debes documentar los pasos de despliegue.*
[Escribe aquí los pasos exactos si tu PR modifica Vercel, AWS Lightsail, PostgreSQL o Docker. Si no aplica, borra esta sección o escribe "N/A"]

## 🏷️ Tipo de Cambio
*Marca la opción correspondiente con una `[x]`*:
- [ ] Nueva funcionalidad
- [ ] Corrección de error
- [ ] Mejora / refactorización
- [ ] Cambio de configuración
- [ ] Cambio de infraestructura
- [ ] Cambio en workflow de n8n
- [ ] Cambio en prompts o pruebas de IA
- [ ] Cambio de base de datos
- [ ] Documentación

## ⚙️ Checklist de configuración (A3)
*Si el PR agrega o cambia secretos, variables, URLs, workflows de n8n o despliegues, verifica la [checklist A3](../docs/CHECKLIST_CONFIGURACION.md) en staging y producción. Si no aplica, escribe "N/A".*
- [ ] Secretos y variables existen con el nombre exacto en todos los entornos (S1–S4).
- [ ] URLs sin espacios y apuntando al entorno correcto (U1–U3).
- [ ] Workflows publicados, con credenciales asignadas y probados con una llamada real (F1–F4).
- [ ] El despliegue nuevo quedó activo y su health check responde (D1–D3).

## 🛡️ Checklist de Seguridad (DevSecOps Gate)
*Es obligatorio marcar todas las casillas correspondientes antes de solicitar revisión.*
- [ ] Confirmo que el código fue probado en mi entorno local y funciona correctamente.
- [ ] Confirmo que el título de este PR sigue el estándar de *Conventional Commits*.
- [ ] Confirmo que no estoy exponiendo secretos ni credenciales en texto plano (como llaves de IA o BD).
- [ ] Confirmo que no hay claves sensibles hardcodeadas con el prefijo `VITE_` en el código fuente del frontend.