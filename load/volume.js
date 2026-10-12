'use strict';
// Gera massa de dados realista direto no banco (generate_series), em degraus cumulativos.
// Cada terreiro: N filhos, M meses de mensalidade (≈94% pagas), trabalhos, despesas, giras e avisos.
const crypto = require('crypto');
const db = require('../src/db');
const { hashSenha } = require('../src/auth');

const SENHA = 'carga-senha-123';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let hashCache;

async function contar() {
  return db.one(`select
    (select count(*) from terreiros where email like '%@carga.dev')::int as terreiros,
    (select count(*) from filhos)::int as filhos,
    (select count(*) from cobrancas)::int as cobrancas,
    (select count(*) from eventos)::int as eventos,
    (select count(*) from avisos)::int as avisos,
    (select count(*) from despesas)::int as despesas,
    (select pg_database_size(current_database()) / 1024 / 1024)::int as tamanho_mb`);
}

// Cria terreiros de (ini+1) até fim, cada um com `filhos` filhos e `meses` meses de histórico
async function semearTerreiros(ini, fim, { filhos = 100, meses = 24, prefixo = 'Terreiro Carga' } = {}) {
  if (fim <= ini) return;
  hashCache = hashCache || hashSenha(SENHA);
  const plano = await db.one(`select id from planos where nome = 'Axé'`);
  const t0 = Date.now();
  await db.query(
    `insert into terreiros(nome, documento, tradicao, responsavel_nome, email, status, plano_id, mensalidade, gateway_conta_id, gateway_conta_status, onboarding)
     select $3 || ' ' || i, '9' || lpad(i::text, 13, '0'), case when i % 3 = 0 then 'Candomblé' else 'Umbanda' end, 'Responsável ' || i, 'casa' || i || '@carga.dev', 'ativo', $4,
            '{"ativa":true,"valor_centavos":5000,"dia_geracao":1,"dia_vencimento":10,"entrada":"integral"}', 'acc_carga_' || i, 'aprovada',
            '{"dados_casa":"feita","tradicao":"feita","mensalidade":"feita","conta_recebimento":"feita"}'
       from generate_series($1::int + 1, $2::int) i`,
    [ini, fim, prefixo, plano.id]
  );
  const novos = `(select id, (regexp_replace(email, '\\D', '', 'g'))::int as seq from terreiros where email like '%@carga.dev' and (regexp_replace(email, '\\D', '', 'g'))::int between ${ini + 1} and ${fim})`;
  // sacerdotes com sessão conhecida (o token é derivado do número da casa)
  await db.query(
    `with u as (insert into usuarios(nome, email, senha_hash) select 'Sacerdote ' || seq, 'pai' || seq || '@carga.dev', $1 from ${novos} t returning id, email)
     insert into vinculos(usuario_id, terreiro_id, papel) select u.id, t.id, 'sacerdote' from u join ${novos} t on u.email = 'pai' || t.seq || '@carga.dev'`,
    [hashCache]
  );
  await db.query(
    `insert into sessoes(token_hash, usuario_id, expira_em)
     select encode(sha256(('sac-' || t.seq)::bytea), 'hex'), v.usuario_id, now() + interval '30 days'
       from ${novos} t join vinculos v on v.terreiro_id = t.id and v.papel = 'sacerdote'`
  );
  await db.query(
    `insert into grupos(terreiro_id, nome) select t.id, g from ${novos} t, unnest(array['Corrente','Ogãs','Ekedes','Cambonos','Iniciantes']) g`
  );
  await db.query(
    `insert into servicos(terreiro_id, nome, preco_sugerido_centavos) select t.id, s.n, s.p from ${novos} t,
       (values ('Bori', 35000), ('Ebó', 15000), ('Amaci', 8000), ('Jogo de búzios', 15000), ('Feitura', 300000)) s(n, p)`
  );
  const ORIXAS = `array['Exu','Ogum','Oxóssi','Xangô','Iansã','Oxum','Iemanjá','Nanã','Obaluaê','Oxalá']`;
  await db.query(
    `insert into filhos(terreiro_id, nome_civil, nome_santo, telefone, status, pai_cabeca, mae_cabeca, data_entrada, convite_status, isento, consentimento_em, consentimento_versao, consentimento_religioso)
     select t.id, 'Filho ' || t.seq || '-' || j, case when j % 3 = 0 then 'Dofono ' || j end, '55' || lpad((t.seq::bigint * 1000 + j)::text, 11, '1'),
            (case when j % 25 = 0 then 'afastado' when j % 50 = 7 then 'desligado' else 'ativo' end)::status_filho,
            (${ORIXAS})[1 + (j % 10)], (${ORIXAS})[1 + ((j * 7) % 10)], current_date - ((j * 9) % 900), case when j % 4 = 0 then 'convidado' else 'ativo' end,
            j % 40 = 0, now(), '1.0', true
       from ${novos} t, generate_series(1, $1::int) j`,
    [filhos]
  );
  await db.query(
    `insert into vinculos(terreiro_id, papel, filho_id) select f.terreiro_id, 'filho', f.id from filhos f join ${novos} t on t.id = f.terreiro_id`
  );
  await db.query(
    `insert into filho_grupos(filho_id, grupo_id) select f.id, g.id from filhos f join ${novos} t on t.id = f.terreiro_id
       join grupos g on g.terreiro_id = f.terreiro_id and (g.nome = 'Corrente' or (g.nome = 'Ogãs' and right(f.telefone, 1) = '3'))`
  );
  // um filho por casa com login (token derivado do número da casa)
  await db.query(
    `with alvo as (select distinct on (f.terreiro_id) f.id, f.terreiro_id, t.seq from filhos f join ${novos} t on t.id = f.terreiro_id where f.status = 'ativo' order by f.terreiro_id, f.nome_civil),
          u as (insert into usuarios(nome, telefone, senha_hash) select 'Filho login ' || a.seq, '5599' || lpad(a.seq::text, 9, '0'), $1 from alvo a returning id, telefone)
     update filhos f set usuario_id = u.id from alvo a join u on u.telefone = '5599' || lpad(a.seq::text, 9, '0') where f.id = a.id`,
    [hashCache]
  );
  await db.query(
    `update vinculos v set usuario_id = f.usuario_id from filhos f join ${novos} t on t.id = f.terreiro_id where v.filho_id = f.id and f.usuario_id is not null`
  );
  await db.query(
    `insert into sessoes(token_hash, usuario_id, expira_em)
     select encode(sha256(('fil-' || t.seq)::bytea), 'hex'), f.usuario_id, now() + interval '30 days' from filhos f join ${novos} t on t.id = f.terreiro_id where f.usuario_id is not null`
  );
  // mensalidades: m = 0 é o mês corrente; ≈ 6% das antigas ficam em atraso
  await db.query(
    `insert into cobrancas(terreiro_id, filho_id, descricao, valor_centavos, vencimento, status, origem, competencia, gateway_id, pix_copia_cola, pago_em, forma_pagamento, recibo_numero)
     select f.terreiro_id, f.id, 'Mensalidade ' || to_char(c.mes, 'MM/YYYY'), 5000, (c.mes + interval '9 days')::date,
            (case when m = 0 or (abs(hashtext(f.id::text || m)) % 100) < 6 then 'aberta' else 'paga' end)::status_cobranca,
            'mensalidade', to_char(c.mes, 'YYYY-MM'), 'pay_m_' || md5(f.id::text || m),
            '00020126580014br.gov.bcb.pix0136' || md5(f.id::text || m) || '5204000053039865405' || '50.005802BR6304ABCD',
            case when m = 0 or (abs(hashtext(f.id::text || m)) % 100) < 6 then null else c.mes + interval '9 days' - ((abs(hashtext(f.id::text || m)) % 8) || ' days')::interval + interval '14 hours' end,
            case when m = 0 or (abs(hashtext(f.id::text || m)) % 100) < 6 then null else 'pix' end,
            case when m = 0 or (abs(hashtext(f.id::text || m)) % 100) < 6 then null else nextval('recibos_seq') end
       from filhos f join ${novos} t on t.id = f.terreiro_id,
            generate_series(0, $1::int - 1) m,
            lateral (select (date_trunc('month', current_date) - (m || ' months')::interval)::date as mes) c
      where f.status <> 'desligado' and not f.isento and f.data_entrada <= (c.mes + interval '1 month')::date`,
    [meses]
  );
  // trabalhos avulsos: ~1 a cada 6 meses por filho
  await db.query(
    `insert into cobrancas(terreiro_id, filho_id, descricao, valor_centavos, vencimento, status, origem, gateway_id, pago_em, forma_pagamento)
     select f.terreiro_id, f.id, s.n, s.p, current_date - (k * 180 + (abs(hashtext(f.id::text)) % 90)), 'paga', 'trabalho', 'pay_t_' || md5(f.id::text || 't' || k),
            now() - ((k * 180 + (abs(hashtext(f.id::text)) % 90)) || ' days')::interval, 'pix'
       from filhos f join ${novos} t on t.id = f.terreiro_id, generate_series(0, ($1::int / 6) - 1) k,
            lateral (select * from (values ('Bori', 35000), ('Ebó', 15000), ('Amaci', 8000)) v(n, p) offset (abs(hashtext(f.id::text || k)) % 3) limit 1) s`,
    [meses]
  );
  await db.query(
    `insert into despesas(terreiro_id, categoria, descricao, valor_centavos, data)
     select t.id, (array['velas','ervas','animais','aluguel','luz','agua','obras','festas'])[1 + (d % 8)], 'Despesa ' || d, 2000 + (d * 397) % 30000,
            current_date - (d * 3)
       from ${novos} t, generate_series(0, $1::int * 10 - 1) d`,
    [meses]
  );
  await db.query(
    `insert into eventos(terreiro_id, tipo, titulo, inicio, fim, publico)
     select t.id, 'gira', 'Gira semanal', date_trunc('week', current_date)::timestamp + interval '4 days 19 hours 30 minutes' + (w || ' weeks')::interval,
            date_trunc('week', current_date)::timestamp + interval '4 days 22 hours 30 minutes' + (w || ' weeks')::interval, true
       from ${novos} t, generate_series(- $1::int * 4, 8) w`,
    [meses]
  );
  await db.query(
    `insert into avisos(terreiro_id, titulo, texto, publico, fixado, created_at)
     select t.id, 'Aviso ' || a, 'Texto do aviso ' || a, '{"tipo":"todos"}', a = 0, now() - (a || ' days')::interval
       from ${novos} t, generate_series(0, $1::int * 5 - 1) a`,
    [meses]
  );
  await db.query('analyze');
  return Date.now() - t0;
}

const tokenSacerdote = (seq) => `sac-${seq}`;
const tokenFilho = (seq) => `fil-${seq}`;

module.exports = { contar, semearTerreiros, tokenSacerdote, tokenFilho, sha, SENHA };
