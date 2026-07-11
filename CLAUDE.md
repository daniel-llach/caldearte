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
- Abrir pull requests (si el MCP de GitHub está conectado).
- Mergear a `main` un PR propio, siempre que pase CI y no toque `supabase/migrations/`, `.github/workflows/` ni la política de curatoria (`packages/curation-policy` cuando exista, o donde vivan las reglas/prompt de curatoria) — para código, frontend, tests o docs no hace falta que yo lo revise antes de mergear.

Pausá y preguntame antes de:
- Pushear directo a `main` sin pasar por un PR — eso saltea CI y esta lista entera de excepciones.
- Mergear un PR que toque `supabase/migrations/`. **Ojo acá en particular:** la integración de GitHub en Supabase está conectada, así que eso se aplica automáticamente contra producción apenas se mergea — el merge *es* el deploy, no hay paso separado después. Revisalo con el mismo cuidado que le pondrías a aplicarlo a mano (¿borra o transforma datos existentes? ¿es reversible?).
- Mergear un PR que toque `.github/workflows/` — cambia el pipeline de CI/CD, incluyendo lo que dispara deploys o crons.
- Mergear un PR que toque la política de curatoria — esas reglas son decisión editorial nuestra, no algo para "mejorar" por tu cuenta.
- Deploy a producción en Vercel (preview deploys están bien, prod no).
- Cualquier cosa que toque secrets reales — ni siquiera los muestres, decime qué falta cargar y yo lo hago en la UI.
- Cualquier gasto — pasar de un tier gratis a uno pago, comprar algo.
- Mandar la app a review de Meta/TikTok (Fase 4).

## Chequeo de datos sensibles — este repo es público

Antes de cualquier commit o push (incluso los que hacés sin pedir permiso más arriba), revisá que no se cuele:
- Secrets reales: API keys, tokens, contraseñas, connection strings, ni en contenido de archivos ni en nombres de archivo.
- Datos personales míos o de terceros: nombre completo, email personal, teléfono, dirección — ni en el contenido de los docs/código, ni en mensajes de commit.
- Si algo de esto está a punto de subirse, pará y avisame en vez de commitear/pushear igual — no lo resuelvas vos solo (por ejemplo reescribiendo historial) sin que te lo pida explícitamente.

Nota: el 2026-07-11 auditamos todo el historial de git y confirmamos que el contenido de los docs está limpio. Sí quedó expuesto el nombre real y el gmail personal en los metadatos de autor de varios commits (por default de git/GitHub) — decisión consciente: lo dejamos así, no es algo para "arreglar" de nuevo por tu cuenta.
