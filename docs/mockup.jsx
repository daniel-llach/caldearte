// Historical prototype, not a live component — not imported anywhere in
// apps/web. Kept only for provenance: apps/web/src/i18n/es-CL.ts's
// curatoriaText is copied verbatim from this file's CURATORIA_TEXT, and
// apps/web/src/lib/date.ts's header comment traces back to this file's
// tab-based structure. See docs/ui-prototype.md for how the shipped app
// diverged from what's described here.
import { useState, useMemo, useRef, useEffect } from "react";
import { MapPin, ChevronDown } from "lucide-react";

const CITIES = [
  {
    id: "arica",
    name: "Arica",
    events: [
      { id: 1, date: "2026-07-11", title: "Trazos del desierto", artist: "Ana Rojas", venue: "Galería Cerro Norte", time: "19:00", color: "bg-orange-200", sensitive: false },
      { id: 2, date: "2026-07-11", title: "Cuerpo y ruido", artist: "Colectivo Norte", venue: "Plaza Colón", time: "20:00", color: "bg-purple-200", sensitive: true },
      { id: 3, date: "2026-07-14", title: "Retratos de barrio", artist: "Marta Soto", venue: "JJVV San Miguel", time: "18:30", color: "bg-green-200", sensitive: false },
      { id: 4, date: "2026-07-20", title: "Grabado en movimiento", artist: "Luis Peña", venue: "Galería del Puerto", time: "19:00", color: "bg-yellow-200", sensitive: false },
      { id: 5, date: "2026-07-25", title: "Metales", artist: "Sofía Vidal", venue: "Centro Cultural Municipal", time: "19:30", color: "bg-blue-200", sensitive: false },
      { id: 6, date: "2026-08-03", title: "Después de la ocupación", artist: "Grupo Memoria", venue: "Centro Cultural Municipal", time: "19:00", color: "bg-pink-200", sensitive: false },
    ],
  },
  { id: "antofagasta", name: "Antofagasta", events: [] },
  { id: "santiago", name: "Santiago", events: [] },
];

const CURATORIA_TEXT =
  "Caldearte no es un agregador neutral. Elegimos con criterio qué inauguraciones mostramos, guiados por un compromiso con el arte como espacio de encuentro, reflexión y comunidad — no como vehículo de proselitismo religioso, glorificación de la violencia o plataforma de discursos de odio. Priorizamos el arte que abre preguntas: memoria histórica, crítica social, denuncia, experimentación — sea en un museo consagrado o en una intervención callejera de barrio. Usamos inteligencia artificial para ayudarnos a rastrear y evaluar inauguraciones todos los días, siempre bajo revisión humana en los casos donde el criterio no es obvio. Si creés que nos equivocamos con un evento, o querés contarnos de una inauguración que no encontramos, escribinos — leemos cada mensaje.";

function parseDate(d) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}
function fmtDayHeader(d) {
  const date = parseDate(d);
  const weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${date.getDate()} de ${months[date.getMonth()]} · ${weekdays[date.getDay()]}`;
}
function fmtShort(d) {
  const date = parseDate(d);
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}
function fmtMonthHeader(ym) {
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const [y, m] = ym.split("-").map(Number);
  return `${months[m - 1]} ${y}`;
}

const TODAY = "2026-07-11";
const today = parseDate(TODAY);

export default function CaldearteMockup() {
  const containerRef = useRef(null);
  const [cols, setCols] = useState(1);
  const [cityId, setCityId] = useState("arica");
  const [tab, setTab] = useState("hoy");
  const [selected, setSelected] = useState(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerView, setDrawerView] = useState("menu");
  const [modoFamiliar, setModoFamiliar] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setCols(w < 600 ? 1 : w < 900 ? 2 : 3);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const city = CITIES.find((c) => c.id === cityId);
  const allEvents = modoFamiliar ? city.events.filter((e) => !e.sensitive) : city.events;

  const filtered = useMemo(() => {
    return allEvents.filter((e) => {
      const d = parseDate(e.date);
      const diffDays = Math.round((d - today) / 86400000);
      if (tab === "hoy") return diffDays === 0;
      if (tab === "semana") return diffDays >= 0 && diffDays <= 6;
      if (tab === "mes") return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear() && diffDays >= 0;
      return d.getFullYear() === today.getFullYear() && diffDays >= 0;
    });
  }, [allEvents, tab]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((e) => {
      const key = tab === "año" ? e.date.slice(0, 7) : e.date;
      map[key] = map[key] || [];
      map[key].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => (a > b ? 1 : -1));
  }, [filtered, tab]);

  const nextEvent = useMemo(() => {
    const future = allEvents.filter((e) => parseDate(e.date) >= today).sort((a, b) => (a.date > b.date ? 1 : -1));
    return future[0] || null;
  }, [allEvents]);

  const labels = { hoy: "hoy", semana: "esta semana", mes: "este mes", año: "este año" };
  const showSidePanel = cols === 3;

  const DetailContent = ({ e }) => (
    <div>
      <div className={`h-56 ${e.color}`} />
      <div className="p-5">
        <p className="text-lg font-bold text-stone-900 mb-1">{e.title}</p>
        <p className="text-sm text-stone-400 mb-0.5">{e.artist}</p>
        <p className="text-sm text-stone-400">{e.venue} · {fmtShort(e.date)}, {e.time}</p>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="w-full bg-white relative">
      <div className="border border-stone-200 rounded-2xl overflow-hidden bg-stone-50 relative">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <span className="font-serif font-bold text-lg tracking-wide text-stone-900">CALDEARTE</span>
          <button onClick={() => setDrawerOpen(true)} className="text-stone-900 text-xl leading-none">☰</button>
        </div>

        <button
          onClick={() => setLocationOpen(true)}
          className="mx-5 mb-3 flex items-center gap-1.5 text-xs text-stone-500"
        >
          <MapPin size={14} />
          <span>{city.name}</span>
          <ChevronDown size={12} className="text-stone-300" />
        </button>

        <div className="px-5 pb-4 flex gap-2">
          {Object.entries(labels).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setSelected(null); }}
              className={`text-xs px-3 py-1.5 rounded-full capitalize ${tab === key ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-500"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="border-t border-stone-200 px-5 py-4 flex gap-4">
          <div className="flex-1 min-w-0">
            {grouped.length === 0 ? (
              <div className="py-6">
                {nextEvent ? (
                  <>
                    <p className="text-sm text-stone-700 mb-2">No hay inauguraciones {labels[tab]} en {city.name}.</p>
                    <p className="text-xs text-stone-400 mb-3">La próxima es el {fmtShort(nextEvent.date)} — {nextEvent.title}.</p>
                    <button onClick={() => setSelected(nextEvent)} className="text-xs px-3 py-1.5 rounded-full border border-stone-300 text-stone-700">
                      Ver esa fecha
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-stone-700 mb-2">Todavía no tenemos inauguraciones para {city.name}.</p>
                    <p className="text-xs text-stone-400 mb-3">¿Conocés una que deberíamos sumar?</p>
                    <button className="text-xs px-3 py-1.5 rounded-full bg-stone-900 text-white">Contanos →</button>
                  </>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: "12px" }}>
                {grouped.map(([date, dayEvents]) => (
                  <div key={date} className="border border-stone-200 rounded-xl p-3">
                    <p className="text-xs text-stone-400 mb-2 capitalize">{tab === "año" ? fmtMonthHeader(date) : fmtDayHeader(date)}</p>
                    <div className="flex flex-wrap gap-2">
                      {dayEvents.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setSelected(e)}
                          className={`w-20 h-20 rounded-lg ${e.color} relative ${selected?.id === e.id ? "ring-2 ring-stone-900" : ""}`}
                        >
                          {e.sensitive && (
                            <span className="absolute top-1 left-1 bg-stone-900/70 text-white text-[9px] px-1.5 py-0.5 rounded">
                              sensible
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {showSidePanel && (
            <div className="w-80 shrink-0 border-l border-stone-200 -my-4 -mr-5 pl-4">
              {selected ? <DetailContent e={selected} /> : (
                <div className="h-full flex items-center justify-center text-sm text-stone-300 py-16">
                  Elegí una obra de la lista
                </div>
              )}
            </div>
          )}
        </div>

        {!showSidePanel && selected && (
          <div className="absolute inset-0 bg-stone-50 z-20 overflow-y-auto">
            <div className="px-5 py-4 flex items-center gap-2">
              <button onClick={() => setSelected(null)} className="text-stone-900 text-lg">←</button>
              <span className="text-xs text-stone-400">volver</span>
            </div>
            <DetailContent e={selected} />
          </div>
        )}

        <div
          className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${locationOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onClick={() => setLocationOpen(false)}
        />
        <div
          className={`fixed top-0 left-0 right-0 z-40 bg-stone-50 px-5 py-4 shadow-lg transition-transform duration-300 ease-out ${locationOpen ? "translate-y-0" : "-translate-y-full"}`}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-stone-900">Elegí tu ciudad</p>
            <button onClick={() => setLocationOpen(false)} className="text-stone-400 text-sm">✕</button>
          </div>
          {CITIES.map((c) => (
            <button
              key={c.id}
              onClick={() => { setCityId(c.id); setSelected(null); setLocationOpen(false); }}
              className={`w-full text-left text-sm px-2 py-2.5 rounded-lg mb-1 transition-colors ${c.id === cityId ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div
          className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onClick={() => { setDrawerOpen(false); setTimeout(() => setDrawerView("menu"), 300); }}
        />
        <div
          className={`fixed top-0 right-0 bottom-0 z-40 w-72 bg-stone-50 px-5 py-4 shadow-lg transition-transform duration-300 ease-out ${drawerOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          {drawerView === "menu" ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-stone-900">Menú</p>
                <button onClick={() => setDrawerOpen(false)} className="text-stone-400 text-sm">✕</button>
              </div>
              <button onClick={() => setDrawerView("curatoria")} className="w-full text-left text-sm text-stone-700 py-2.5 border-b border-stone-200 flex items-center justify-between">
                <span>Curatoria</span>
                <span className="text-stone-300">›</span>
              </button>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-stone-700">Modo familiar</span>
                <button
                  onClick={() => setModoFamiliar((v) => !v)}
                  className={`w-10 h-6 rounded-full relative transition-colors ${modoFamiliar ? "bg-stone-900" : "bg-stone-300"}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${modoFamiliar ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setDrawerView("menu")} className="text-stone-900 text-lg">←</button>
                <p className="text-sm font-bold text-stone-900">Curatoria</p>
              </div>
              <p className="text-sm text-stone-600 leading-relaxed">{CURATORIA_TEXT}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
