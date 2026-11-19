-- RegAlert — Agenzia delle Entrate: feed "normativa e prassi" (interpelli, circolari, risoluzioni, provvedimenti) filtrato sulle voci cripto.
-- Per i feed RSS il campo link_pattern filtra titolo, indirizzo ed estratto (funzione collect).
insert into ra_sources (name, authority, jurisdiction, url, kind, link_pattern, tags, check_every_minutes, active)
select 'Agenzia delle Entrate — Normativa e prassi (solo cripto)', 'Agenzia delle Entrate', 'IT',
  'https://www.agenziaentrate.gov.it/portale/c/portal/rss/entrate?idrss=0753fcb1-1a42-4f8c-f40d-02793c6aefb4', 'rss',
  'cripto|crypto|valut[ae] virtual|monete virtual|bitcoin|DAC ?8|CARF|stablecoin|token|blockchain|wallet|portafogl[io] digital|prestator[ei] di servizi',
  '{Fiscale}', 360, true
where not exists (select 1 from ra_sources where url like 'https://www.agenziaentrate.gov.it/portale/c/portal/rss/entrate%');
