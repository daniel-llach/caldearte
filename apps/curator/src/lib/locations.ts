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
  "osorno", "castro", "ancud", "puerto varas", "coyhaique",
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

export function isChileanLocation(location: string): boolean {
  const normalized = stripAccents(location.toLowerCase());
  if (FOREIGN_COUNTRY_MARKERS.some((marker) => normalized.includes(marker))) return false;
  return CHILE_MARKERS.some((marker) => normalized.includes(marker));
}
