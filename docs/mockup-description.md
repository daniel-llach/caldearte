# Caldearte — descripción del mockup de interfaz

> Documento de contexto sobre `caldearte-mockup.jsx`, un prototipo interactivo (React + Tailwind) explorado en Cowork antes de la construcción real. Pensado para pasarlo junto con `caldearte-project-brief.md` como contexto inicial en Claude Code.

## Qué es y qué no es

Es un prototipo de **comportamiento e interacción**, no el componente final. Sirve para validar decisiones de layout, navegación y estados antes de escribir la app real en Next.js. Varias cosas están simplificadas a propósito porque son mockup, no producto:

- Las imágenes de obras son bloques de color planos, no fotos reales.
- Los datos (`CITIES`) están hardcodeados en el componente, no vienen de Supabase.
- "Modo familiar" y la ciudad elegida no persisten en cookie — se resetean al recargar.
- No hay geolocalización real ni PostGIS — el ranking por proximidad/tiempo definido en el brief principal todavía no está implementado acá, esto es solo la lista agrupada por fecha.

## Estructura de la interfaz

**Header:** logo "CALDEARTE" en mayúsculas, tipografía serif de alto contraste. Ícono de menú hamburguesa a la derecha, abre el drawer.

**Selector de ciudad:** pin + nombre de ciudad + chevron (íconos de `lucide-react`, no emoji). Al tocar, baja un panel desde arriba (`fixed`, no `absolute` — importante, ver nota técnica más abajo) con la lista de ciudades disponibles.

**Filtros de tiempo:** cuatro tabs — hoy, esta semana, este mes, este año. Los primeros tres agrupan los eventos por día exacto (fecha + día de la semana como encabezado). El tab "este año" agrupa por mes en vez de por día — junta todas las miniaturas de un mismo mes bajo un solo encabezado ("julio 2026"), sin subdividir por fecha.

**Grilla de días/meses:** responsive por columnas — 1 columna en mobile, 2 en tablet, 3 en desktop. El corte de columnas se calcula midiendo el ancho real del contenedor con `ResizeObserver` en vez de depender de los breakpoints de Tailwind (`sm:`/`md:`/`lg:`), porque esos breakpoints reaccionan al ancho del viewport del navegador, no al ancho del contenedor donde vive el componente — en un layout con paneles/columnas eso da resultados incorrectos. Recomendación para Claude Code: mantener este enfoque de medir el contenedor si el layout real también puede vivir en distintos anchos de columna, no asumir que alcanza con breakpoints de Tailwind.

**Miniaturas:** solo imagen, sin título ni descripción superpuesta — decisión de diseño explícita. La única excepción es la etiqueta "sensible" en la esquina, para eventos con `sensitivity_tags`, porque es información de seguridad, no decorativa.

**Vista de detalle:** al tocar una miniatura — en mobile/tablet reemplaza la pantalla completa con transición deslizante desde la derecha y flecha para volver; en desktop (3 columnas) se muestra como panel fijo al costado, siempre visible, sin transición ni overlay. Es el único momento con tratamiento de interacción "premium" acordado — el resto del recorrido se mantiene rápido y sin fricción.

**Drawer de menú (desde la derecha):** dos vistas — el menú con el link a "Curatoria" (con el copy ya redactado, ver `caldearte-figma-make-prompt.md`) y el switch de "modo familiar"; y la vista de curatoria en sí, con flecha para volver al menú.

**Estados vacíos, lógica en cascada:** si el período elegido (hoy/semana/mes/año) no tiene eventos, se busca el próximo evento futuro en todo el dataset de esa ciudad:
- Si existe: "No hay inauguraciones [período] en [ciudad]. La próxima es el [fecha] — [título]" + botón para ir a esa fecha.
- Si no existe ninguno (ciudad sin eventos todavía, ej. una región recién agregada por el Proceso A sin resultados aún): "Todavía no tenemos inauguraciones para [ciudad]. ¿Conocés una que deberíamos sumar?" + botón de contacto — esto debería conectar con el buzón público (Flujo 2) del backend.

## Notas técnicas para Claude Code

- Los paneles superpuestos (selector de ciudad, drawer de menú) usan `position: fixed`, no `absolute` — con `absolute` quedaban acotados al alto del contenido de la tarjeta en vez de ocupar el viewport completo. Si se migra este patrón a producción, confirmar que el layout real de Next.js no tenga otro contenedor con overflow que vuelva a acotar el `fixed`.
- En el sandbox de artefactos de Cowork, los colores arbitrarios de Tailwind (`bg-[#FBFAF6]`) no funcionan porque no hay compilador de Tailwind ahí, solo clases predefinidas — por eso el mockup usa `bg-stone-50` en vez de un hex custom. **Esto es una limitación específica del sandbox de artefactos, no de un proyecto Next.js real con Tailwind compilado** — en Claude Code, con build real, si se prefiere un tono exacto fuera de la paleta default, se puede definir como color custom en la config de Tailwind sin problema. No hace falta arrastrar esta restricción a la app real.
- Íconos: `lucide-react` (pin de ubicación, chevron). El resto de los íconos del mockup (☰, ←, ✕) quedaron como texto plano — vale la pena unificar todo a `lucide-react` en la implementación real por consistencia visual.

## Paleta y tipografía usadas en el mockup

- Fondo principal: `stone-50` (blanco cálido, no blanco puro, no negro) — alineado con la referencia de "white cube" de galería discutida en el brief principal.
- Texto: escala de grises `stone-400` a `stone-900`.
- Bloques de "obra" (placeholder de imagen): colores planos de la paleta core de Tailwind (`orange-200`, `purple-200`, `green-200`, etc.) — reemplazar por las imágenes reales rehosteadas en Supabase Storage.
- Logo: `font-serif font-bold`, mayúsculas, tracking amplio — dirección tipográfica tipo identidad de museo de arte moderno, ya discutida en el brief.
