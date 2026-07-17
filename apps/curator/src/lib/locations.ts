// Deterministic location check for Event Discovery candidates — a
// code-level backstop, not just a prompt instruction (the prompt alone
// already failed once: Recoleta/Buenos Aires, see docs/region-discovery.md).
//
// Whitelist, not blocklist: a blocklist of foreign countries misses
// anything not explicitly listed (e.g. an event that only says "Lima",
// never "Perú"). Real events almost always name a checkable Chilean place
// — that's the point of publishing them — so requiring a recognizable
// Chilean region/city/comuna (or "Chile" itself) is the safer direction.
// It still passes genuinely freeform locations (a plaza, a street corner)
// as long as they're tied to a real Chilean place name.
//
// PLUS a foreign-country override checked FIRST: "Recoleta" is both a real
// Santiago comuna and part of "Centro Cultural Recoleta, Buenos Aires,
// Argentina" — a pure whitelist let 3 real Argentine candidates through on
// a substring match. An explicit foreign country/city mention vetoes the
// whitelist. Belt and suspenders, not either/or.
//
// Real production bug found in the FIRST live run: a plain substring check
// for the override backfired the other way — "Concepción, Parque Ecuador"
// (a real, well-known park IN Concepción, Chile) got rejected because
// "ecuador" appears inside "Parque Ecuador". Latin American cities
// routinely name streets/parks/plazas after other countries (this project
// already suspected "Avenida Argentina" exists in several Chilean cities —
// same risk). Fixed by only matching the override against the location's
// LAST comma-separated segment (the trailing "..., Argentina"/"..., Perú"
// a real cross-border result actually has), not anywhere in the string.

const CHILE_MARKERS = [
  "chile", "region metropolitana",
  // 16 administrative regions
  "arica y parinacota", "tarapaca", "antofagasta", "atacama", "coquimbo",
  "valparaiso", "libertador", "o'higgins", "ohiggins", "maule", "nuble",
  "biobio", "araucania", "los rios", "los lagos", "aysen", "magallanes",
  // cities/comunas in or likely in the rollout list
  "arica", "iquique", "alto hospicio", "calama", "tocopilla", "copiapo",
  "vallenar", "chanaral", "la serena", "ovalle", "illapel", "san antonio",
  "los andes", "san felipe", "quillota", "la ligua", "santiago",
  "providencia", "las condes", "vitacura", "lo barnechea", "nunoa",
  "la reina", "macul", "penalolen", "la florida", "puente alto",
  "san bernardo", "maipu", "pudahuel", "cerrillos", "estacion central",
  "quinta normal", "lo prado", "renca", "quilicura", "huechuraba",
  "independencia", "recoleta", "conchali", "cerro navia", "el bosque",
  "la cisterna", "san miguel", "san joaquin", "pedro aguirre cerda",
  "la granja", "la pintana", "san ramon", "lo espejo", "melipilla",
  "talagante", "buin", "vina del mar", "concon", "quilpue",
  "villa alemana", "casablanca", "rancagua", "san fernando", "rengo",
  "pichilemu", "talca", "curico", "linares", "cauquenes", "constitucion",
  "chillan", "san carlos", "los angeles", "concepcion", "talcahuano",
  "hualpen", "chiguayante", "san pedro de la paz", "coronel", "lota",
  "penco", "tome", "hualqui", "santa juana", "temuco", "padre las casas",
  "angol", "villarrica", "pucon", "valdivia", "la union", "puerto montt",
  "osorno", "castro", "ancud", "puerto varas", "frutillar", "coyhaique",
  "puerto aysen", "punta arenas", "puerto natales",
];

const FOREIGN_COUNTRY_MARKERS = [
  "argentina", "buenos aires", "espana", "peru", "bolivia", "colombia",
  "mexico", "estados unidos", "ecuador", "uruguay", "brasil", "venezuela",
  "paraguay",
];

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// `location` is typed as a required `string` in EventCandidate, but real
// production bug (found 2026-07-17, weekly-batch rollout's first live
// run): Haiku returned status:"approved" with location:null for a
// candidate, crashing the WHOLE run (uncaught TypeError on
// `null.toLowerCase()`) — losing every remaining unit in that batch, not
// just the one bad candidate. Same class of failure as sourceUrl's null
// violations, fixed the same way: treat a missing location as "can't
// confirm it's Chilean" (reject) rather than trusting the type and
// crashing. `| null | undefined` in the signature documents that this
// function must survive exactly the input that broke it, not just the
// declared type.
export function isChileanLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  const normalized = stripAccents(location.toLowerCase());
  const segments = normalized.split(",").map((s) => s.trim());
  const lastSegment = segments[segments.length - 1];
  if (FOREIGN_COUNTRY_MARKERS.includes(lastSegment)) return false;
  return CHILE_MARKERS.some((marker) => normalized.includes(marker));
}

export interface RegionLike {
  id: string;
  name: string;
}

// Resolved once at write-time (a real events.region_id FK) instead of
// re-guessed on every frontend render. Deliberately NOT the search unit
// that produced the candidate (region-discovery.md is explicit: a
// candidate's real location can differ from the unit searched for it, e.g.
// "Las Condes" found while searching "Providencia") — always matched from
// the candidate's own reported location text. Returns null when unmatched
// (an event outside the current unit list — the "otro" case).
//
// Checks EVERY comma-segment, not just the trailing one — a real
// production bug (found 2026-07-15): sources routinely cite "Ciudad,
// Nombre-oficial-de-la-región" (e.g. "Concepción, Bío Bío", "Arica, Región
// de Arica y Parinacota") instead of "barrio, Ciudad" — trailing-only
// matching missed these even though the city itself (a seeded region) is
// right there in the FIRST segment. Checking every segment catches both
// shapes without over-matching: a segment like "Viña del Mar" (a real,
// distinct comuna, not simply "Valparaíso" reworded) still correctly
// won't match, since it isn't the literal region name in any segment.
export function matchRegionId(location: string, regions: RegionLike[]): string | null {
  const normalized = stripAccents(location.toLowerCase());
  const segments = normalized.split(",").map((s) => s.trim());
  for (const segment of segments) {
    const match = regions.find((r) => stripAccents(r.name.toLowerCase()) === segment);
    if (match) return match.id;
  }
  return null;
}
