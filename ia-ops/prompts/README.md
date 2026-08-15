# Prompt Engineering — UrbanPulse

Este documento define las reglas que sigue la célula para diseñar, versionar y proteger los prompts que usan los flujos de n8n al comunicarse con los LLMs (Gemini / Groq), según lo definido en la Épica 5 (*Orquestar IA y Prompt Engineering Estratégico*) y la Épica 6 (*Observabilidad e IA Ops*).

## 1. Objetivo

Evitar que los prompts queden **hardcodeados** dentro de los nodos de n8n, garantizar que sean auditables, versionables y fáciles de actualizar sin tocar la lógica del flujo, y reducir el riesgo de alucinaciones o *Prompt Injection* en las denuncias ciudadanas.

## 2. Regla principal: ningún prompt vive dentro de un nodo

Ningún nodo de n8n (Code, HTTP Request, AI Agent, etc.) debe contener el texto del prompt escrito directamente en su configuración. En su lugar:

- Cada prompt se guarda como un archivo `.md` o `.txt` independiente dentro de `src/ia-ops/prompts/`.
- El flujo de n8n **referencia** ese archivo (o su contenido cargado como variable de entorno / *Set* node al inicio del flujo), nunca lo reescribe inline.
- Todo cambio de prompt se hace vía Pull Request sobre ese archivo, siguiendo las mismas reglas de Branch Protection que el resto del código (revisión obligatoria antes de merge a `main`).

## 3. Estructura de carpetas

```
src/ia-ops/prompts/
├── README.md                     # este documento
├── clasificacion_incidente.md    # prompt para clasificar tipo/gravedad del reporte
├── extraccion_geolocalizacion.md # prompt de apoyo para contexto de ubicación
└── nlq_ciudadano.md              # prompt para interpretar consultas en lenguaje natural
```

Cada archivo de prompt debe incluir, como mínimo:

| Campo | Descripción |
| --- | --- |
| **Versión** | Número incremental (v1, v2...) |
| **Modelo destino** | Gemini / Groq |
| **Rol del sistema** | Instrucción de sistema (system prompt) |
| **Variables esperadas** | Qué datos inyecta n8n (texto del ciudadano, metadatos de imagen, contexto de Open Data) |
| **Salida esperada** | Formato exacto (ej. JSON con `tipo`, `gravedad`, `ubicacion`) |
| **Fecha y autor del último cambio** | Trazabilidad |

## 4. Prevención de Prompt Injection

Dado que el texto que ingresa un ciudadano es de lenguaje libre, se aplican estas medidas mínimas:

- El **system prompt** siempre delimita explícitamente que el texto del ciudadano es *dato de entrada*, nunca una instrucción (uso de delimitadores claros, ej. bloques `<reporte_usuario>...</reporte_usuario>`).
- Se instruye al modelo a **ignorar cualquier instrucción contenida dentro del texto del reporte** (ej. "olvida tus reglas anteriores").
- La salida del modelo se valida contra un esquema fijo (JSON con campos esperados) antes de continuar el flujo en n8n; si no cumple el esquema, se descarta y se reintenta o se marca para revisión manual.
- Estos casos se documentan como escenarios de prueba en el plan de QA de prompts (equivalente al informe de pruebas DevSecOps, pero aplicado a IA).

## 5. Prevención de alucinaciones

- Los prompts de clasificación no piden al modelo "inventar" datos que no están disponibles (ej. si no hay metadatos GPS, el prompt indica devolver `ubicacion: null`, no inferir una coordenada).
- Se define un prompt de contingencia (*failover*) simple para cuando el LLM principal no responde o responde fuera de formato, evitando que el flujo se caiga.

## 6. Versionado y trazabilidad

- Todo prompt nuevo o modificado se sube mediante PR con prefijo `feat:` o `fix:`, según corresponda, y debe referenciar el Issue de GitHub Projects asociado.
- Los cambios de prompt en producción quedan registrados también en Langfuse / Phoenix (observabilidad), asociando cada ejecución del flujo a la versión del prompt usada, tal como está definido en la Épica 6.

## 7. Checklist antes de mergear un prompt nuevo

- [ ] El prompt está en su propio archivo dentro de `src/ia-ops/prompts/`, no dentro del nodo de n8n.
- [ ] Incluye versión, modelo destino, variables esperadas y formato de salida.
- [ ] Delimita claramente el texto del usuario como dato, no como instrucción.
- [ ] Define comportamiento por defecto ante datos faltantes (sin inventar información).
- [ ] Fue probado manualmente con al menos un caso normal y un caso de intento de inyección.
