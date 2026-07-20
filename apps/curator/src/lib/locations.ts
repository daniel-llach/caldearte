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

// Real bug (found 2026-07-20, via a user-requested Event Discovery audit):
// this list used to be a hand-picked ~100-entry subset, curated once for an
// earlier, smaller rollout list — it silently fell out of sync as the
// `regions` table grew to 346 comunas. In a single real run, 14 of the 25
// comunas actually being searched that day (Colbún among them) weren't in
// the list at all, so Haiku-approved, genuinely-Chilean events in those
// comunas got force-rejected by this filter with "[FILTRO DE CÓDIGO:
// ubicación no reconocida como chilena]" — a false negative, not a curation
// call. Fixed by generating the comuna portion below directly from every
// row in `regions` as of 2026-07-20 (`select name from regions order by
// name`, normalized the same way this file already normalizes: NFD accent
// strip + lowercase) instead of hand-maintaining a subset. This is a
// snapshot, not a live query — see docs/region-discovery.md's Event
// Discovery quality-improvements section for the plan to stop this
// drifting again as new comunas get seeded.
const CHILE_MARKERS = [
  "chile", "region metropolitana",
  // 16 administrative regions
  "arica y parinacota", "tarapaca", "antofagasta", "atacama", "coquimbo",
  "valparaiso", "libertador", "o'higgins", "ohiggins", "maule", "nuble",
  "biobio", "araucania", "los rios", "los lagos", "aysen", "magallanes",
  // All 346 comunas in `regions` as of 2026-07-20 — see comment above.
  "aisen", "algarrobo", "alhue", "alto biobio", "alto del carmen", "alto hospicio",
  "ancud", "andacollo", "angol", "antartica", "antofagasta", "antuco", "arauco", "arica",
  "buin", "bulnes", "cabildo", "cabo de hornos", "cabrero", "calama", "calbuco", "caldera",
  "calera", "calera de tango", "calle larga", "camarones", "camina", "canela", "canete",
  "carahue", "cartagena", "casablanca", "castro", "catemu", "cauquenes", "cerrillos",
  "cerro navia", "chaiten", "chanaral", "chanco", "chepica", "chiguayante", "chile chico",
  "chillan", "chillan viejo", "chimbarongo", "cholchol", "chonchi", "cisnes", "cobquecura",
  "cochamo", "cochrane", "codegua", "coelemu", "coihaique", "coyhaique", "coihueco", "coinco", "colbun",
  "colchane", "colina", "collipulli", "coltauco", "combarbala", "concepcion", "conchali",
  "concon", "constitucion", "contulmo", "copiapo", "coquimbo", "coronel", "corral",
  "cunco", "curacautin", "curacavi", "curaco de velez", "curanilahue", "curarrehue",
  "curepto", "curico", "dalcahue", "diego de almagro", "donihue", "el bosque", "el carmen",
  "el monte", "el quisco", "el tabo", "empedrado", "ercilla", "estacion central",
  "florida", "freire", "freirina", "fresia", "frutillar", "futaleufu", "futrono",
  "galvarino", "general lagos", "gorbea", "graneros", "guaitecas", "hijuelas", "hualaihue",
  "hualane", "hualpen", "hualqui", "huara", "huasco", "huechuraba", "illapel",
  "independencia", "iquique", "isla de maipo", "isla de pascua", "juan fernandez",
  "la cisterna", "la cruz", "la estrella", "la florida", "la granja", "la higuera",
  "la ligua", "la pintana", "la reina", "la serena", "la union", "lago ranco",
  "lago verde", "laguna blanca", "laja", "lampa", "lanco", "las cabras", "las condes",
  "lautaro", "lebu", "licanten", "limache", "linares", "litueche", "llaillay",
  "llanquihue", "lo barnechea", "lo espejo", "lo prado", "lolol", "loncoche", "longavi",
  "lonquimay", "los alamos", "los andes", "los angeles", "los lagos", "los muermos",
  "los sauces", "los vilos", "lota", "lumaco", "machali", "macul", "mafil", "maipu",
  "malloa", "marchihue", "maria elena", "maria pinto", "mariquina", "maule", "maullin",
  "mejillones", "melipeuco", "melipilla", "molina", "monte patria", "mostazal", "mulchen",
  "nacimiento", "nancagua", "natales", "navidad", "negrete", "ninhue", "niquen", "nogales",
  "nueva imperial", "nunoa", "olivar", "ollague", "olmue", "osorno", "ovalle",
  "padre hurtado", "padre las casas", "paiguano", "paillaco", "paine", "palena",
  "palmilla", "panguipulli", "panquehue", "papudo", "paredones", "parral",
  "pedro aguirre cerda", "pelarco", "pelluhue", "pemuco", "penaflor", "penalolen",
  "pencahue", "penco", "peralillo", "perquenco", "petorca", "peumo", "pica", "pichidegua",
  "pichilemu", "pinto", "pirque", "pitrufquen", "placilla", "portezuelo", "porvenir",
  "pozo almonte", "primavera", "providencia", "puchuncavi", "pucon", "pudahuel",
  "puente alto", "puerto montt", "puerto octay", "puerto varas", "pumanque", "punitaqui",
  "punta arenas", "puqueldon", "puren", "purranque", "putaendo", "putre", "puyehue",
  "queilen", "quellon", "quemchi", "quilaco", "quilicura", "quilleco", "quillon",
  "quillota", "quilpue", "quinchao", "quinta de tilcoco", "quinta normal", "quintero",
  "quirihue", "rancagua", "ranquil", "rauco", "recoleta", "renaico", "renca", "rengo",
  "requinoa", "retiro", "rinconada", "rio bueno", "rio claro", "rio hurtado", "rio ibanez",
  "rio negro", "rio verde", "romeral", "saavedra", "sagrada familia", "salamanca",
  "san antonio", "san bernardo", "san carlos", "san clemente", "san esteban", "san fabian",
  "san felipe", "san fernando", "san gregorio", "san ignacio", "san javier", "san joaquin",
  "san jose de maipo", "san juan de la costa", "san miguel", "san nicolas", "san pablo",
  "san pedro", "san pedro de atacama", "san pedro de la paz", "san rafael", "san ramon",
  "san rosendo", "san vicente", "santa barbara", "santa cruz", "santa juana",
  "santa maria", "santiago", "santo domingo", "sierra gorda", "talagante", "talca",
  "talcahuano", "taltal", "temuco", "teno", "teodoro schmidt", "tierra amarilla", "tiltil",
  "timaukel", "tirua", "tocopilla", "tolten", "tome", "torres del paine", "tortel",
  "traiguen", "treguaco", "tucapel", "valdivia", "vallenar", "valparaiso", "vichuquen",
  "victoria", "vicuna", "vilcun", "villa alegre", "villa alemana", "villarrica",
  "vina del mar", "vitacura", "yerbas buenas", "yumbel", "yungay", "zapallar",
  // Extra alias not in the regions table itself (an official abbreviation
  // of "O'Higgins" already covered above, kept for the apostrophe-free
  // spelling some sources use).
  "ohiggins",
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
