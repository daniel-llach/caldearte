// Minimal i18n scaffold — only es-CL exists today (Chile-only for now, per
// an earlier decision on sensitivity copy). Add further locale files
// alongside this one and a lookup keyed by locale if/when the project
// expands beyond Chile — no lookup mechanism exists yet since there's only
// ever one locale to resolve to.
//
// IMPORTANT for the next locale file (es-AR.ts, es-CO.ts, ...): write it in
// that country's actual dialect and modismos — verified, not assumed by
// copying this file's phrasing. Real bug (found 2026-07-19): several
// strings here were written in Rioplatense voseo ("Elegí", "Buscá",
// "Contanos", "Escribinos") instead of the neutral Chilean "tú" register
// used everywhere else in the site — an easy mistake to make when Spanish
// variants sound superficially similar, but "es-CL" specifically promises
// Chilean Spanish. Don't let that happen to the next locale: get a native
// speaker's review (or equivalent verification) of the target country's
// real conjugation/imperative forms before shipping, not after.

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

// "Muestra lo que hay": a zero count carries no information worth reading
// (nobody wants "0 inauguraciones y 2 exposiciones"), so it's dropped
// entirely rather than shown as a zero. When both are zero, callers decide
// their own fallback — this returns "" so the caller can detect that case.
function countsPhrase(inauguracionesCount: number, exposCount: number, joiner: string, abbreviate = false): string {
  const parts: string[] = [];
  if (inauguracionesCount > 0) {
    const word = abbreviate ? pluralize(inauguracionesCount, "inau", "inaus") : pluralize(inauguracionesCount, "inauguración", "inauguraciones");
    parts.push(`${inauguracionesCount} ${word}`);
  }
  if (exposCount > 0) {
    const word = abbreviate ? pluralize(exposCount, "expo", "expos") : pluralize(exposCount, "exposición", "exposiciones");
    parts.push(`${exposCount} ${word}`);
  }
  return parts.join(joiner);
}

export const esCL = {
  appName: "CALDEARTE",
  appDescription: "Calendario de inauguraciones de arte en Chile.",
  chooseCity: "Elige tu ciudad",
  cityPickerAriaLabel: "Selector de ciudad",
  closeCityPicker: "Cerrar selector de ciudad",
  citySearchPlaceholder: "Buscar comuna o región...",
  citySearchAriaLabel: "Buscar comuna o región",
  noCityResults: "No encontramos resultados.",
  cityPickerHints: {
    navigate: "↑↓ navegar",
    select: "↵ seleccionar",
    close: "esc cerrar",
  },
  menu: "Menú",
  curatoria: "Curatoria",
  familyMode: "Modo familiar",
  otherCity: "Otro",
  explorar: "Explorar",

  // Global search panel — scope is every active/upcoming event in every
  // comuna, not just what's currently on screen (see SearchPanel.tsx).
  searchAriaLabel: "Buscar eventos",
  closeSearch: "Cerrar búsqueda",
  searchTitle: "Buscar eventos",
  searchPlaceholder: "Buscar por título, artista o lugar...",
  searchHint: "Busca entre todos los eventos vigentes y próximos, en cualquier comuna.",
  noSearchResults: "No encontramos eventos con ese término.",

  // abbreviate: true shortens "inauguración(es)"/"exposición(es)" to
  // "inau(s)"/"expo(s)" — used on mobile, where the header has less
  // horizontal room.
  headerSummary: (inauguracionesCount: number, exposCount: number, abbreviate = false) => {
    const phrase = countsPhrase(inauguracionesCount, exposCount, " y ", abbreviate);
    return phrase ? `${phrase} que visitar en` : "Descubre el arte que hay en";
  },
  // Appended after the city-pill button in the header's summary line —
  // "hoy" for Día mode, "esta semana" for Semana mode.
  todaySuffix: "hoy",
  thisWeekSuffix: "esta semana",
  // The Hoy/Semanal toggle INSIDE the city picker panel — capitalized,
  // distinct from the lowercase inline suffixes above (which read as part
  // of a sentence: "...en Santiago hoy").
  windowModeDay: "Hoy",
  windowModeWeek: "Semanal",

  sectionInauguraciones: "INAUGURACIONES",
  sectionExposActuales: "EXPOS ACTUALES",
  sectionArteEnTodasPartes: "ARTE EN TODAS PARTES",

  // Appended after the opening date on an InauguracionCard when the source
  // confirms a date but never an hour (see EventRecord.openingTimeConfirmed).
  consultHourWithVenue: "consulta la hora con el lugar",

  // Aria-label for the "how to get there" icon on an event card — opens
  // Google Maps directions in a new tab.
  directionsAriaLabel: (venue: string) => `Cómo llegar a ${venue}`,
  // Mobile-only: the directions/link icons collapse into a single "more
  // options" (kebab) button, which opens a small menu with these two
  // labeled entries instead.
  cardMoreOptionsAriaLabel: "Más opciones",
  cardMenuDirections: "Cómo llegar",
  cardMenuSource: "Ver fuente original",
  // Inauguraciones only — see EventCardBase's gating on variant + openingDatetime.
  cardMenuAddToCalendar: "Agregar a mi calendario",

  archiveLink: "Revisa expos anteriores",
  archiveMonthTitle: (label: string) => `Expos anteriores — ${label}`,
  archiveMonthDescription: (count: number, label: string, sample: string) =>
    count > 0
      ? `${count} ${pluralize(count, "exposición", "exposiciones")} que abrieron en Chile en ${label}: ${sample}${count > 5 ? "…" : "."}`
      : `Exposiciones que abrieron en Chile en ${label}.`,
  archiveSearchPlaceholder: "Buscar por título, artista o lugar...",
  archiveFiltersAriaLabel: "Filtros",
  archiveFilters: {
    title: "Filtros",
    desde: "Desde",
    hasta: "Hasta",
    lugar: "Lugar",
    comuna: "Comuna",
    comunaAll: "Todas",
    clear: "Limpiar filtros",
  },
  archiveNoResults: "No encontramos expos con esos filtros este mes.",
  archiveResultsCount: (n: number) => `${n} ${pluralize(n, "resultado", "resultados")}`,
  archivePrevMonth: "← Mes anterior",
  archiveNextMonth: "Mes siguiente →",

  cityStats: (inauguracionesCount: number, exposCount: number) => countsPhrase(inauguracionesCount, exposCount, " · "),

  tellUs: "Cuéntanos →",
  doYouKnowOne: "¿Conoces una que deberíamos sumar?",
  // Shown when a section (inauguraciones or expos actuales) has nothing in
  // the current window, but there's a real upcoming event to point to
  // instead. `suffix` is todaySuffix/thisWeekSuffix, so both modes share
  // one function instead of forking the copy.
  emptyWithNextEvent: (cityName: string, suffix: string, nextDateShort: string, nextTitle: string) =>
    `No hay nada que mostrar ${suffix} en ${cityName}. La próxima es el ${nextDateShort} — ${nextTitle}.`,
  emptyNoEventsYet: (cityName: string) => `Todavía no tenemos inauguraciones ni exposiciones para ${cityName}.`,

  sensitiveOverlay: {
    label: "Contenido sensible",
    reveal: "Ver contenido",
  },

  footer: {
    tagline: "Calendario de arte curado por inteligencia humana potenciada por IA",
    copyright: (year: number) => `© ${year} Caldearte`,
    contacto: "Contacto",
    privacidad: "Privacidad",
  },

  privacidad: {
    title: "Privacidad y curatoría",
    dataTitle: "Qué datos guardamos",
    dataBody:
      "Guardamos dos cookies de preferencia — la ciudad que elegiste y si tienes activado el modo familiar — por un año, solo en tu navegador. No creamos cuentas, no usamos rastreadores de terceros, y no guardamos nada de lo que escribas en el formulario de contacto: solo lo reenviamos por correo. Usamos Vercel Analytics para ver estadísticas agregadas de visitas, sin cookies ni datos que te identifiquen.",
    curationTitle: "Cómo curamos",
    contactTitle: "¿Encontraste un error o algo que reportar?",
    contactBody: "Escríbenos desde el ",
    contactLinkLabel: "formulario de contacto",
  },

  contacto: {
    title: "Contacto",
    intro: "¿Viste algo mal curado, una inauguración que nos falta, o simplemente quieres escribirnos? Déjanos tu mensaje.",
    nameLabel: "Nombre (opcional)",
    emailLabel: "Tu email",
    messageLabel: "Mensaje",
    submit: "Enviar",
    sending: "Enviando...",
    success: "¡Gracias! Recibimos tu mensaje.",
    error: "Algo falló al enviar tu mensaje. Prueba de nuevo en un rato.",
  },

  // Already-approved copy, not a placeholder.
  curatoriaText:
    "Caldearte no es un agregador neutral. Elegimos con criterio qué inauguraciones mostramos, guiados por un compromiso con el arte como espacio de encuentro, reflexión y comunidad — no como vehículo de proselitismo religioso, glorificación de la violencia o plataforma de discursos de odio. Priorizamos el arte que abre preguntas: memoria histórica, crítica social, denuncia, experimentación — sea en un museo consagrado o en una intervención callejera de barrio. Usamos inteligencia artificial para ayudarnos a rastrear y evaluar inauguraciones todos los días, siempre bajo revisión humana en los casos donde el criterio no es obvio. Si crees que nos equivocamos con un evento, o quieres contarnos de una inauguración que no encontramos, escríbenos — leemos cada mensaje.",
};

export type Locale = typeof esCL;
