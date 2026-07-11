# Caldearte — checklist de arranque (lo que hacés vos antes de que Claude Code trabaje solo)

> No todo se puede hacer de una sola vez antes de abrir Claude Code — algunas cosas (sobre todo DNS) recién se saben cuando ya hay un proyecto de Vercel o de Resend creado. Por eso está dividido en dos partes: lo que hacés ya, y lo que vas a hacer sobre la marcha cuando Claude Code te pida un valor puntual.

## Parte A — Antes de abrir Claude Code

**1. Dominio.** Ya comprado en GoDaddy (`caldearte.com`). Todavía no toques la configuración de DNS — esperá a la Parte B, porque Vercel y Resend te van a dar los registros exactos a cargar.

**2. Cuenta de GitHub.** ✅ Completado.
- Repo `caldearte` creado y con el primer commit.
- Transferido a la organización `caldearte` — ahora vive en `github.com/caldearte/caldearte`.

**3. Cuenta de Supabase.** ✅ Completado.
- Proyecto creado: nombre `caldearte`, región `us-west-2` (Oregon).
- Decisión consciente: no se priorizó cercanía a Sudamérica — el proyecto va a expandirse a más países (ver "Descubrimiento de fuentes" en `project-brief.md`), así que no tenía sentido optimizar latencia para una sola región de entrada.
- No hace falta configurar tablas todavía, eso lo hace Claude Code (con el MCP o con SQL) una vez conectado.

**4. API key de Anthropic para el proyecto.** ✅ Completado.
- Key generada en console.anthropic.com y guardada en gestor de contraseñas. Todavía no cargada en `.env.local` ni en secrets de GitHub — eso se hace cuando arranquemos a escribir el curador (paso 10, Parte B).

**5. Cuenta de Resend.**
- Creá cuenta en resend.com. Por ahora no hace falta más — la verificación del dominio viene en la Parte B.

**6. Cuenta de Vercel.**
- Creá cuenta en vercel.com (podés loguearte directo con tu cuenta de GitHub, es lo más simple). No importes el repo todavía — eso se hace cuando ya haya un primer commit de la app Next.js, más adelante con Claude Code.

**7. Herramientas locales en tu Mac.**
Instalar (ver el detalle completo en `caldearte-project-brief.md`, sección "Setup local"):
- ✅ Node.js LTS + pnpm
- ✅ Docker Desktop (instalado y corriendo)
- ✅ Supabase CLI (`brew install supabase/tap/supabase`, v2.109.1)
- ✅ GitHub CLI (`gh`), autenticado
- Vercel CLI — pendiente, no urgente (recién hace falta con el primer deploy de `apps/web`)
- `act` (opcional, para probar GitHub Actions en local) — pendiente
- `ngrok` (para probar los webhooks de Resend en local más adelante, no urgente ahora) — pendiente

**8. MCPs a conectar en Claude Code.**
- Conectá el MCP de Supabase (`claude mcp add`, vas a necesitar loguearte a tu cuenta de Supabase desde ahí).
- Opcional: MCP de GitHub.
- El MCP de Figma es una conexión aparte de la que usaste acá en Cowork — conectalo también en Claude Code si vas a seguir iterando el diseño desde ahí.

**9. Preparar el contexto para Claude Code.**
- Cloná el repo vacío a tu máquina.
- Creá una carpeta `docs/` adentro y copiá ahí los tres documentos que armamos: `project-brief.md`, `mockup-description.md`, `figma-make-prompt.md` (y el mockup `caldearte-mockup.jsx` si querés que Claude Code lo tenga como referencia de código, no solo de descripción).
- Escribí un `CLAUDE.md` corto en la raíz que le diga a Claude Code que lea esos documentos antes de arrancar. Algo simple alcanza, por ejemplo:

> Nota: este es el CLAUDE.md original con el que arrancó el proyecto. Puede haber quedado desactualizado — el archivo `CLAUDE.md` real en la raíz del repo es siempre la fuente de verdad vigente, no esta copia.

```
# Caldearte

Antes de hacer cualquier cambio, leé:
- docs/project-brief.md — definición completa del proyecto, fases, schema, políticas de curatoria
- docs/mockup-description.md — cómo funciona el prototipo de interfaz
- docs/figma-make-prompt.md — copy de curatoria y dirección visual ya definida

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
```

**Con esto ya podés abrir Claude Code en esa carpeta y arrancar.**

## Parte B — Cosas que vas a hacer sobre la marcha, cuando Claude Code te las pida

No las hagas ahora, no tenés los datos todavía — pero sabé que van a aparecer:

**10. Cargar los secrets reales en GitHub.** Una vez que el repo tenga el workflow de Actions armado, Claude Code te va a decir exactamente qué secrets crear. Vos los cargás a mano en GitHub → Settings → Secrets and variables → Actions (nunca se los pases a Claude Code en texto plano):
- `ANTHROPIC_API_KEY` (la que generaste en el paso 4)
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (los sacás del dashboard de tu proyecto Supabase, en Settings → API)
- `RESEND_API_KEY` (cuando llegues a Fase 1b)
- `RESEND_WEBHOOK_SECRET` (Fase 1b)
- `APPROVAL_TOKEN_SECRET` (te lo va a sugerir Claude Code, es un string random que generás vos o él)

**11. Conectar el dominio a Vercel.** Cuando haya un primer deploy del frontend, en el proyecto de Vercel agregás `caldearte.com` como dominio custom — Vercel te muestra el registro DNS exacto (normalmente un CNAME o A) para cargar en el panel de DNS de GoDaddy.

**12. Verificar el dominio en Resend.** En Fase 1b, cuando armes los flujos de mail, Resend te va a pedir agregar registros DKIM/SPF (y MX si vas a recibir mail ahí) en GoDaddy para poder enviar/recibir desde `@caldearte.com`.

**13. Habilitar PostGIS en Supabase.** Cuando lleguen a Fase 2 (ranking geo/temporal), hay que activar la extensión PostGIS desde el dashboard de Supabase (Database → Extensions) — Claude Code te va a avisar cuando toque.

**14. Revisión de app en Meta/TikTok.** Recién en Fase 4, y solo cuando ya haya contenido real en el calendario — no antes.
