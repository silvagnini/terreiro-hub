'use strict';
// Teste de contrato: toda rota está documentada e toda resposta real obedece ao schema do openapi.json.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const h = require('../helpers');
const { spec } = require('../../scripts/gerar-openapi');
const { listarRotas } = require('../../scripts/rotas');
const { criarApp } = require('../../src/app');

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'openapi');

const templates = Object.keys(spec.paths)
  .map((p) => ({ p, re: new RegExp('^' + p.replace(/\{\w+\}/g, '[^/]+') + '$'), params: (p.match(/\{/g) || []).length }))
  .sort((a, b) => a.params - b.params);

const exercitadas = new Map(); // "GET /t/{tid}" -> Set(status)
const falhas = [];

// cliente que valida cada resposta contra o contrato
const cache = new Map();
function compilar(schema) {
  const k = JSON.stringify(schema);
  if (!cache.has(k)) cache.set(k, schema.$ref ? ajv.getSchema('openapi' + schema.$ref) : ajv.compile({ ...schema, $id: undefined }));
  return cache.get(k);
}
function validarResposta(metodo, url, status, corpo) {
  const caminho = url.replace(/^\/api/, '').split('?')[0];
  const t = templates.find((x) => x.re.test(caminho));
  if (!t) return falhas.push(`${metodo} ${caminho}: rota fora do contrato`);
  const op = spec.paths[t.p][metodo.toLowerCase()];
  if (!op) return falhas.push(`${metodo} ${t.p}: método fora do contrato`);
  const chave = `${metodo} ${t.p}`;
  if (!exercitadas.has(chave)) exercitadas.set(chave, new Set());
  exercitadas.get(chave).add(status);
  const r = op.responses[status];
  if (!r) return falhas.push(`${chave}: status ${status} não documentado (${JSON.stringify(corpo).slice(0, 160)})`);
  const schema = r.content?.['application/json']?.schema;
  if (!schema) return;
  const v = schema.$ref ? compilar(schema) : ajv.compile(JSON.parse(JSON.stringify(schema).replace(/"#\/components/g, '"openapi#/components')));
  if (!v(corpo)) falhas.push(`${chave} ${status}: ${ajv.errorsText(v.errors, { dataVar: 'resposta' })}`);
}

const C = (token) => {
  const chamar = async (m, u, corpo) => {
    const r = await h.req(m, '/api' + u, { token, corpo });
    validarResposta(m, '/api' + u, r.status, r.body);
    return r;
  };
  return { token, get: (u) => chamar('GET', u), post: (u, b = {}) => chamar('POST', u, b), patch: (u, b = {}) => chamar('PATCH', u, b), put: (u, b = {}) => chamar('PUT', u, b), del: (u, b) => chamar('DELETE', u, b) };
};

describe('Contrato · OpenAPI', () => {
  before(h.subir);
  after(async () => {
    const total = Object.values(spec.paths).reduce((s, p) => s + Object.keys(p).length, 0);
    fs.mkdirSync(path.join(__dirname, '../../reports'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../../reports/contrato.json'), JSON.stringify({
      gerado_em: new Date().toISOString(), operacoes_documentadas: total, operacoes_exercitadas: exercitadas.size,
      cobertura_percentual: Math.round((exercitadas.size * 1000) / total) / 10, respostas_validadas: [...exercitadas.values()].reduce((s, x) => s + x.size, 0),
      violacoes: falhas, nao_exercitadas: Object.entries(spec.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)).filter((k) => !exercitadas.has(k)),
    }, null, 2));
    await h.descer();
  });

  it('CT-01: Toda rota do servidor está documentada no openapi.json (e vice-versa)', () => {
    process.env.RODAR_ROTINAS = 'false';
    const rotas = listarRotas(criarApp()).filter((r) => !r.caminho.startsWith('/simulador'));
    const doServidor = new Set(rotas.map((r) => `${r.metodo} ${r.caminho.replace(/:(\w+)/g, '{$1}')}`));
    const doContrato = new Set(Object.entries(spec.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)));
    assert.deepEqual([...doServidor].filter((x) => !doContrato.has(x)), [], 'rotas sem contrato');
    assert.deepEqual([...doContrato].filter((x) => !doServidor.has(x)), [], 'contrato sem rota');
  });

  it('CT-02: Respostas reais obedecem aos schemas em todo o ciclo de uso', async () => {
    const adminR = await h.req('POST', '/api/auth/login', { corpo: { identificador: 'admin@teste.dev', senha: 'admin-teste-123' } });
    validarResposta('POST', '/api/auth/login', adminR.status, adminR.body);
    const admin = C(adminR.body.token);
    const anon = C(null);
    await anon.get('/saude');
    await anon.post('/auth/login', { identificador: 'ninguem@x.dev', senha: 'x' });
    await anon.get('/auth/eu');
    const planos = (await admin.get('/admin/planos')).body;
    const plano = await admin.post('/admin/planos', { nome: 'Contrato', preco_centavos: 1500, limite_filhos: 50 });
    await admin.patch(`/admin/planos/${plano.body.id}`, { preco_centavos: 1600 });
    await admin.post('/admin/planos', { nome: '' });
    const cr = await admin.post('/admin/terreiros', { nome: 'Casa do Contrato', documento: h.gerarCpf(777), responsavel_nome: 'Pai Contrato', email: 'contrato@teste.dev', plano_id: planos[1].id, telefone: '11991112222' });
    await admin.post('/admin/terreiros', { nome: 'Dup', documento: h.gerarCpf(777), responsavel_nome: 'x', email: 'd@teste.dev' });
    const tid = cr.body.terreiro.id;
    const conv = h.tokenDoLink(cr.body.convite.link);
    await anon.get(`/convites/${conv}`);
    await anon.get('/convites/token-invalido');
    const ac = await anon.post('/convites/aceitar', { token: conv, senha: 'senha-forte-1' });
    const sac = C(ac.body.token);
    await sac.get('/auth/eu');
    await admin.get('/admin/terreiros');
    await admin.get(`/admin/terreiros/${tid}`);
    await admin.get('/admin/metricas');
    await admin.get('/admin/faturas');
    await admin.get('/admin/auditoria');
    await sac.get('/admin/metricas');

    const T = (c = '') => `/t/${tid}${c}`;
    await sac.get(T());
    await sac.patch(T(), { tradicao: 'Umbanda' });
    await sac.post(T('/onboarding'), { etapa: 'tradicao', situacao: 'feita' });
    await sac.post(T('/onboarding'), { etapa: 'xyz', situacao: 'feita' });
    const conta = await sac.post(T('/conta-recebimento'), { nome: 'Casa', documento: h.gerarCpf(777), email: 'contrato@teste.dev' });
    await h.req('POST', `/api/simulador/aprovar-conta/${conta.body.gateway_conta_id}`, { corpo: {} });
    await sac.post(T('/conta-recebimento'), { nome: 'Casa', documento: h.gerarCpf(777), email: 'contrato@teste.dev' });
    const ents = (await sac.get(T('/entidades'))).body;
    await sac.post(T('/entidades'), { tipo: 'entidade', nome: 'Zé Pelintra' });
    await sac.post(T('/entidades'), { tipo: 'entidade', nome: 'Zé Pelintra' });
    await sac.patch(T(`/entidades/${ents[0].id}`), { oculto: true });
    const srv = (await sac.get(T('/servicos'))).body;
    await sac.post(T('/servicos'), { nome: 'Sacudimento', preco_sugerido_centavos: 12000 });
    await sac.patch(T(`/servicos/${srv[0].id}`), { preco_sugerido_centavos: 35000 });
    const grupos = (await sac.get(T('/grupos'))).body;
    const gNovo = await sac.post(T('/grupos'), { nome: 'Coral' });
    await sac.del(T(`/grupos/${gNovo.body.id}`));
    const aux = await sac.post(T('/auxiliares'), { nome: 'Ogã', email: 'oga.contrato@teste.dev' });
    await sac.get(T('/auxiliares'));
    await sac.patch(T(`/auxiliares/${aux.body.id}`), { permissoes: { financeiro: true } });
    await sac.get(T('/assinatura'));
    await sac.post(T('/assinatura/consentir-suporte'), { horas: 1 });

    // filhos
    const f1 = await sac.post(T('/filhos'), { nome_civil: 'Ana Contrato', telefone: '11988880001', pai_cabeca: 'Ogum', grupos: [grupos[0].id] });
    await sac.post(T('/filhos'), { nome_civil: 'Dup', telefone: '11988880001' });
    await sac.post(T('/filhos'), { telefone: '11988880009' });
    const f2 = await sac.post(T('/filhos'), { nome_civil: 'Bruno Contrato', telefone: '11988880002' });
    await sac.get(T('/filhos'));
    await sac.get(T(`/filhos/${f1.body.id}`));
    await sac.patch(T(`/filhos/${f1.body.id}`), { nome_santo: 'Filha de Ogum' });
    await sac.put(T(`/filhos/${f1.body.id}/grupos`), { ids: [grupos[0].id, grupos[1].id] });
    await sac.patch(T(`/filhos/${f2.body.id}/financeiro`), { desconto: { tipo: 'percentual', valor: 10 } });
    const cv = await sac.post(T(`/filhos/${f1.body.id}/convite`));
    const acF = await anon.post('/convites/aceitar', { token: h.tokenDoLink(cv.body.link), senha: 'senha-filho-1', consentimento: true, consentimento_religioso: true });
    const fil = C(acF.body.token);
    await sac.post(T(`/filhos/${f2.body.id}/obrigacoes`), { tipo: 'Obrigação de 1 ano', data: '2026-01-10' });
    await sac.get(T(`/filhos/${f2.body.id}/obrigacoes`));
    await sac.post(T(`/filhos/${f2.body.id}/afastar`));
    await sac.post(T(`/filhos/${f2.body.id}/reativar`));
    await sac.post(T(`/filhos/${f2.body.id}/bloquear`), { motivo: 'teste' });
    await sac.post(T(`/filhos/${f2.body.id}/bloquear`));
    await sac.post(T(`/filhos/${f2.body.id}/desbloquear`));
    const f3 = await sac.post(T('/filhos'), { nome_civil: 'Carla Contrato', telefone: '11988880003' });
    await sac.post(T(`/filhos/${f3.body.id}/desligar`));
    await sac.del(T(`/filhos/${f3.body.id}`), {});
    await sac.del(T(`/filhos/${f3.body.id}`), { pedido_do_titular: true });

    // mensalidade, cobranças, lotes, trabalhos
    await sac.get(T('/mensalidade'));
    await sac.put(T('/mensalidade'), { ativa: true, valor_centavos: 5000, gerar_agora: true });
    await sac.put(T('/mensalidade'), { ativa: true });
    const c1 = await sac.post(T('/cobrancas'), { filho_id: f1.body.id, descricao: 'Velas', valor_centavos: 2500, vencimento: '2099-01-10' });
    await sac.post(T('/cobrancas'), { filho_id: f1.body.id, descricao: 'x', valor_centavos: 10, vencimento: '2099-01-10' });
    await sac.get(T('/cobrancas'));
    await sac.get(T('/cobrancas?situacao=vencida'));
    await sac.get(T('/cobrancas?situacao=xyz'));
    await sac.get(T(`/cobrancas/${c1.body.id}`));
    await sac.get(T('/cobrancas/00000000-0000-0000-0000-000000000000'));
    await sac.post(T('/lotes/previa'), { valor_centavos: 4000 });
    await sac.post(T('/lotes/previa'), {});
    const lote = await sac.post(T('/lotes'), { descricao: 'Festa', valor_centavos: 4000, vencimento: '2099-11-30' });
    await sac.get(T('/lotes'));
    const cl = (await sac.get(T(`/cobrancas?lote_id=${lote.body.id}`))).body.itens[0];
    await sac.post(T(`/cobrancas/${cl.id}/cancelar`), {});
    await sac.post(T(`/cobrancas/${cl.id}/cancelar`), { motivo: 'erro' });
    await sac.post(T(`/cobrancas/${cl.id}/baixa`), {});
    const tr = await sac.post(T('/trabalhos'), { filho_id: f1.body.id, servico_id: srv[0].id, data: '2099-03-01T09:00:00-03:00', preceitos: 'Roupa branca' });
    await sac.post(T('/trabalhos'), { filho_id: f1.body.id });
    await sac.get(T('/trabalhos'));
    await sac.post(T(`/trabalhos/${tr.body.trabalho.id}/cancelar`), {});
    await sac.post(T(`/trabalhos/${tr.body.trabalho.id}/cancelar`), { cancelar_cobranca: true });
    await sac.post(T(`/trabalhos/${tr.body.trabalho.id}/cancelar`), { cancelar_cobranca: true });

    // pagamento (US-28)
    await fil.get(T('/meu/cobrancas'));
    await fil.get(T(`/meu/cobrancas/${c1.body.id}`));
    await fil.get(T(`/meu/cobrancas/${c1.body.id}/recibo`));
    const pg = await h.pagarNoSimulador(c1.body.gateway_id);
    await anon.post('/webhooks/gateway', pg.body.evento);
    await fil.get(T(`/meu/cobrancas/${c1.body.id}/recibo`));
    await sac.post(T(`/cobrancas/${c1.body.id}/estornar`), { motivo: 'Teste de contrato' });
    const c2 = await sac.post(T('/cobrancas'), { filho_id: f1.body.id, descricao: 'Dinheiro', valor_centavos: 1000, vencimento: '2099-01-10' });
    await sac.post(T(`/cobrancas/${c2.body.id}/baixa`), { forma: 'dinheiro' });

    // agenda e mural
    const ev = await sac.post(T('/eventos'), { tipo: 'gira', titulo: 'Gira', inicio: '2099-05-01T19:30:00-03:00', recorrencia: { freq: 'semanal', ate: '2099-05-22' } });
    await sac.post(T('/eventos'), { tipo: 'gira', titulo: 'x', inicio: 'nao-data' });
    await sac.get(T('/eventos?de=2099-05-01&ate=2099-05-31'));
    await sac.get(T('/eventos?de=xyz'));
    const e0 = ev.body.eventos[0].id;
    await sac.patch(T(`/eventos/${ev.body.eventos[1].id}`), { titulo: 'Gira de Preto-velho' });
    await sac.post(T(`/eventos/${ev.body.eventos[3].id}/cancelar`), {});
    await sac.post(T(`/eventos/${ev.body.eventos[3].id}/cancelar`), {});
    const com = await sac.post(T(`/eventos/${e0}/comunicar`), { preceitos: ['Roupa branca'] });
    await fil.post(T(`/eventos/${e0}/presenca`), { resposta: 'vou' });
    await fil.post(T(`/eventos/${e0}/presenca`), { resposta: 'talvez' });
    await sac.post(T(`/eventos/${e0}/checkin`), { filho_id: f1.body.id });
    await sac.get(T(`/eventos/${e0}/presencas`));
    const av = await sac.post(T('/avisos'), { titulo: 'Aviso de contrato', publico: { tipo: 'grupos', ids: [grupos[0].id] } });
    await sac.post(T('/avisos'), { publico: { tipo: 'todos' } });
    await sac.get(T('/avisos'));
    await fil.get(T('/avisos'));
    await fil.post(T(`/avisos/${av.body.id}/lido`));
    await sac.get(T(`/avisos/${av.body.id}/leituras`));
    await sac.patch(T(`/avisos/${av.body.id}`), { fixado: true });
    await sac.del(T(`/avisos/${com.body.id}`));
    await sac.del(T(`/avisos/${com.body.id}`));
    const faixa = await sac.post(T('/buzios/disponibilidade'), { dia_semana: 1, hora_inicio: '09:00', hora_fim: '11:00', valor_centavos: 15000 });
    await sac.post(T('/buzios/disponibilidade'), { dia_semana: 9, hora_inicio: '09:00', hora_fim: '08:00' });
    await sac.get(T('/buzios/disponibilidade'));
    const horas = (await sac.get(T('/buzios/horarios?data=2099-06-01'))).body;
    await sac.get(T('/buzios/horarios'));
    await fil.post(T('/buzios/agendar'), { inicio: horas[0].inicio });
    await sac.post(T('/buzios/agendar'), { inicio: horas[0].inicio, consulente: { nome: 'X' } });
    await sac.post(T('/buzios/bloqueios'), { data: '2099-06-08' });
    await sac.post(T('/buzios/agendar'), { inicio: '2099-06-08T09:00:00-03:00', consulente: { nome: 'X' } });
    await sac.del(T('/buzios/bloqueios/2099-06-08'));
    await sac.del(T(`/buzios/disponibilidade/${faixa.body.id}`));

    // despesas, dashboard, relatório
    const d = await sac.post(T('/despesas'), { categoria: 'velas', valor_centavos: 3000 });
    await sac.post(T('/despesas'), { categoria: 'xyz', valor_centavos: 3000 });
    await sac.get(T('/despesas'));
    await sac.del(T(`/despesas/${d.body.id}`));
    await sac.get(T('/dashboard'));
    await sac.get(T('/dashboard?competencia=13-2026'));
    await sac.get(T('/auditoria'));
    const csv = await h.req('GET', `/api/t/${tid}/relatorios/cobrancas.csv?de=2020-01-01&ate=2099-12-31`, { token: sac.token });
    validarResposta('GET', `/api/t/${tid}/relatorios/cobrancas.csv`, csv.status, null);

    // área do filho
    await fil.get(T('/meu/inicio'));
    await fil.get(T('/meu/perfil'));
    await fil.patch(T('/meu/perfil'), { nome_santo: 'Filha de Ogum' });
    await fil.patch(T('/meu/perfil'), { pai_cabeca: 'Xangô' });
    await fil.get(T('/meu/dados'));
    await fil.post(T('/meu/consentimento'), { religioso: true });
    await fil.post(T('/meu/pedido-exclusao'), { motivo: 'teste' });
    await fil.get(T('/filhos'));
    await sac.get(T('/meu/inicio'));

    // admin: ciclo de vida do terreiro
    await admin.post('/admin/rotinas/rodar', {});
    await admin.post(`/admin/terreiros/${tid}/bloquear`, { motivo: 'teste' });
    await sac.get(T());
    await admin.post(`/admin/terreiros/${tid}/desbloquear`);
    await admin.post(`/admin/terreiros/${tid}/encerrar`);
    await admin.get(`/admin/terreiros/${tid}/exportacao`);
    await admin.get('/admin/terreiros/00000000-0000-0000-0000-000000000000');
    await sac.post('/auth/logout');

    assert.deepEqual(falhas, [], 'violações de contrato');
  });

  it('CT-03: Cobertura do contrato ≥ 95% das operações exercitadas', () => {
    const total = Object.values(spec.paths).reduce((s, p) => s + Object.keys(p).length, 0);
    const pct = (exercitadas.size * 100) / total;
    const faltam = Object.entries(spec.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)).filter((k) => !exercitadas.has(k));
    assert.ok(pct >= 95, `cobertura ${pct.toFixed(1)}%; faltam: ${faltam.join(', ')}`);
  });
});

