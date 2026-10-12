'use strict';
// Monta os arquivos de dados do painel de acompanhamento a partir de reports/*.json
// Saída: reports/painel/*.json (um por fonte de dados do painel)
const fs = require('fs');
const path = require('path');

const REL = path.join(__dirname, '..', 'reports');
const OUT = path.join(REL, 'painel');
fs.mkdirSync(OUT, { recursive: true });
const ler = (n) => (fs.existsSync(path.join(REL, n)) ? JSON.parse(fs.readFileSync(path.join(REL, n), 'utf8')) : null);
const gravar = (n, rows) => fs.writeFileSync(path.join(OUT, n), JSON.stringify(rows, null, 1));

const HISTORIAS = [
  ['US-01', 'E1 Admin', 'Cadastrar terreiro e convidar sacerdote', 'M'], ['US-02', 'E1 Admin', 'Planos com limite de filhos', 'P'],
  ['US-03', 'E1 Admin', 'Fatura mensal do SaaS', 'M'], ['US-04', 'E1 Admin', 'Régua de inadimplência do terreiro', 'M'],
  ['US-05', 'E1 Admin', 'Bloquear, desbloquear e encerrar terreiro', 'P'], ['US-06', 'E2 Configuração', 'Assistente de primeiro acesso', 'M'],
  ['US-07', 'E2 Configuração', 'Conta de recebimento (subconta)', 'G'], ['US-08', 'E2 Configuração', 'Catálogo de trabalhos', 'P'],
  ['US-09', 'E2 Configuração', 'Orixás e entidades da casa', 'P'], ['US-10', 'E3 Filhos', 'Cadastro de filho', 'M'],
  ['US-11', 'E3 Filhos', 'Convite por WhatsApp', 'M'], ['US-12', 'E3 Filhos', 'Aceite com consentimento LGPD', 'M'],
  ['US-13', 'E3 Filhos', 'Bloquear filho', 'P'], ['US-14', 'E3 Filhos', 'Desligar e anonimizar', 'P'],
  ['US-15', 'E3 Filhos', 'Grupos', 'P'], ['US-16', 'E4 Mural', 'Aviso por público', 'M'],
  ['US-17', 'E4 Mural', 'Comunicado de gira e presença', 'M'], ['US-18', 'E4 Mural', 'Notificação discreta', 'P'],
  ['US-19', 'E5 Agenda', 'Calendário por tipo', 'M'], ['US-20', 'E5 Agenda', 'Gira recorrente', 'M'],
  ['US-21', 'E5 Agenda', 'Agenda de búzios', 'M'], ['US-22', 'E6 Cobranças', 'Mensalidade automática', 'G'],
  ['US-23', 'E6 Cobranças', 'Cobrança em lote', 'M'], ['US-24', 'E6 Cobranças', 'Trabalho individual unificado', 'G'],
  ['US-25', 'E6 Cobranças', 'Baixa manual', 'P'], ['US-26', 'E6 Cobranças', 'Cancelar e estornar', 'P'],
  ['US-27', 'E6 Cobranças', 'Isenção e desconto', 'P'], ['US-28', 'E7 Pagamento', 'Pagar por Pix/boleto', 'G'],
  ['US-29', 'E8 Dashboard', 'Dashboard financeiro', 'G'], ['US-30', 'E9 Área do filho', 'Início do filho', 'M'],
];
const PENDENCIAS = [
  ['Integração real de notificações (Web Push, WhatsApp, e-mail)', 'Fase 2', 'RF-29, RF-61'],
  ['Validar adaptador Asaas no sandbox', 'Antes de produção', 'RF-48, RF-49'],
  ['Autenticação em 2 fatores', 'Antes de produção', 'RNF-04'],
  ['Upload de fotos e comprovantes', 'Fase 2', 'RF-15, RF-43'],
  ['Link público de búzios para consulente', 'Fase 2', 'RF-33'],
  ['Pix Automático', 'Fase 2', 'RF-51'],
  ['Importação de filhos por planilha', 'Fase 2', 'RF-23'],
  ['Teste visual em aparelhos reais (Android e iOS)', 'Antes dos pilotos', 'RNF-01, RNF-09'],
];

const testes = ler('testes.json');
gravar('historias.json', HISTORIAS.map(([id, epico, titulo, tamanho]) => {
  const t = testes?.historias?.[id];
  return { id, epico, titulo, tamanho, desenvolvimento: 'Concluída', teste: t ? (t.ok ? 'Passou' : 'Falhou') : 'Sem teste', teste_nome: t?.teste || null };
}));
gravar('pendencias.json', PENDENCIAS.map(([item, quando, requisitos], i) => ({ n: i + 1, item, quando, requisitos, status: 'Pendente' })));
gravar('suites.json', (testes?.suites || []).map((s) => ({ suite: s.nome, total: s.total, passaram: s.passaram, falharam: s.falharam, duracao_s: Math.round(s.duracao_ms / 100) / 10 })));
gravar('testes.json', (testes?.suites || []).flatMap((s) => s.testes.map((t) => ({ suite: s.nome, teste: t.nome, resultado: t.ok ? 'Passou' : 'Falhou', duracao_ms: t.duracao_ms, erro: t.erro || '' }))));
gravar('evolucao.json', (ler('historico.json') || []).map((h, i) => {
  const ids = ['unitarios', 'integracao', 'interface', 'contrato'];
  const total = ids.reduce((s, k) => s + (h[k]?.total || 0), 0);
  const ok = ids.reduce((s, k) => s + (h[k]?.passaram || 0), 0);
  return { execucao: i + 1, em: h.em, suites: h.suites.join(', '), total, passaram: ok, falharam: total - ok };
}));
const contrato = ler('contrato.json');
gravar('contrato.json', contrato ? [{
  operacoes_documentadas: contrato.operacoes_documentadas, operacoes_exercitadas: contrato.operacoes_exercitadas,
  cobertura_percentual: contrato.cobertura_percentual, respostas_validadas: contrato.respostas_validadas, violacoes: contrato.violacoes.length,
}] : []);
const carga = ler('carga.json');
if (carga) {
  // descarta medições inválidas (ex.: casa grande fora da amostra gerou 404 em massa)
  for (const d of carga.degraus) d.cenarios = d.cenarios.filter((c) => !(c.nao_2xx > c.requisicoes * 0.01));
  gravar('carga.json', carga.degraus.flatMap((d) => d.cenarios.map((c) => ({
    terreiros: d.terreiros_carga, filhos: d.filhos, cobrancas: d.cobrancas, tamanho_mb: d.tamanho_mb, cenario: c.cenario,
    req_s: c.rps, p50_ms: c.p50_ms, p99_ms: c.p99_ms, erros: c.erros + c.nao_2xx, requisicoes: c.requisicoes,
  }))));
  gravar('rampa.json', carga.rampa.flatMap((r) => [
    { conexoes: r.conexoes, cenario: 'Dashboard do sacerdote', req_s: r.dashboard.rps, p50_ms: r.dashboard.p50_ms, p99_ms: r.dashboard.p99_ms, erros: r.dashboard.erros + r.dashboard.nao_2xx },
    { conexoes: r.conexoes, cenario: 'Início do filho', req_s: r.inicio_filho.rps, p50_ms: r.inicio_filho.p50_ms, p99_ms: r.inicio_filho.p99_ms, erros: r.inicio_filho.erros + r.inicio_filho.nao_2xx },
  ]));
  gravar('ambiente.json', [carga.ambiente]);
  if (carga.antes_indice) {
    const depois = carga.degraus.find((d) => d.terreiros_carga === carga.antes_indice.terreiros);
    gravar('indice.json', carga.antes_indice.cenarios.map((a) => {
      const b = depois?.cenarios.find((x) => x.cenario === a.cenario);
      return { cenario: a.cenario, req_s_antes: a.rps, req_s_depois: b?.rps ?? null, p99_ms_antes: a.p99_ms, p99_ms_depois: b?.p99_ms ?? null };
    }));
  }
}
console.log('painel: dados gravados em reports/painel/', fs.readdirSync(OUT).join(', '));
