# Caldearte — Project Brief

> Documento de contexto para arrancar el proyecto dedicado (Claude Code / repo propio). Resume las decisiones tomadas en la sesión de brainstorming del 10/07/2026.

## Visión

Calendario público de inauguraciones de arte (galerías, museos, espacios sociales), curado con un criterio editorial propio, mantenido con automatización (GitHub Actions + Claude API + Supabase) para minimizar el tiempo de operación manual — que fue la causa original de abandono del proyecto hace +10 años.

**Objetivo principal:** proyecto de aprendizaje técnico (actualización en Nx/monorepos, agentes con LLM, geoespacial, APIs de publishing) que de paso aporta valor real (divulgación de inauguraciones). Gratuito por diseño. La monetización queda abierta como opción futura, no como objetivo de partida — evita repetir el error de la versión anterior (se abandonó por falta de tiempo, no solo por falta de monetización).

**Restricción explícita de scope:** no perseguir "crecer para monetizar" como prioridad. Éxito = se mantiene solo con mínimo mantenimiento + hay aprendizaje real en el camino.

## Alcance: qué es un evento válido para Caldearte

### Solo inauguraciones, no muestras ya abiertas

El calendario existe para capturar el único momento en que se cruzan artista, obra y espectadores — la inauguración, no la muestra en general. Reglas:

- Si al momento del scraping la fecha de inauguración ya pasó, el candidato se descarta directamente, no se agrega.
- Un evento agregado se mantiene visible hasta 7 días después de su fecha de inauguración, y luego se borra de la base — no se archiva, se elimina. El calendario debe sentirse siempre "vivo" y en movimiento, no un archivo histórico.
- Implicancia de arquitectura: hace falta un segundo cron (además del de scraping) que corra diariamente y borre `events` con más de 7 días desde `opening_datetime`. Es liviano, una sola query DELETE.
- Implicancia de schema: conviene que el campo de fecha se llame explícitamente `opening_datetime` (fecha **y hora** de la inauguración), no `event_date` genérico — muchas fuentes van a dar solo un rango de exhibición ("del 10 de julio al 30 de agosto") sin distinguir la noche de inauguración. Cuando la fuente da un horario de inauguración explícito, se usa ese dato con confianza alta; cuando solo hay un rango, se toma la fecha de inicio como proxy pero con confianza baja — este es un caso candidato a escalar si no hay certeza de que la fecha de inicio sea realmente la noche de apertura.

### Qué cuenta como arte

**Incluido**, medios tradicionales: dibujo, pintura, escultura, grabado y otros medios tradicionales de artes visuales.

**Incluido**, intervenciones artísticas no tradicionales: performance, happening, graffiti, e intervenciones que usan danza, cuerpo o instrumentos musicales **como parte de una intervención/happening artístico** — no como formato convencional.

**Excluido explícitamente**, aunque use los mismos elementos: danza en su formato/espacio tradicional (función de danza en teatro o sala de danza), y conciertos/tocatas convencionales. La prueba distintiva no es el medio (danza, música), es el formato: ¿es una intervención/happening artístico, o es una función/show convencional en su circuito habitual? Lo primero entra, lo segundo no, aunque comparta elementos (cuerpo, instrumentos) con lo que sí se acepta.

Casos ambiguos (¿esto es performance art o es básicamente un concierto con elementos visuales?) se escalan a revisión humana — no es una distinción que convenga forzar automáticamente sin evidencia clara.

## Sensibilidad de contenido para el visitante (nuevo)

Distinto del filtro de curatoria (que decide qué entra o no al calendario): esto es un control de exposición para quien visita el sitio, sobre contenido que sí pasó la curatoria pero puede no ser apto para cualquier persona/edad — desnudo/erotismo, guerra/violencia (incluida la denuncia legítima, que se incluye en el calendario pero igual amerita aviso visual), memoria/dictadura.

**Capa 1 — blur por defecto (comportamiento base, sin configuración).** Los eventos con tag de sensibilidad se muestran con la imagen difuminada y un overlay ("Contenido sensible: desnudo/erotismo" / "Memoria y dictadura"); quien quiere ver, hace click para revelar. Es opt-in para ver, no opt-out para ocultar — la fricción mínima ya filtra el click accidental. Aplica a todo visitante nuevo sin que tenga que configurar nada.

**Capa 2 — "modo familiar" (toggle explícito).** En vez de difuminar, oculta directamente los eventos con tag de sensibilidad de la grilla — cero exposición, ni overlay. Se guarda en cookie (misma mecánica que la preferencia de ciudad), así que se aplica desde el primer render en el servidor, sin flash de contenido antes de que cargue el JS del cliente.

**Límite honesto:** esto es un control de preferencia/parental por dispositivo, no verificación de edad real — no hay cuentas ni login en el MVP, no hay forma de "saber" quién está mirando. Es una cookie, no una garantía.

**Costo de implementación: marginal, no una llamada nueva.** El tagueo de sensibilidad (`sensitivity_tags`) se agrega como output adicional a la misma llamada de Haiku que ya evalúa los cinco ejes de curatoria, y a la llamada de vision ya prevista para el Eje 5 (agresión explícita) — no hace falta una pasada aparte del pipeline.

Implicancia de schema: `events.sensitivity_tags` (array: `desnudo_erotismo` | `guerra_violencia` | `memoria_dictadura`, puede tener más de uno). Se agrega a Fase 1 junto con el resto del tagueo de curatoria, dado el costo marginal — no tiene sentido dejarlo para después si ya se está pagando la llamada.

## Flujos de email automatizados (nuevo)

Este era un problema real de la versión anterior: conseguir la fecha exacta de inauguración a veces requería contactar al espacio a mano. Se automatiza con dos flujos nuevos, ambos sobre Resend — que además de enviar también recibe: procesa emails entrantes a un dominio propio y los entrega como webhook (`email.received`) con el cuerpo y los adjuntos ya parseados. No hace falta sumar un segundo proveedor (tipo Cloudflare Email Routing) solo para esto.

**Principio no negociable: transparencia.** Todo email automatizado —el de consulta de fecha, el de acuse de recibo, el de aprobación a los curadores— debe decir explícitamente que fue generado automáticamente, con quién contactar si hay dudas. Conviene un footer estándar reutilizado en los tres flujos.

### Flujo 1 — Consulta automática de fecha de inauguración

Se dispara cuando un evento candidato pasa los filtros de contenido y de venue, pero `opening_date_confidence` queda en "baja" (la fuente solo dio un rango de exhibición, no un horario de apertura) y el venue tiene un email de contacto conocido.

1. Se envía un mail automatizado al espacio pidiendo la fecha/hora exacta de inauguración, dejando explícito que es automático y que el evento fue encontrado en su difusión pública.
2. Cada mail sale con una dirección de respuesta única por evento (ej. `responde+<event_id>@inbound.caldearte.com`) — Resend permite rutear el webhook entrante según el campo `to`, así que la respuesta se correlaciona con el evento sin depender de parsear threads de mail.
3. Cuando llega la respuesta, otra llamada a Haiku extrae la fecha/hora del texto libre de la respuesta humana. Si la extracción es clara, se actualiza `opening_datetime` con confianza alta. Si no es clara, se escala a revisión humana adjuntando la respuesta original.
4. Sin respuesta pasados unos días (a definir, propongo 4-5 días dado que las inauguraciones se organizan con poca antelación): no se asume la fecha de baja confianza silenciosamente — se escala a revisión humana con la nota "sin confirmación del espacio", porque mostrar una fecha de inauguración incorrecta rompe la promesa central del producto.

### Flujo 2 — Buzón público para sugerir inauguraciones

Una dirección de contacto publicada (ej. `agrega@caldearte.com`) donde cualquiera —el espacio mismo, un vecino, un artista— puede escribir contando de una inauguración para sumar al calendario, con foto adjunta si quiere.

- El mail entrante (texto + adjuntos, ya parseados por Resend) se convierte en un evento candidato con `source = "submitted"` y entra exactamente al mismo pipeline de curatoria que los eventos scrapeados — ejes de contenido, filtro de venue, confianza de fecha. No hay atajo de confianza automática por venir de una sugerencia humana.
- La respuesta se manda **después** de que la curatoria resuelve, no antes, y refleja el resultado real (no es un acuse de recibo genérico):
  - **Aprobado:** agradece y confirma que se va a agregar al calendario.
  - **Rechazado automáticamente:** agradece y explica, con tacto, que no está dentro de la línea curatorial de Caldearte — sin necesidad de entrar en el detalle exacto de qué regla se aplicó (eso queda en `curation_reasoning`, de uso interno). Conviene que el modelo redacte esta explicación como un texto aparte, más diplomático que el razonamiento interno, en vez de exponer directamente los ejes de exclusión a quien escribió.
  - **Escalado a revisión humana:** agradece y aclara que está en revisión, sin adelantar un sí o un no todavía; se les contacta si hace falta más información (ej. fecha de inauguración).
- Implicancia de schema: separar `curation_reasoning` (interno, técnico, para los curadores) de un nuevo campo `public_explanation` (texto generado para el remitente, solo se usa cuando el resultado es rechazo automático).
- Nota de diseño pendiente: al ser un canal público y abierto, conviene algún control básico anti-abuso (largo máximo, filtro simple antes de gastar una llamada a Haiku) para que no se pueda inundar el buzón — no es bloqueante para el MVP, pero hay que tenerlo presente.

Secret nuevo a sumar a la tabla de más abajo: `RESEND_WEBHOOK_SECRET`, para verificar que los webhooks entrantes realmente vienen de Resend antes de procesarlos (canal público = superficie de abuso si no se valida la firma).

## Filosofía de curatoria

Curatoria editorial explícita y no neutral, definida por dos personas (vos y tu socia): default-excluir sobre cinco ejes (religión, guerra/violencia, extrema derecha, pseudociencia/superstición, agresión física/sexual explícita) más un filtro de venue, con excepción solo por postura crítica explícita. Cuando el modelo tiene dudas, no decide solo — dispara el flujo de aprobación humana por mail. La versión operacional completa (ejemplos, prompt, señales de escalamiento) está más abajo, en "Política de curatoria — versión operacional (v2)" — esta sección de arriba queda solo como resumen de principios, la v2 es la autoritativa.

Decisión de producto: esta curatoria particular **es la propuesta de valor**, no algo a esconder. Vale la pena hacerla explícita en el sitio (ej. sección "Sobre la curatoria").

## Fases

**Fase 0 — Definición (esta etapa).** Cerrar este documento, pasar a un repo dedicado.

**Fase 1a — Loop central (sin flujos de mail entrante).**
- Se arranca con la primera corrida de Proceso A sobre **Chile completo** (varias regiones chilenas activas, semanal desde el día uno) en vez de sembrar venues a mano — ver "Descubrimiento de fuentes" más abajo para el detalle completo del ranking de expansión y la lógica de saturación.
- Cron diario en GitHub Actions recorre los venues ya descubiertos (Proceso B / "recorrido", ver sección siguiente).
- Scraper determinístico extrae HTML + candidatos de imagen (`<img src/alt/dimensiones>`).
- Claude Haiku 4.5 evalúa cada evento candidato contra los cinco ejes de curatoria + filtro de venue (texto), elige la imagen destacada, y corre el chequeo de vision del Eje 5 (agresión explícita) más el tagueo de `sensitivity_tags`.
- Casos ambiguos → mail con dos botones (incluir/no incluir) vía Supabase Edge Function con token de un solo uso.
- Escritura en Supabase (Postgres).
- Cron diario adicional de limpieza: borra eventos con más de 7 días desde `opening_datetime`.
- **★ Todo lo de arriba se puede construir y probar sin ninguna decisión de diseño resuelta** — se verifica mirando directamente la tabla de Supabase (Studio o una query), no hace falta interfaz para validar que el scraper, la curatoria y la limpieza funcionan bien. El diseño de producto/interfaz no bloquea nada de esto.
- **Acá sí es bloqueante: Diseño de producto/interfaz**, resuelto antes de escribir el `apps/web` — porque sin esto, cualquier frontend que se empiece a codear es descartable, no un punto de partida real:
  - Arquitectura de información: qué va en la vista principal (¿grid, lista, mapa?), qué campos entran en una card (imagen, título, artista, fecha, distancia), cómo se filtra/ordena, dónde viven el selector de ciudad y el toggle de "modo familiar", cómo se presenta "Sobre la curatoria".
  - Exploración visual en Figma Make: 2-3 direcciones, mobile-first, decidiendo ahí mismo dónde van los 1-2 momentos 3D/dramáticos (hero, transición de detalle) y dónde se mantiene el recorrido rápido y plano (el scan del calendario en sí).
  - Tratamiento visual del overlay de contenido sensible (blur + label).
  - No hace falta que sea muy formal para este tamaño de proyecto — un par de pantallas resueltas en Figma Make más las decisiones de layout alcanzan, no hace falta un design system completo.
- Frontend Next.js mostrando el calendario según lo definido arriba, deploy en Vercel (Hobby), con blur por defecto + toggle de "modo familiar" para contenido con `sensitivity_tags`.

**Fase 1b — Flujos de mail entrante.**
- Flujo 1 (consulta automática de fecha de inauguración) y Flujo 2 (buzón público para sugerir inauguraciones), ambos sobre Resend inbound + webhook + Edge Function, según quedó diseñado en "Flujos de email automatizados".
- Se separa de 1a porque suma complejidad real (correlación de respuestas por token, verificación de firma de webhook, tunneling con ngrok para probar en local) que no debería bloquear tener el loop central funcionando y demostrable primero.

**Fase 1c — Proceso A de descubrimiento de venues (ver "Descubrimiento de fuentes" más abajo).**
- No bloqueante para 1a/1b — hace crecer la lista de venues de fondo, con menor frecuencia que el crawl diario.

**Fase 2 — Personalización geo/temporal.**
- Tabla `venues` con lat/lng geocodificados (Nominatim, una vez por venue).
- PostGIS en Supabase para ordenar eventos por combinación de distancia + días-hasta-el-evento según ciudad del usuario.
- Detección de ciudad del usuario: **decidido** — geolocalización por IP nativa de Vercel (headers `x-vercel-ip-*`, gratis, funciona en SSR) como default silencioso + selector manual como override persistido en cookie. Detalle completo en "Detección de ciudad del usuario — decisión", más abajo.

**Fase 3 — Pipeline de imágenes, hardening.**
- Descargar y rehostear imágenes en Supabase Storage (no depender de URLs externas que se rompen).
- Control de calidad general con vision (Claude) sobre la imagen elegida, antes de guardar — más allá del chequeo de agresión explícita del Eje 5 (que se adelanta a Fase 1), acá se agrega la validación general de "esto es efectivamente la obra/flyer, no un banner o logo".

**Fase 4 — Distribución social (Instagram / TikTok).**
- Requiere pieza nueva: generación de imagen tipo flyer (card con imagen + título + fecha + artista) por evento.
- Instagram: cuenta Business/Creator + Página de FB + app de Meta developer + permiso `instagram_business_content_publish` vía app review (2-4 semanas).
- TikTok: Content Posting API, app review manual (2-6 semanas), posts quedan en modo privado hasta pasar auditoría, piden demo/video y privacy policy.
- Recomendación: mandar a review recién cuando el calendario ya tenga eventos reales corriendo (mejor demo, mejor tasa de aprobación).

**Fase 5 — Parqueado / opcional, no bloquea nada anterior.**
- Adopción de Nx como ejercicio deliberado de monorepo tooling, una vez el core esté estable (retrofit con `npx nx init` sobre el workspace pnpm, no hace falta decidirlo ahora).
- Exploración de monetización, solo si hay tracción orgánica.

## Descubrimiento de fuentes (dos procesos distintos, no uno solo)

Buena observación: "recorrer una lista de fuentes" y "encontrar fuentes nuevas por research" son dos procesos distintos, con distinta frecuencia, distinto costo y distinto modelo. Se separan así:

### Proceso A — Descubrimiento (research)

Usa Claude **Sonnet** (no Haiku — acá importa más el criterio para no meter basura a la tabla de venues que el costo) con la **web search tool nativa de la API de Anthropic** ($10 por 1.000 búsquedas + tokens — no hace falta contratar un servicio de search aparte tipo SerpAPI).

1. Busca por región: "galerías de arte en Arica", "centros culturales [ciudad]", "juntas de vecinos con actividades culturales [ciudad]", con la query generada en el idioma local de la región.
2. Por cada resultado, valida si es un espacio de arte/comunitario legítimo (no un blog viejo, no un artículo de noticias, no un resultado muerto) antes de darlo por bueno.
3. Extrae nombre, dirección, sitio web o red social, y email de contacto si está visible públicamente.
4. Clasifica `venues.category` (`art_space` / `hard_excluded` / `needs_review`) en el momento de creación — esto resuelve cómo se decide la categoría la primera vez que aparece un venue nuevo.
5. Inserta en `venues`, deduplicando contra lo ya existente (por nombre + dirección, o por dominio).

**Alcance geográfico: global desde el diseño** (aprovechando el `.com`), pero la expansión a una región nueva es una **decisión editorial explícita de los curadores**, igual que la curatoria de contenido — no algo que el modelo decida solo. La unidad de búsqueda es **región** (ciudad/estado/metro), no país: así un país grande se maneja de entrada como varias regiones (ej. "Brasil / São Paulo", "Brasil / Río de Janeiro") sin necesitar una regla aparte para cuándo dividirlo — la granularidad la deciden ustedes al agregar cada región.

**Corrección respecto de la primera versión: la expansión geográfica es semi-automática, no una decisión manual en cada paso.** Se arranca con **Chile completo** — varias regiones dentro de Chile (Santiago, Valparaíso, Concepción, Antofagasta, Arica, etc.), todas activas y en cadencia **semanal** desde el día uno, no una sola ciudad. La saturación (dejar de encontrar venues nuevos) es la condición que dispara pasar a la próxima región, siguiendo un ranking pre-calculado:

- **Ranking por población + proximidad ("modelo gravitacional"):** se precalcula una sola vez una lista global de ciudades/metros (con datos públicos de población, ej. GeoNames o World Cities Database) ordenada por `score = población / distancia_a_Santiago^k` — así una ciudad grande pero algo más lejos (ej. Buenos Aires, con población comparable a la de todo Chile) puede rankear antes que una ciudad chica pero más cercana. Resuelve exactamente el caso que diste de ejemplo, sin que haga falta una regla ad-hoc por país.
- **Expansión automática por saturación:** cuando **todas** las regiones activas quedan "saturadas" (2 corridas seguidas sin venues nuevos — ver frecuencia abajo), el sistema activa automáticamente la siguiente región (o las siguientes N) del ranking. No hace falta que ustedes decidan manualmente cada paso — el criterio editorial que se preserva es la **lista de exclusión** (ver abajo), no cada activación individual.
- **Lista de exclusión manual, aparte del ranking automático:** para casos que no quieren que se activen nunca aunque les toque el turno en el ranking, independiente de por qué (ver el punto de Corea del Norte/Rusia/China más abajo).

**Frecuencia adaptativa dentro de cada región activa:**
- Una región recién activada arranca en cadencia **semanal** durante sus primeras 4 corridas (bootstrap).
- Si acumula 2 corridas seguidas sin venues nuevos, se marca `saturated` y baja a cadencia **mensual** (deja de contar como "activa" para efectos del gatillo de expansión, aunque se le siga haciendo una pasada mensual de mantenimiento).
- Si vuelve a rendir, puede volver a `active`/semanal.

**Sobre Rusia, Corea del Norte y China — no es lo mismo un caso que el otro:**
- No tener cuentas de usuario no exime de nada — el ToS que importa acá es el del sitio que se scrapea, no el de Caldearte. Ese riesgo ya está anotado de forma general en Riesgos (más abajo) y aplica igual en cualquier país, no es específico de estos tres.
- **Corea del Norte es un caso distinto y sí conviene excluirlo directamente:** está bajo sanciones económicas integrales de EE.UU. (OFAC), y toda la infraestructura del proyecto es de proveedores estadounidenses (GitHub, Vercel, Supabase, Anthropic). Operar cualquier automatización dirigida específicamente a ese país mete a esos proveedores en una zona de cumplimiento de sanciones que no vale la pena para un proyecto gratuito — y el valor práctico de cobertura ahí es prácticamente nulo igual. Se suma directo a la lista de exclusión, sin necesidad de que llegue su turno en el ranking para decidirlo. (Esto no es asesoría legal — es una precaución operativa razonable, no un análisis de cumplimiento formal.)
- **Rusia y China no tienen ese mismo problema de sanciones integrales**, pero sí una limitación más práctica que legal: es probable que la web search tool de Anthropic tenga cobertura floja de fuentes en ruso/chino, y varios sitios ahí pueden no ser alcanzables de forma normal por temas de firewall nacional — así que aunque no se excluyan de entrada, es esperable que rindan mal cuando les toque el turno. Como el ranking por población/proximidad desde Chile los ubica bastante lejos en el orden de activación, no es una decisión que haya que tomar ahora — se revisa cuando efectivamente les toque el turno, con más contexto del que hay hoy.

**Multi-idioma:** no es una pieza técnica aparte — Claude ya opera nativamente en múltiples idiomas, no hace falta "agregar soporte". Lo que sí hay que generar por región es la query de búsqueda en el idioma local. Pendiente para cuando se activen regiones no hispanohablantes: los mails de Flujo 1 y Flujo 2 (Fase 1b) están pensados en español por ahora, van a necesitar localizarse al idioma del venue.

### Captura de eventos sin venue recurrente

Señalaste un caso real que el modelo de "venues recurrentes" no cubre bien: intervenciones puntuales en la calle o espacios no institucionales, sin un lugar que vaya a repetir — no vale la pena crear una fila persistente en `venues` para eso, pero sí vale la pena capturar el evento igual.

Cuando Proceso A encuentra un evento así durante su research (no un venue), crea directamente una fila en `events` con `venue_id` nulo y una ubicación libre (`freeform_location`), en vez de forzarlo por la tabla de venues. Igual pasa por el mismo pipeline de curatoria — los cinco ejes más el filtro de venue, este último aplicado sobre la descripción de la ubicación en vez de un venue formal.

**Límite honesto que conviene asumir de entrada:** ni el research semanal/mensual por región ni el crawl diario de venues conocidos son mecanismos confiables para este tipo de evento — por definición son de corto aviso y sin canal fijo de difusión. Lo que sí funciona para esto es el buzón público (Flujo 2, Fase 1b) y, más adelante, algún monitoreo de fuentes sociales locales (ya anotado como riesgo #1 más abajo). No conviene esperar que Proceso A cace estas intervenciones de forma consistente — va a agarrar algunas por haber corrido en el momento justo, no por diseño confiable.

### Proceso B — Recorrido (crawl, diario, el que ya estaba diseñado en Fase 1a)

Recorre la lista ya conocida de `venues` con Claude **Haiku** (barato, alto volumen, sin necesidad de la web search tool porque ya se sabe exactamente qué URL visitar), buscando inauguraciones nuevas en cada uno.

### Cómo se relacionan / secuenciación

No son secuenciales en el sentido de que B no *espera* a A en cada corrida — pero para arrancar, preferís correr Proceso A primero en vez de sembrar venues a mano, porque va a ser más completo. De acuerdo en general, con un ajuste: arrancalo acotado a **una sola región** (la de ustedes) antes de activarlo en varios países/idiomas a la vez. Así validás la calidad de la detección — falsos positivos de "esto no es realmente un espacio de arte", deduplicación, clasificación de `category` — contra un caso que pueden chequear a mano, antes de escalar a regiones donde no van a tener forma fácil de notar si el modelo se equivocó. Fase 1a pasa a depender de la primera corrida de Proceso A en esa región (en vez de una lista sembrada a mano) — mismo resultado práctico, menos trabajo manual, con el chequeo de calidad como paso intermedio antes de expandir.

## Stack técnico

- **Monorepo:** pnpm workspace liviano (`apps/web`, `apps/curator`, `packages/shared-types`, `packages/curation-policy`). Nx diferido a fase 5.
- **Frontend:** Next.js en Vercel Hobby (gratis, ojo: uso no comercial únicamente — si se monetiza, migrar a Pro $20/mes).
- **Backend/datos:** Supabase (Postgres + PostGIS + Storage + Edge Functions), tier free mientras el volumen sea bajo.
- **Automatización:** GitHub Actions (repo público, runners estándar gratis e ilimitados) para el cron del curador.
- **IA:** Claude Haiku 4.5 vía Anthropic API para curatoria de texto (barato) + llamadas de vision puntuales para QA de imagen. Posible uso de Claude Fable para copy/editorial (descripciones, captions) si se quiere una voz más literaria — a definir en fase 1/4.
- **Email:** Resend (free tier, 3000/mes) para los mails de aprobación.
- **Geocoding:** Nominatim (OpenStreetMap), gratis, 1 req/seg, cacheado por venue.
- **Diseño (opcional):** dos herramientas distintas, no una — ver nota abajo. Figma Make para explorar direcciones visuales rápido; el MCP de Figma (`figma-design-to-code` / `figma-generate-design`) para llevar eso a código real en Claude Code.

### Nota: Figma Make vs. MCP de Figma — no son la misma herramienta

Son dos productos distintos, y conviene no confundirlos antes de arrancar el diseño de la interfaz:

- **Figma Make** (`figma.com/make`) es un producto aparte: se le escribe un prompt en lenguaje natural y genera una interfaz interactiva completa (layout, componentes, interacciones), editable y respaldada por código. Es la herramienta indicada para explorar rápido 2-3 direcciones visuales "cool" antes de comprometerse a una — se usa directo en el navegador, no a través de Claude Code.
- **El MCP de Figma** (el que está disponible acá y se puede volver a agregar en Claude Code) es distinto: conecta a Claude Code con archivos de diseño de Figma, para leer contexto de diseño y generar código (`figma-design-to-code`), o para escribir contenido nativo al canvas de Figma desde código/prompt usando tokens y componentes reales del design system (`figma-generate-design`). No es "invocar Figma Make desde Claude Code" — son flujos separados.

**Workflow recomendado dado lo que pedís (interactivo, creativo, buen diseño):** explorar 2-3 direcciones en Figma Make directamente (rápido, visual, sin comprometerse a código), elegir la que más guste, y traerla a Claude Code con la skill `figma-design-to-code` para implementarla como la app Next.js real conectada a los datos de Supabase — en vez de tratar el resultado de Figma Make como el producto final.

El puente entre las dos herramientas es manual: generás/iterás en Figma Make vos mismo (Claude Code no puede operar Figma Make), copiás el link de Figma al resultado que te guste, y se lo pasás a Claude Code — de ahí en más (leer el diseño, convertirlo a código real) es automático.

**Ojo, la fidelidad no es 1:1.** `get_design_context` lee bien la estructura visual estática (layout, componentes, estilos), pero las interacciones/animaciones son una capa aparte que requiere una llamada distinta (`get_motion_context`) y la skill `figma-implement-motion` — no viene automático, hay que pedirlo explícitamente por cada elemento interactivo. Sin ese paso, la traducción a código queda fiel visualmente pero "congelada". Consuelo real: la interactividad que más importa en Caldearte (toggle de modo familiar, ranking por ciudad, blur condicional) es lógica de aplicación contra datos de Supabase, no animación de Figma — esa la construye Claude Code directo del modelo de datos, no depende de lo que traiga Figma Make. Lo que sí se puede perder es la coreografía visual (transiciones, micro-interacciones), no el comportamiento funcional del producto.

**Corrección de ambición: la visión real es 3D + interacciones de otro nivel, no solo transiciones prolijas.** Con esa ambición, la recomendación cambia: Figma y Figma Make son herramientas de canvas 2D — no están pensadas para diseñar escenas WebGL/3D reales, así que no conviene esperar que el 3D salga de ahí. El camino más directo es que Claude Code construya esa capa directo en código:

- **3D:** `react-three-fiber` (Three.js para React) + `drei` (helpers) como dependencia del `apps/web`. Estándar para esto en un stack Next.js.
- **Transiciones/coreografía:** Motion (ex-Framer Motion) para la mayoría de las interacciones, GSAP si hace falta algo más coreografiado con timelines complejos.
- **Rol de Figma Make en este escenario:** opcional, útil solo para resolver la arquitectura de información en 2D (qué va dónde en el layout general) antes de codear — no para el 3D ni las interacciones de nivel alto, esas se piden directo a Claude Code por descripción.

**Tensión honesta a nombrar, no a ignorar:** una interfaz 3D bien hecha es mucho más trabajo de ingeniería que un calendario plano — rendimiento en mobile, fallback si el dispositivo no soporta WebGL bien, tiempo de carga, accesibilidad. Choca un poco con el "se mantiene solo con mínimo mantenimiento" que quedó como criterio de éxito al principio del documento. No es una razón para no hacerlo — es un proyecto de aprendizaje y esto entra directo en esa categoría — pero conviene decidirlo a propósito, no por default. Sugerencia concreta para no perder la usabilidad del calendario (que la gente lo use para encontrar rápido "qué inauguración hay cerca hoy"): concentrar el tratamiento 3D/dramático en 1-2 momentos con peso (ej. el hero de la home, o la transición al abrir el detalle de un evento), y mantener el recorrido de scanear/filtrar el calendario en sí rápido y legible, sin que cada card individual sea una escena 3D.

**Decidido: mobile-first, no una versión adaptada de un diseño desktop.** Implicancias concretas dado todo lo anterior:

- Las escenas 3D tienen que ser livianas (poco polígono, sin post-procesado pesado) y cargar con code-splitting — que el bundle de `react-three-fiber`/Three.js no le pese al calendario en sí, que tiene que renderizar rápido y usable incluso antes de que la capa 3D termine de cargar (progressive enhancement, no bloqueante).
- Diseñar las interacciones para touch primero, no hover — no hay hover en mobile. El blur-to-reveal de contenido sensible (Capa 1) ya encaja naturalmente acá: en mobile siempre iba a ser tap para revelar, no hay que rediseñarlo.
- El toggle de "modo familiar" tiene que ser fácil de encontrar en mobile, no enterrado en un menú — tiene sentido reforzarlo porque tu caso de uso real (dárselo a tu hija) es literalmente un escenario de celular, no de desktop.
- Imágenes optimizadas para mobile: `next/image` con tamaños responsivos, WebP/AVIF — el producto es intrínsecamente visual, así que esto no es opcional.
- Nota a favor: Tailwind (ya elegido para el stack) es mobile-first por diseño — las clases sin prefijo apuntan a mobile, los breakpoints (`sm:`, `md:`, `lg:`) escalan hacia arriba desde ahí. No hay fricción extra por haber elegido Tailwind antes de esta decisión, ya viene alineado.

**Sobre Nano Banana 2:** confirmado, es una función real de generación de imágenes con IA dentro de Figma (y Figma Weave) — fotorrealista, con edición asistida (quitar fondo, reescalar, cambios de estilo). Sirve para generar assets gráficos (hero de la home, ilustraciones, los flyers de Fase 4). Un matiz honesto: no tengo confirmado si está expuesta como una operación invocable desde el MCP de Figma en Claude Code, o si es una función que se usa manualmente dentro de la app de Figma — conviene chequear la lista de herramientas del MCP una vez conectado en Claude Code antes de asumir que se puede automatizar.

## Modelo de datos (borrador)

```
regions
  id, name, country, language, lat, lng, population,
  expansion_rank (posición en el ranking global precalculado población/distancia a Santiago),
  status (not_started | active | saturated | excluded),
  exclusion_reason (nullable; ej. "sanciones OFAC" para Corea del Norte),
  search_frequency (weekly | monthly),
  consecutive_zero_yield_runs (int, para la lógica adaptativa),
  last_run_at

venues
  id, region_id (fk), name, address, lat, lng, geocoded_at, source_domain,
  contact_email (para el Flujo 1 de consulta de fecha; nullable, no todos los venues lo van a tener),
  category (art_space | hard_excluded | needs_review) -- se resuelve una vez por venue, no por evento

events
  id, venue_id (fk, nullable — nulo cuando el evento no tiene venue recurrente),
  freeform_location (texto + geocoding puntual; se usa cuando venue_id es nulo),
  title, description, artist,
  opening_datetime (fecha y hora de la inauguración, no rango de exhibición),
  opening_date_confidence (alta | baja — baja cuando la fuente solo da rango, no horario de apertura),
  medium_type (tradicional | intervencion_no_tradicional),
  sensitivity_tags (array: desnudo_erotismo | guerra_violencia | memoria_dictadura),
  source (scraped | submitted | discovered — "discovered" es lo que encuentra el Proceso A directamente, sin venue),
  image_storage_path, source_url,
  curation_status (approved | rejected | pending_review),
  curation_reasoning (interno, técnico, para los curadores),
  public_explanation (nullable; solo se llena en rechazo automático de un evento "submitted", va en el mail de respuesta),
  created_at
  -- se borra automáticamente 7 días después de opening_datetime (cron de limpieza diario)

curation_policy (versionado en el repo, no en la BD)
```

## Testing E2E (Playwright)

Dos usos distintos de Playwright en el mismo repo — no confundir: como dependencia del curador (Fase 1a, headless browser para fuentes con JS que un `fetch` simple no resuelve) y como herramienta de testing del frontend. Viven en paquetes separados del workspace.

**Dónde vive:** `e2e/` en la raíz del pnpm workspace, con su propio `playwright.config.ts`. La config usa `webServer` para levantar `apps/web` automáticamente antes de correr los tests — no hace falta levantarlo a mano.

**Datos de prueba:** no corre contra Supabase de producción ni contra datos scrapeados reales (cambian todos los días, sería flaky). Se seedea una base local (`supabase start` + script de seed) con fixtures fijos — el mismo dataset que ya se usó en el mockup interactivo (`caldearte-mockup.jsx`): una ciudad con eventos variados, una ciudad vacía, un evento marcado sensible. Reusar esos fixtures directo ahorra inventarlos de nuevo.

**Local:** `npx playwright test` desde la raíz, con Supabase local corriendo y el seed aplicado.

**CI/CD:** workflow de GitHub Actions **separado** del cron del curador — `.github/workflows/e2e.yml`, no el mismo archivo que el cron diario. Se dispara en cada pull request, no en el schedule. Levanta Supabase local, corre el seed, build+start del frontend, corre Playwright, sube el reporte HTML como artifact si falla algo. Encaja directo con la regla ya definida en el `CLAUDE.md` (ver checklist de setup): Claude Code abre PRs pero no mergea solo — este workflow es el gate objetivo antes de tu revisión, no la reemplaza.

**Qué testear primero, no todo de una:**
1. El calendario carga y muestra los eventos de "hoy" para la ciudad por defecto.
2. Cambiar entre tabs (hoy/semana/mes/año) cambia lo que se muestra.
3. Una ciudad sin eventos muestra el mensaje vacío + CTA de "contanos".
4. El toggle de "modo familiar" oculta los eventos con `sensitivity_tags`.
5. La cantidad de columnas responde al ancho real del viewport (1/2/3), probado con distintos tamaños de viewport de Playwright. El más valioso para arrancar: la lógica usa `ResizeObserver` en vez de breakpoints estándar de Tailwind, fácil de romper sin darse cuenta en un refactor y difícil de notar a simple vista.

Se expande en fases posteriores — Fase 1b suma un test del flujo de aprobación por mail (visitar la URL firmada del botón "incluir" y verificar que el estado cambia en la base).

## Secrets / credenciales necesarias

| Secret | Dónde vive | Nota |
|---|---|---|
| `ANTHROPIC_API_KEY` | GitHub Actions secret | nunca en código, nunca en el frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions secret | solo lo usa el curador; jamás exponer al browser |
| `SUPABASE_ANON_KEY` | Variable pública de Next.js | es la única key que va al frontend |
| `RESEND_API_KEY` | Supabase Edge Function secret | para disparar los mails de aprobación |
| `APPROVAL_TOKEN_SECRET` | GitHub Actions / Edge Function secret | firma los links de un solo uso de los botones del mail |
| `RESEND_WEBHOOK_SECRET` | Supabase Edge Function secret | verifica que los webhooks de email entrante (consulta de fecha, buzón público) vienen realmente de Resend |
| `META_APP_ID` / `META_APP_SECRET` | fase 4, GitHub Actions secret | recién al llegar a fase 4 |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | fase 4, GitHub Actions secret | recién al llegar a fase 4 |

Nota de seguridad ya discutida: en repos públicos, los secrets de Actions no se exponen a workflows disparados por PRs de forks (salvo que se use `pull_request_target`, evitarlo).

## Estimación de costos

- **Fase 1-3 (bajo tráfico):** ~$0-5/mes. GitHub Actions gratis, Supabase free tier, Vercel Hobby gratis, Resend free tier. El único costo real es Claude API (~$1-3/mes con Haiku + prompt caching a este volumen).
- **Si crece o se monetiza:** piso de ~$45/mes (Supabase Pro $25 + Vercel Pro $20) más dominio propio (~$12/año) y volumen de email.

## Herramientas / MCP relevantes para la etapa de construcción

- **GitHub MCP** — no conectado todavía (requiere autorización tuya). Una vez conectado, permite crear archivos/commits/PRs directo en el repo real en vez de copiar/pegar código.
- **Supabase MCP** — disponible en el registro, no conectado. Conectarlo permite crear el proyecto, correr migraciones y armar tablas desde el chat en vez de SQL manual.
- **Figma MCP** — ya la tenés disponible. Útil en fase 1/2 para mockear las cards del calendario y el layout "on the fly" por ciudad antes de codearlo.
- **Créditos de Fable** — disponibles; candidato natural para copy editorial (descripciones de eventos, voz de "Sobre la curatoria", captions de fase 4) si se quiere una voz más cuidada que la de Haiku.
- **Claude Code** — para el desarrollo del repo dedicado en sí, usando este documento como contexto inicial.

### Setup local necesario para que Claude Code pueda trabajar

**Runtimes y CLIs:**

- Node.js LTS + pnpm (`corepack enable` o `npm i -g pnpm`).
- Docker Desktop (o alternativa tipo Colima/OrbStack) — lo necesitan tanto el Supabase CLI (para levantar Postgres local) como `act` (para correr GitHub Actions en local).
- Supabase CLI (`brew install supabase/tap/supabase` o vía npm) — para `supabase init`, `supabase start` (Postgres + PostGIS local), `supabase db push`, `supabase gen types typescript`.
- GitHub CLI `gh`, autenticado (`gh auth login`) — para manejar secrets del repo desde terminal (`gh secret set ANTHROPIC_API_KEY`) sin ir a la UI cada vez.
- Vercel CLI (`npm i -g vercel`) — `vercel link`, `vercel env pull` para traer las env vars del proyecto a local.
- `act` (opcional pero recomendado) — corre el workflow de GitHub Actions del curador en Docker local, para probarlo antes de pushear y esperar el cron real.
- `ngrok` (o Cloudflare Tunnel) — necesario para probar en local los webhooks entrantes de Resend (consulta de fecha, buzón público), que necesitan una URL pública apuntando a tu `localhost`.
- Playwright, como dependencia del proyecto (no CLI global) — varias fuentes (sobre todo centros sociales/juntas de vecinos) van a ser páginas renderizadas por JS donde un `fetch` simple no alcanza. Corre igual de bien en local que en los runners de GitHub Actions.

**MCP a agregar en Claude Code** (configuración aparte de esta sesión de Cowork — no se hereda):

- Supabase MCP — mismo conector visto acá, hay que conectarlo de nuevo en Claude Code (`claude mcp add`) para poder crear tablas/migraciones por lenguaje natural desde ahí.
- GitHub MCP — opcional; Claude Code ya opera git/gh por shell directamente, el MCP suma operaciones más ricas de PRs/issues si las querés en lenguaje natural.
- Figma MCP — ya la tenés en esta sesión de Cowork, pero es configuración aparte si la querés disponible también en Claude Code (útil en fase 1/2 para mockear las cards).

**Secrets/env locales** (en `.env.local`, nunca commiteado — sumar a `.gitignore` desde el primer commit):

- `ANTHROPIC_API_KEY` — para probar el curador y los prompts localmente antes de correr el cron real en Actions.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — las de instancia local (`supabase start` las genera), distintas de las de producción.
- `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET`.
- `APPROVAL_TOKEN_SECRET`.

## Política de curatoria — versión operacional (v2, corregida por los curadores)

Corrección de fondo respecto de la v1: no importa si el tratamiento tiene distancia crítica desde lo estético o es "documental/neutral". La estética es producto de la ética, y si el contenido no transmite valores alineados con la curatoria, se excluye — sin términos medios. La regla pasa a ser **default-excluir**: todo contenido con imaginería o temática religiosa, bélica o de extrema derecha se excluye salvo que el evento tome una postura crítica **explícita e inequívoca** en contra de esa institución/ideología/conflicto específico. "Medias tintas" (documentación neutral, "explorar", "reflexionar sobre", sin toma de postura clara) no alcanzan — se excluyen igual que el contenido afirmativo.

Se agrega un cuarto eje: **pseudociencia y superstición** (tarot, esoterismo, sanación energética y similares), también default-excluido. El budismo se trata caso a caso, con criterio más permisivo que el cristianismo/judaísmo, pero no automáticamente incluido.

### Ejemplos de clasificación por eje (revisados)

| Título del evento | Descripción corta | Eje | Decisión | Por qué |
|---|---|---|---|---|
| "La Anunciación en el Barroco americano" | Muestra del museo X sobre iconografía mariana en la pintura colonial, con foco en técnica y contexto histórico. | Religión | **EXCLUIR** | Imaginería cristiana explícita. El tratamiento histórico-artístico no alcanza — no es crítica a la Iglesia como institución. |
| "Noche de alabanza y arte para Cristo" | Iglesia Y invita a una velada de pintura en vivo, testimonios y oración comunitaria. | Religión | **EXCLUIR** | Convocatoria evangelizadora explícita. |
| "Iglesia S.A.: instalación crítica sobre poder eclesiástico y dinero" | Instalación que denuncia el manejo económico de instituciones religiosas, con curaduría explícitamente crítica. | Religión | **INCLUIR** | Postura explícita en contra de la Iglesia como institución, no exhibición de fe ni de su imaginería. |
| "Ojos en la trinchera: fotoperiodismo de guerra 1936-1945" | Retrospectiva de corresponsales gráficos, memoria histórica y archivo documental, sin declaración de postura. | Guerra/violencia | **EXCLUIR** | Documentación/memoria "neutral" no alcanza — falta postura crítica explícita contra la guerra o el período. |
| "Después de la ocupación: arte y memoria en Palestina" | Muestra con declaración curatorial explícita de denuncia de la ocupación y sus consecuencias. | Guerra/violencia | **INCLUIR** | Postura explícita de denuncia/crítica, no documentación neutral. |
| "Homenaje visual a la victoria: la gesta heroica" | Muestra que celebra glorias militares de un bando en un conflicto, con tono conmemorativo/exaltador. | Guerra/violencia | **EXCLUIR** | Glorificación explícita. |
| "Estéticas del fascismo: arte, propaganda y advertencia" | Muestra que exhibe simbología de regímenes autoritarios con textos de "contextualización", sin declarar rechazo explícito. | Extrema derecha | **EXCLUIR** | Sin una postura inequívocamente anti-fascista declarada, se excluye — "contextualizar" o "analizar" sin rechazo explícito no alcanza. |
| "Encuentro de arte identitario nacional" | Exposición con estética de un movimiento de extrema derecha reconocido, sin distancia crítica, llamado a "recuperar valores". | Extrema derecha | **EXCLUIR** | Promueve la ideología sin marco crítico. |
| "Vía Crucis pictórico: retrospectiva de [pintor religioso]" | Retrospectiva de un artista consagrado, con obra de temática religiosa cristiana entre otras etapas de su carrera. | Religión | **EXCLUIR** | Imaginería religiosa explícita, aunque sea retrospectiva reconocida — se excluye igual. |
| "Vigilia y bendición de imágenes previa a la peregrinación" | Espacio parroquial organiza exhibición de imaginería religiosa como parte de un ritual devocional. | Religión | **EXCLUIR** | Acto de culto. |
| "Tarot, cartas y sanación energética: feria de expositores" | Feria de expositores de tarot, lectura energética y prácticas esotéricas. | Pseudociencia/superstición | **EXCLUIR** | Contenido esotérico/pseudocientífico sin marco crítico. |

### Filtro por tipo de venue (independiente del contenido)

Se excluye automáticamente cualquier evento cuyo venue sea: una iglesia, templo o sede de cualquier culto religioso; la sede de un partido político de derecha o extrema derecha; o, en general, cualquier establecimiento cuyo perfil institucional no se alinee con los valores de la curatoria. Este filtro es independiente del filtro de contenido y tiene prioridad sobre él: aunque el evento en sí tuviera una postura crítica explícita (ej. la instalación "Iglesia S.A." del ejemplo anterior), si el venue donde se inaugura es literalmente un templo o una sede partidaria, se excluye igual — el objetivo del calendario no es dirigir visitas a esas instituciones.

Las dos primeras categorías (templos, sedes partidarias) son enumerables y se pueden auto-excluir con alta confianza a partir del nombre/dirección del venue. La tercera ("no se alinea con nuestros valores") no es enumerable de antemano, así que no se le pide al modelo que la decida solo: si el venue no es reconocible como espacio de arte/comunitario legítimo y tampoco encaja claramente en las dos categorías duras, el caso se escala a revisión humana en vez de auto-excluir o auto-incluir.

**`art_space` incluye explícitamente, y con entusiasmo, más que museos y galerías tradicionales:** intervenciones/arte en espacios urbanos y la calle, centros culturales, centros sociales y juntas de vecinos. Es tan válido un mural o una intervención callejera como una inauguración en una galería consagrada — el filtro de venue es para excluir instituciones alineadas con lo que se rechaza en la política de contenido (templos, sedes partidarias), no para restringir a circuitos formales de arte.

Implicancia de datos: conviene agregar a la tabla `venues` un campo de clasificación (ej. `art_space` / `hard_excluded` / `needs_review`) que se resuelve una sola vez por venue —igual que el geocoding—, no evento por evento.

### Eje 5: agresión física y sexual explícita (nuevo, distinto a los otros cuatro)

Se excluye cualquier evento cuyo contenido visual muestre agresión física o sexual de forma **explícita** (imágenes gráficas de violencia, agresión sexual, gore) — a diferencia de los otros cuatro ejes, acá **la intención de denuncia no habilita la inclusión si la imagen es explícita**. La denuncia sí se incluye cuando se aborda de forma textual, temática o simbólica, sin imaginería explícita (ej. una muestra sobre violencia de género con fotografía documental no gráfica, testimonios u obra simbólica).

Aclaración de scope importante para no sobre-excluir: este eje es sobre **agresión/violencia**, no sobre sexualidad o desnudo en general. Desnudo artístico, erotismo o sexualidad no violenta no caen en este eje — son parte normal del repertorio de artes visuales y no se excluyen por este criterio. Vale la pena dejar esto explícito en el prompt para que el modelo no confunda "contenido sexual" en general con "agresión sexual explícita".

Implicancia de arquitectura: este eje es el caso de uso más claro para la llamada de vision que ya estaba prevista como hardening opcional de Fase 3 — ahí es donde efectivamente se puede evaluar si la imagen elegida es gráfica, no solo si "es arte real". Conviene adelantar ese chequeo puntual a Fase 1 para este eje específico (no para todo el control de calidad de imagen), porque acá el costo de un falso negativo —mostrar una imagen explícita en el calendario— es más alto que en los otros ejes, que se basan solo en texto.

### Instrucción operacional para el system prompt de Claude Haiku

> Aplicá una política de exclusión por defecto sobre cuatro ejes: (1) religión — imaginería o temática religiosa explícita, especialmente cristiana o judía; el budismo se evalúa caso a caso con criterio más permisivo, pero no se incluye automáticamente; (2) guerra o violencia extrema; (3) extrema derecha o ideologías autoritarias; (4) pseudociencia y superstición (tarot, esoterismo, sanación energética y similares). Para cualquiera de estos cuatro ejes, la decisión por defecto es **EXCLUIR**. La única excepción es cuando el evento declara una postura crítica **explícita e inequívoca** en contra de esa institución, ideología o conflicto específico — por ejemplo, una instalación que denuncia explícitamente el poder económico de la Iglesia, o una muestra con declaración curatorial explícita de denuncia de una ocupación o dictadura. No alcanza con "explorar", "reflexionar sobre", "contextualizar", "documentar" o mostrar distancia estética/curatorial ambigua — sin una postura de rechazo explícita y declarada, el evento se excluye. No hay términos medios: o el evento critica explícitamente la institución/ideología/conflicto, o se excluye, sin importar la calidad artística o el prestigio del venue.
>
> Aplicá además un quinto eje, independiente de la lógica anterior: excluí cualquier evento cuya imagen muestre agresión física o sexual de forma explícita (violencia gráfica, agresión sexual, gore), sin importar si el evento tiene intención de denuncia — la denuncia solo habilita la inclusión cuando se expresa de forma textual, temática o simbólica, no con imaginería explícita. Este eje es sobre agresión/violencia explícita, no sobre sexualidad o desnudo en general: desnudo artístico, erotismo o sexualidad no violenta no se excluyen por este criterio.

### Señales que disparan escalamiento humano obligatorio

- El evento parece cumplir con la excepción (postura crítica explícita) pero el texto no es suficientemente claro para confirmar que el rechazo es inequívoco y no solo "contextualización" o distancia estética.
- Falta de contexto suficiente: descripción muy breve, sin imagen, o texto curatorial que no permite determinar si hay postura explícita.
- El evento mezcla ejes (ej. crítica explícita a una dictadura que a la vez usa simbología religiosa) y no es evidente cómo pesa cada uno.
- Casos de budismo, u otras tradiciones no cristianas/judías, donde no está claro si aplica el criterio más permisivo.
- Venue no reconocible como espacio de arte establecido y que tampoco encaja claramente en las categorías duras de exclusión (templo, sede partidaria) — no se auto-decide, se escala.
- No queda claro si una imagen es "explícita" o es tratamiento artístico no gráfico de un tema de violencia/agresión — se escala en vez de decidir con baja confianza, dado el costo alto de un falso negativo en este eje.
- Cualquier caso donde el propio modelo detecte baja confianza en su clasificación — debe escalar en vez de forzar una decisión binaria.

## Detección de ciudad del usuario — decisión

**Combinación elegida: geolocalización por IP nativa de Vercel como valor por defecto silencioso (SSR) + selector manual de ciudad como override persistido en cookie. La Browser Geolocation API queda como mejora opcional, no como default.**

Hallazgo clave: Vercel inyecta headers de geolocalización por IP (`x-vercel-ip-city`, país, región, lat/lng aproximados) en todas las requests a Vercel Functions/Edge Middleware, gratis, sin llamada a servicio externo, y disponibles en SSR — el paquete `@vercel/functions` los expone vía `geolocation(request)`. Esto hace innecesario contratar un servicio de IP geolocation de terceros: los evaluados (ipapi.co, ipinfo.io) o no son aptos para producción en su tier gratuito, o su plan gratuito solo da nivel país (no ciudad). Limitación a tener presente: no funciona en `localhost` en desarrollo.

Flujo propuesto:

1. Middleware de Next.js lee la ciudad por IP en cada request; si no hay cookie `caldearte_city` todavía, la setea con ese valor — permite ordenar eventos por distancia+tiempo ya en el primer render, sin JS ni permisos.
2. Selector manual de ciudad, siempre visible en el header, sobrescribe la cookie y manda sobre la IP en visitas futuras — cubre los casos donde la IP falla (VPN, red móvil, dev local) y da control al usuario.
3. Browser Geolocation API como acción opcional ("Usar mi ubicación exacta"), no automática — pedir permiso de entrada en la primera visita es fricción injustificada para un calendario de arte y buena parte de los usuarios la rechaza.
4. Fallback sin cookie/header/elección: ciudad por defecto razonable (ej. Santiago) o lista sin ordenar con banner invitando a elegir ciudad.
5. Una línea en la política de privacidad explicando la inferencia de ciudad por IP, sin asociarla a cuenta ni guardarla más allá de la cookie de preferencia.

Fuentes: [Vercel — geolocation IP headers](https://vercel.com/kb/guide/geo-ip-headers-geolocation-vercel-functions), [ipapi.co pricing](https://ipapi.co/pricing/), [IPinfo pricing](https://ipinfo.io/pricing), [IPinfo Lite](https://ipinfo.io/lite).

## Riesgos / supuestos a validar antes de escribir código

1. No todas las fuentes van a tener RSS/calendario público — algunas requieren scraping directo, con el riesgo de ToS que eso implica (especial atención con redes sociales). Este riesgo se acentúa porque el scope incluye deliberadamente centros sociales, juntas de vecinos e intervenciones urbanas: es poco probable que tengan web propia o RSS, y es muy probable que su única difusión viva en Instagram/Facebook de la organización o en grupos de WhatsApp — hay que mapear esto en fase 1 y no asumir que el flujo de museos/galerías (con web institucional) representa al resto de las fuentes.
2. Vercel Hobby prohíbe uso comercial — si en algún momento se decide monetizar, hay que migrar de plan antes, no después.
3. Fase 4 (redes sociales) depende de tener contenido real funcionando primero — no tiene sentido mandar a review con una demo vacía.
4. La política de curatoria está definida con ejemplos y prompt, pero no probada contra casos reales todavía — conviene correr un lote de prueba manual antes de confiar en la clasificación automática.

## Próximo paso sugerido

Pasar este documento como contexto a Claude Code y arrancar por la Fase 1: estructura del pnpm workspace + schema de Supabase + primer prototipo de scraper contra una fuente real.
