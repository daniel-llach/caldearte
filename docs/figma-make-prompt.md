# Prompt para Figma Make — Caldearte

Copiá todo el texto de abajo (desde "Estoy diseñando..." hasta el final) y pegalo directo en Figma Make.

---

Estoy diseñando la interfaz de **Caldearte**, un calendario público y gratuito de inauguraciones de arte — el momento único en que se cruzan artista, obra y espectadores, no la muestra completa. Cubre desde museos y galerías consagradas hasta centros culturales, centros sociales, juntas de vecinos e intervenciones artísticas en la calle. Es un proyecto curado con un punto de vista propio, no un agregador neutral.

**Copy de curatoria** (usar textualmente en la sección/página "Sobre la curatoria"):

"Caldearte no es un agregador neutral. Elegimos con criterio qué inauguraciones mostramos, guiados por un compromiso con el arte como espacio de encuentro, reflexión y comunidad — no como vehículo de proselitismo religioso, glorificación de la violencia o plataforma de discursos de odio. Priorizamos el arte que abre preguntas: memoria histórica, crítica social, denuncia, experimentación — sea en un museo consagrado o en una intervención callejera de barrio. Usamos inteligencia artificial para ayudarnos a rastrear y evaluar inauguraciones todos los días, siempre bajo revisión humana en los casos donde el criterio no es obvio. Si creés que nos equivocamos con un evento, o querés contarnos de una inauguración que no encontramos, escribinos — leemos cada mensaje."

**Dirección visual:** el logo es la palabra "CALDEARTE" en mayúsculas, con una tipografía de corte de museo de arte moderno — pensá en identidades de museos como referencia: o una serif de alto contraste dramático (tipo Bodoni), o una grotesca geométrica minimalista en mayúsculas con tracking amplio. Resto de la interfaz: limpia, con espacio en blanco generoso, foco total en las imágenes de las obras — la tipografía y el layout deben quedar en segundo plano frente al arte. Diseño **mobile-first**.

**Estructura del header (fijo arriba):**
- Izquierda: logotipo "CALDEARTE".
- Centro: selector de mes con flechas, formato "< JUL 2026 >" — flecha izquierda retrocede un mes, flecha derecha avanza un mes.
- Derecha: ícono de menú hamburguesa que abre un panel/drawer deslizando desde el borde derecho de la pantalla. Ese panel contiene: un link a "Curatoria" (lleva a la página con el copy de arriba) y un switch/toggle llamado "Modo familiar" (oculta contenido con advertencia de sensibilidad cuando está activado).

**Estructura del main, debajo del header — vista de calendario:**
Una fila horizontal de tarjetas de "día", una por cada día con inauguraciones, con efecto de stack/profundidad: la primera tarjeta (el día más próximo) es más grande que las demás y se ve casi desde arriba, en una perspectiva ligeramente cenital; las tarjetas siguientes se ven más chicas y detrás, como una pila de tarjetas vista con algo de profundidad 3D, no completamente plana.

Cada tarjeta de día está compuesta por un collage con una imagen de cada obra que inaugura ese día (grid de fotos dentro de la misma tarjeta, no una sola imagen). Fuera de la tarjeta, debajo o al lado: el número del día en grande y el nombre del día de la semana.

**Vista de detalle al tocar una tarjeta de día:**
Se accede a una lista de tarjetas individuales, una por cada inauguración de ese día, cada una resaltando su imagen principal en grande (tratamiento tipo hero por card), con título de la obra/muestra, artista, venue y horario. Si el evento tiene advertencia de contenido sensible, la imagen aparece difuminada con un overlay ("Contenido sensible — tocá para ver") salvo que el modo familiar esté activo, en cuyo caso ese evento no se muestra en la lista.

**Momento de interacción destacado:** la transición entre la vista de calendario (stack de días) y la vista de detalle de un día es el momento de mayor "wow" de toda la interfaz — pensá en la tarjeta de día expandiéndose/desplegándose con profundidad hacia la vista de detalle, no un cambio de pantalla plano. El resto del recorrido (navegar meses, escanear el stack de días) debe sentirse rápido y legible, sin fricción — el efecto dramático se concentra en ese único momento de transición, no en cada interacción.

**Contenido de ejemplo para poblar el diseño** (usar datos ficticios pero realistas, en español, ambientados en julio de 2026):
- Día 10 (hoy): 3 inauguraciones — "Trazos del desierto" (pintura, Galería Cerro Norte, Arica, 19:00hs), "Cuerpo y ruido" (performance callejera, Plaza Colón, Arica, 20:00hs, con advertencia de contenido sensible por temática de violencia/denuncia), "Metales" (escultura, Centro Cultural Municipal, Arica, 19:30hs).
- Día 12: 1 inauguración — "Retratos de barrio" (fotografía documental, Junta de Vecinos San Miguel, Antofagasta, 18:30hs).
- Día 15: 2 inauguraciones — "Grabado en movimiento" (grabado, Galería del Puerto, Valparaíso, 19:00hs), "Intervención Bandera 300" (graffiti/happening, calle Bandera, Santiago, 21:00hs).

**Notas finales:** priorizá que la vista de calendario sea rápida de escanear en mobile — el efecto 3D/perspectiva del stack de tarjetas no debe hacer lenta la carga ni dificultar tocar la tarjeta correcta en una pantalla chica.
