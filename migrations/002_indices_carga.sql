-- Índices encontrados pelo teste de carga (degrau de 1.000 terreiros / 1,9 mi cobranças):
-- a busca de preceitos da próxima gira (início do filho) varria a tabela avisos inteira.
create index if not exists avisos_evento on avisos(evento_id) where evento_id is not null;
-- chaves estrangeiras consultadas por filho, lote ou trabalho
create index if not exists cobrancas_lote on cobrancas(lote_id) where lote_id is not null;
create index if not exists cobrancas_trabalho on cobrancas(trabalho_id) where trabalho_id is not null;
create index if not exists eventos_filho on eventos(filho_id) where filho_id is not null;
create index if not exists eventos_serie on eventos(serie_id) where serie_id is not null;
create index if not exists trabalhos_filho on trabalhos(filho_id);
create index if not exists presencas_filho on presencas(filho_id);
create index if not exists aviso_leituras_filho on aviso_leituras(filho_id);
create index if not exists vinculos_filho on vinculos(filho_id) where filho_id is not null;
