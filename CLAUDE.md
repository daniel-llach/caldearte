# Caldearte

Antes de hacer cualquier cambio, leé:
- docs/project-brief.md — definición completa del proyecto, fases, schema, políticas de curatoria
- docs/mockup-description.md — cómo funciona el prototipo de interfaz
- docs/figma-make-prompt.md — copy de curatoria y dirección visual ya definida
- docs/checklist-setup.md — qué está configurado y qué falta configurar sobre la marcha

Estamos en Fase 1a: loop central (scraper, curatoria, Supabase, calendario), sin los flujos de mail entrante todavía.

## Modo de trabajo — qué hacer solo vs. qué pausar

Hacé esto sin pedir permiso, de punta a punta:
- Escribir código, refactorizar, instalar dependencias, correr tests.
- Commits locales.
- Migraciones de base de datos contra Supabase LOCAL (`supabase start`), no producción.
- Correr el scraper/curador contra datos de prueba o la base local.
- Iterar el frontend, corregir bugs que detectes vos mismo corriendo la app.
- Abrir pull requests (si el MCP de GitHub está conectado) — no los mergees solo, eso lo reviso yo.

Pausá y preguntame antes de:
- Mergear a `main` o pushear directo a `main`.
- Aplicar una migración contra Supabase de producción, sobre todo si borra o transforma datos existentes.
- Deploy a producción en Vercel (preview deploys están bien, prod no).
- Cualquier cosa que toque secrets reales — ni siquiera los muestres, decime qué falta cargar y yo lo hago en la UI.
- Cambiar la política de curatoria — esas reglas son decisión editorial nuestra, no algo para "mejorar" por tu cuenta.
- Cualquier gasto — pasar de un tier gratis a uno pago, comprar algo.
- Mandar la app a review de Meta/TikTok (Fase 4).
