-- Fase 1a bootstrap: arranca Proceso A/B con las regiones chilenas nombradas
-- en el project-brief ("Descubrimiento de fuentes"), en vez de sembrar venues
-- a mano. expansion_rank queda NULL a propósito: estas regiones se activan
-- directo por decisión editorial de arranque, no por el ranking
-- población/distancia-a-Santiago (ese ranking global recién hace falta
-- cuando se dispare la primera expansión por saturación).
insert into regions (name, country, language, lat, lng, population, status, search_frequency)
values
  ('Santiago', 'Chile', 'es', -33.4489, -70.6693, 6800000, 'active', 'weekly'),
  ('Valparaíso', 'Chile', 'es', -33.0472, -71.6127, 1000000, 'active', 'weekly'),
  ('Concepción', 'Chile', 'es', -36.8201, -73.0444, 970000, 'active', 'weekly'),
  ('Antofagasta', 'Chile', 'es', -23.6509, -70.3975, 400000, 'active', 'weekly'),
  ('Arica', 'Chile', 'es', -18.4783, -70.3126, 250000, 'active', 'weekly');
