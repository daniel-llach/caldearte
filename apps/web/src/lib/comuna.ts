// Gran Santiago comuna names — a lightweight, code-level derivation from
// text we already store (freeform_location/place_name), NOT a new
// discovery capability. Checked directly: only ~40% of today's
// Santiago-region events have a comuna name anywhere in their existing
// text — the rest (bare street addresses like "Américo Vespucio Norte
// #2878", or landmarks like "MAC Parque Forestal" that aren't comuna
// names themselves) would need real geocoding, address -> comuna, which
// is Phase 2 and not built. This surfaces what's already there instead of
// collapsing every Gran Santiago event to the bare "Santiago" label; it
// doesn't invent detail that isn't in the data.
const GRAN_SANTIAGO_COMUNAS = [
  "Providencia", "Las Condes", "Vitacura", "Lo Barnechea", "Ñuñoa",
  "La Reina", "Macul", "Peñalolén", "La Florida", "Puente Alto",
  "San Bernardo", "Maipú", "Pudahuel", "Cerrillos", "Estación Central",
  "Quinta Normal", "Lo Prado", "Renca", "Quilicura", "Huechuraba",
  "Independencia", "Recoleta", "Conchalí", "Cerro Navia", "El Bosque",
  "La Cisterna", "San Miguel", "San Joaquín", "Pedro Aguirre Cerda",
  "La Granja", "La Pintana", "San Ramón", "Lo Espejo",
];

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Checks both freeform_location and place_name — whichever has the
// signal. Returns null when no known comuna name appears in either (the
// common case today).
export function deriveComuna(freeformLocation: string, placeName: string | null): string | null {
  const haystack = stripAccents(`${freeformLocation} ${placeName ?? ""}`.toLowerCase());
  return GRAN_SANTIAGO_COMUNAS.find((c) => haystack.includes(stripAccents(c.toLowerCase()))) ?? null;
}
