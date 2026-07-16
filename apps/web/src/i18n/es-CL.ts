// Minimal i18n scaffold — only es-CL exists today (Chile-only for now, per
// an earlier decision on sensitivity copy). Add further locale files
// alongside this one and a lookup keyed by locale if/when the project
// expands beyond Chile — no lookup mechanism exists yet since there's only
// ever one locale to resolve to.

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

// "Muestra lo que hay": a zero count carries no information worth reading
// (nobody wants "0 inauguraciones y 2 exposiciones"), so it's dropped
// entirely rather than shown as a zero. When both are zero, callers decide
// their own fallback — this returns "" so the caller can detect that case.
function countsPhrase(inauguracionesCount: number, exposCount: number, joiner: string): string {
  const parts: string[] = [];
  if (inauguracionesCount > 0) {
    parts.push(`${inauguracionesCount} ${pluralize(inauguracionesCount, "inauguración", "inauguraciones")}`);
  }
  if (exposCount > 0) {
    parts.push(`${exposCount} ${pluralize(exposCount, "exposición", "exposiciones")}`);
  }
  return parts.join(joiner);
}

export const esCL = {
  appName: "CALDEARTE",
  chooseCity: "Elegí tu ciudad",
  menu: "Menú",
  curatoria: "Curatoria",
  familyMode: "Modo familiar",
  otherCity: "Otro",
  explorar: "Explorar",

  headerSummary: (inauguracionesCount: number, exposCount: number) => {
    const phrase = countsPhrase(inauguracionesCount, exposCount, " y ");
    return phrase ? `${phrase} que visitar en` : "Descubrí el arte que hay en";
  },

  sectionInauguraciones: "INAUGURACIONES",
  sectionExposActuales: "EXPOS ACTUALES",
  sectionArteEnTodasPartes: "ARTE EN TODAS PARTES",

  cityStats: (inauguracionesCount: number, exposCount: number) => countsPhrase(inauguracionesCount, exposCount, " · "),

  tellUs: "Contanos →",
  doYouKnowOne: "¿Conocés una que deberíamos sumar?",
  // Shown when a section (inauguraciones or expos actuales) has nothing
  // for today, but there's a real upcoming event to point to instead.
  emptyWithNextEvent: (cityName: string, nextDateShort: string, nextTitle: string) =>
    `No hay nada que mostrar hoy en ${cityName}. La próxima es el ${nextDateShort} — ${nextTitle}.`,
  emptyNoEventsYet: (cityName: string) => `Todavía no tenemos inauguraciones ni exposiciones para ${cityName}.`,

  sensitiveOverlay: {
    label: "Contenido sensible",
    reveal: "Ver contenido",
  },

  footer: {
    tagline: "Calendario de arte curado por inteligencia humana potenciada por IA",
    copyright: (year: number) => `© ${year} Caldearte`,
    acercaDe: "Acerca de",
    contacto: "Contacto",
    instagram: "Instagram",
  },

  // Verbatim from docs/mockup.jsx's CURATORIA_TEXT — already-approved copy,
  // not a placeholder.
  curatoriaText:
    "Caldearte no es un agregador neutral. Elegimos con criterio qué inauguraciones mostramos, guiados por un compromiso con el arte como espacio de encuentro, reflexión y comunidad — no como vehículo de proselitismo religioso, glorificación de la violencia o plataforma de discursos de odio. Priorizamos el arte que abre preguntas: memoria histórica, crítica social, denuncia, experimentación — sea en un museo consagrado o en una intervención callejera de barrio. Usamos inteligencia artificial para ayudarnos a rastrear y evaluar inauguraciones todos los días, siempre bajo revisión humana en los casos donde el criterio no es obvio. Si creés que nos equivocamos con un evento, o querés contarnos de una inauguración que no encontramos, escribinos — leemos cada mensaje.",
};

export type Locale = typeof esCL;
