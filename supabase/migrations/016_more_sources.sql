-- RegAlert — fonti aggiuntive per un CASP: Q&A ESMA ed EBA, AMLA, Commissione UE, sezioni MiCAR di Consob e Banca d'Italia.
insert into ra_sources (name, authority, jurisdiction, url, kind, link_pattern, tags, check_every_minutes, active)
select * from (values
 ('ESMA — Q&A (risposte pubblicate)', 'ESMA', 'EU', 'https://www.esma.europa.eu/esma-qa-search-page/final', 'links', '/publications-data/questions-answers/\d+', '{MiCAR}'::text[], 360, true),
 ('EBA — Q&A Single Rulebook', 'EBA', 'EU', 'https://www.eba.europa.eu/single-rule-book-qa/all', 'links', '/single-rule-book-qa/qna/view/publicId/', '{MiCAR,"Travel Rule",AML}'::text[], 360, true),
 ('EBA — Pagina MiCA (ART ed EMT)', 'EBA', 'EU', 'https://www.eba.europa.eu/regulation-and-policy/asset-referenced-and-e-money-tokens-mica', 'page', null, '{MiCAR}'::text[], 720, true),
 ('Commissione UE — Cripto-attività', 'Commissione UE', 'EU', 'https://finance.ec.europa.eu/digital-finance/crypto-assets_en', 'page', null, '{MiCAR}'::text[], 1440, true),
 ('AMLA — Notizie', 'AMLA', 'EU', 'https://www.amla.europa.eu/news-media/news-articles_en', 'links', null, '{AML}'::text[], 360, true),
 ('AMLA — Consultazioni pubbliche', 'AMLA', 'EU', 'https://www.amla.europa.eu/policy/public-consultations_en', 'links', '/policy/public-consultations/.+', '{AML}'::text[], 720, true),
 ('Consob — Sezione MiCAR', 'Consob', 'IT', 'https://www.consob.it/web/area-pubblica/sezione-micar', 'links', null, '{MiCAR}'::text[], 720, true),
 ('Consob — MiCAR: CASP', 'Consob', 'IT', 'https://www.consob.it/web/area-pubblica/micar-casp', 'page', null, '{MiCAR}'::text[], 720, true),
 ('Banca d''Italia — Soggetti MiCAR', 'Banca d''Italia', 'IT', 'https://www.bancaditalia.it/compiti/vigilanza/accesso-mercato/soggetti-mercato-cripto-attivita/index.html', 'page', null, '{MiCAR}'::text[], 720, true)
) as v(name, authority, jurisdiction, url, kind, link_pattern, tags, check_every_minutes, active)
where not exists (select 1 from ra_sources s where s.url = v.url);
