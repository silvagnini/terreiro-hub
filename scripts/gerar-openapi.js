'use strict';
// Gera openapi.json — o contrato público da API. Rode: node scripts/gerar-openapi.js
const fs = require('fs');
const path = require('path');

const S = (type, extra = {}) => ({ type, ...extra });
const N = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const arr = (items) => ({ type: 'array', items });
const obj = (props, required = Object.keys(props)) => ({ type: 'object', properties: props, required });
const uuid = S('string', { format: 'uuid' });
const uuidN = N('string', { format: 'uuid' });
const data = S('string', { format: 'date' });
const dataN = N('string', { format: 'date' });
const ts = S('string', { format: 'date-time' });
const tsN = N('string', { format: 'date-time' });
const int = S('integer');
const intN = N('integer');
const str = S('string');
const strN = N('string');
const bool = S('boolean');
const livre = { type: 'object' };
const livreN = { type: ['object', 'null'] };

const ENUM = {
  papel: ['sacerdote', 'auxiliar', 'filho'],
  statusTerreiro: ['teste', 'ativo', 'aviso', 'somente_leitura', 'bloqueado', 'encerrado'],
  statusFilho: ['ativo', 'afastado', 'bloqueado', 'desligado'],
  convite: ['nao_enviado', 'convidado', 'ativo', 'expirado'],
  statusCobranca: ['aguardando_conta', 'aberta', 'paga', 'cancelada', 'estornada'],
  situacao: ['aguardando_conta', 'aberta', 'vencida', 'paga', 'cancelada', 'estornada'],
  origem: ['mensalidade', 'lote', 'trabalho', 'avulsa', 'buzios'],
  tipoEvento: ['gira', 'obrigacao', 'trabalho', 'buzios', 'festa', 'outro'],
  conta: ['nao_conectada', 'pendente', 'aprovada', 'recusada'],
};

const schemas = {
  Erro: obj({ erro: obj({ codigo: S('string', { enum: ['validacao', 'nao_autenticado', 'proibido', 'nao_encontrado', 'conflito', 'regra_de_negocio', 'terreiro_bloqueado', 'interno'] }), mensagem: str }, ['codigo', 'mensagem']) }),
  Ok: obj({}, []),
  Saude: obj({ ok: bool, gateway: str, versao: str }),
  Usuario: obj({ id: uuid, nome: str, email: strN, telefone: strN, is_admin: bool }),
  Vinculo: obj({ terreiro_id: uuid, papel: S('string', { enum: ENUM.papel }), permissoes: livre, filho_id: uuidN, terreiro_nome: str, terreiro_status: S('string', { enum: ENUM.statusTerreiro }), cor: strN }),
  Sessao: obj({ token: S('string', { minLength: 20 }), usuario: ref('Usuario'), vinculos: arr(ref('Vinculo')) }),
  Eu: obj({ usuario: ref('Usuario'), vinculos: arr(ref('Vinculo')) }),
  ConviteInfo: obj({ terreiro: str, papel: S('string', { enum: ENUM.papel }), nome: strN, exige_consentimento: bool, termo_versao: str }),
  Convite: obj({ token: str, link: S('string', { pattern: '#/convite/' }) }),
  Plano: obj({ id: uuid, nome: str, preco_centavos: int, limite_filhos: intN, recursos: livre, ativo: bool }),
  TerreiroAdmin: obj({ id: uuid, nome: str, documento: S('string', { pattern: '^\\d{11}(\\d{3})?$' }), status: S('string', { enum: ENUM.statusTerreiro }), responsavel_nome: str, email: str, teste_ate: dataN }, ['id', 'nome', 'documento', 'status']),
  TerreiroCriado: obj({ terreiro: ref('TerreiroAdmin'), convite: { oneOf: [ref('Convite'), { type: 'null' }] } }),
  ListaTerreiros: obj({ itens: arr(obj({ id: uuid, nome: str, status: S('string', { enum: ENUM.statusTerreiro }), filhos_ativos: int }, ['id', 'nome', 'status', 'filhos_ativos'])), total: int }),
  Fatura: obj({ id: uuid, competencia: S('string', { pattern: '^\\d{4}-\\d{2}$' }), valor_centavos: int, vencimento: data, status: S('string', { enum: ['aberta', 'paga', 'cancelada'] }), pix_copia_cola: strN, pago_em: tsN }, ['id', 'competencia', 'valor_centavos', 'vencimento', 'status']),
  TerreiroDetalheAdmin: { allOf: [ref('TerreiroAdmin'), obj({ faturas: arr(ref('Fatura')) })] },
  Metricas: obj({ terreiros_ativos: int, terreiros_teste: int, terreiros_inativos: int, mrr_centavos: int, inadimplencia_centavos: int, filhos_ativos: int, churn_30d: int }),
  ResultadoRotinas: obj({ hoje: data, faturas: obj({ competencia: str, geradas: int }), regua: obj({ mudancas: arr(livre) }), mensalidades: obj({ competencia: str, geradas: int }), lembretes: obj({ enviados: int }) }),
  Auditoria: obj({ id: int, acao: str, entidade: str, created_at: ts }, ['id', 'acao', 'entidade', 'created_at']),
  Exportacao: obj({ exportado_em: ts, terreiro: livre, filhos: arr(livre), cobrancas: arr(livre) }, ['exportado_em', 'terreiro', 'filhos', 'cobrancas']),
  Terreiro: obj({ id: uuid, nome: str, status: S('string', { enum: ENUM.statusTerreiro }), papel: S('string', { enum: ENUM.papel }), nomenclatura: livre }, ['id', 'nome', 'status', 'papel']),
  TerreiroAtualizado: obj({ id: uuid, nome: str, cor: strN }),
  Onboarding: obj({ etapas: arr(str), concluido: bool }),
  ContaRecebimento: obj({ gateway_conta_id: str, gateway_conta_status: S('string', { enum: ENUM.conta }) }),
  Entidade: obj({ id: uuid, tipo: S('string', { enum: ['orixa', 'entidade'] }), nome: str, oculto: bool }),
  Servico: obj({ id: uuid, nome: str, preco_sugerido_centavos: int, ativo: bool }),
  Grupo: obj({ id: uuid, nome: str }),
  Auxiliar: obj({ id: uuid, permissoes: livre }),
  AuxiliarCriado: obj({ id: uuid, nome: str, permissoes: livre, convite: { oneOf: [ref('Convite'), { type: 'null' }] } }),
  Consentimento: obj({ suporte_consentido_ate: ts }),
  FilhoResumo: obj({ id: uuid, nome_civil: str, telefone: strN, status: S('string', { enum: ENUM.statusFilho }), convite_status: S('string', { enum: ENUM.convite }), em_atraso: int }),
  ListaFilhos: obj({ itens: arr(ref('FilhoResumo')), total: int }),
  Filho: obj({ id: uuid, nome_civil: str, nome_santo: strN, telefone: strN, status: S('string', { enum: ENUM.statusFilho }), isento: bool, convite_status: S('string', { enum: ENUM.convite }), data_entrada: dataN }),
  FilhoDetalhe: { allOf: [ref('Filho'), obj({ grupos: arr(ref('Grupo')), obrigacoes: arr(ref('Obrigacao')), financeiro: obj({ abertas: int, em_atraso: int, total_aberto_centavos: int }) })] },
  FilhoFinanceiro: obj({ id: uuid, isento: bool, desconto: livreN }),
  ConviteFilho: obj({ link: str, whatsapp: S('string', { pattern: '^https://wa\\.me/' }), expira_em_dias: int, convite_status: S('string', { const: 'convidado' }) }),
  Obrigacao: obj({ id: uuid, tipo: str, data: data, observacao: strN }),
  Aviso: obj({ id: uuid, titulo: str, texto: strN, fixado: bool, valido_ate: dataN, evento_id: uuidN, preceitos: { type: ['array', 'null'], items: str }, categoria: S('string', { enum: ['aviso', 'gira', 'privado'] }), created_at: ts }),
  AvisoCriado: { allOf: [ref('Aviso'), obj({ destinatarios: int })] },
  AvisoStaff: { allOf: [ref('Aviso'), obj({ lidos: int, destinatarios: int })] },
  Leituras: obj({ total: int, lidos: int, itens: arr(obj({ id: uuid, nome_civil: str, lido_em: tsN })) }),
  Lido: obj({ lido: bool }),
  Presenca: obj({ resposta: S('string', { enum: ['vou', 'nao_vou'] }) }),
  Checkin: obj({ checkin: bool }),
  Presencas: obj({ vou: int, nao_vou: int, sem_resposta: int, checkins: int, itens: arr(obj({ id: uuid, nome_civil: str, resposta: N('string', { enum: ['vou', 'nao_vou', null] }) })) }),
  Evento: obj({ id: uuid, tipo: S('string', { enum: ENUM.tipoEvento }), titulo: str, inicio: ts, cancelado: bool, cor: S('string', { pattern: '^#[0-9A-Fa-f]{6}$' }) }),
  EventosCriados: obj({ serie_id: uuidN, quantidade: int, eventos: arr(ref('Evento')) }),
  Cancelados: obj({ cancelados: int }),
  Disponibilidade: obj({ horarios: arr(obj({ id: uuid, dia_semana: int, hora_inicio: str, hora_fim: str, duracao_min: int, valor_centavos: int })), bloqueios: arr(data) }),
  FaixaBuzios: obj({ id: uuid, dia_semana: int, hora_inicio: str, hora_fim: str, duracao_min: int, valor_centavos: int }),
  Bloqueio: obj({ data: data }),
  Horario: obj({ inicio: ts, duracao_min: int, valor_centavos: int }),
  Agendamento: obj({ evento: ref('Evento'), cobranca: { oneOf: [ref('Cobranca'), { type: 'null' }] } }),
  Mensalidade: obj({ ativa: bool, valor_centavos: int, dia_geracao: int, dia_vencimento: int, entrada: S('string', { enum: ['integral', 'proporcional'] }) }, []),
  Cobranca: obj({
    id: uuid, filho_id: uuidN, descricao: str, valor_centavos: int, desconto_centavos: int, valor_final_centavos: int, vencimento: data,
    status: S('string', { enum: ENUM.statusCobranca }), situacao: S('string', { enum: ENUM.situacao }), origem: S('string', { enum: ENUM.origem }),
    pix_copia_cola: N('string', { pattern: '^000201' }), boleto_linha: strN, link_pagamento: strN, pix_pendente: bool, pago_em: tsN, recibo_numero: intN,
  }),
  ListaCobrancas: obj({ itens: arr(ref('Cobranca')), total: int }),
  LotePrevia: obj({ quantidade: int, valor_centavos: int, total_centavos: int, isentos_excluidos: int, amostra: arr(str) }),
  Lote: obj({ id: uuid, descricao: str, valor_centavos: int, vencimento: data, quantidade: int, total_centavos: int }),
  TrabalhoCriado: obj({ trabalho: obj({ id: uuid, evento_id: uuid, aviso_id: uuid }), evento: ref('Evento'), cobrancas: arr(ref('Cobranca')), aviso: obj({ id: uuid, titulo: str }) }),
  Trabalho: obj({ id: uuid, filho_id: uuid, nome: str, valor_centavos: int, data: ts, status: S('string', { enum: ['agendado', 'realizado', 'cancelado'] }) }),
  TrabalhoCancelado: obj({ cancelado: bool, cobrancas_canceladas: int }),
  Despesa: obj({ id: uuid, categoria: str, valor_centavos: int, data: data }),
  Dashboard: obj({
    competencia: str, recebido_centavos: int, a_receber_centavos: int, em_atraso_centavos: int, filhos_em_atraso: int, despesas_centavos: int, saldo_centavos: int,
    mensalidades: obj({ pagas: int, total: int }), serie: S('array', { minItems: 12, maxItems: 12, items: obj({ competencia: str, receita_centavos: int, despesa_centavos: int }) }),
    receita_por_origem: arr(obj({ origem: str, valor_centavos: int })), inadimplentes: arr(obj({ id: uuid, nome_civil: str, valor: int })),
  }),
  InicioFilho: obj({
    filho: obj({ nome_civil: str }), terreiro: obj({ nome: str }),
    pendencias: obj({ quantidade: int, vencidas: int, total_centavos: int, itens: arr(ref('Cobranca')) }),
    proximo_compromisso: livreN, avisos_nao_lidos: obj({ quantidade: int, itens: arr(livre) }), mensalidade_do_mes: livreN,
  }),
  Recibo: obj({ numero: int, terreiro: str, pagador: str, descricao: str, valor_centavos: int, pago_em: ts, forma_pagamento: str }),
  Perfil: obj({ id: uuid, nome_civil: str, consentimento_religioso: bool, consentimento_versao: strN, obrigacoes: arr(livre) }),
  PerfilAtualizado: obj({ id: uuid, nome_santo: strN, email: strN, telefone: strN }),
  MeusDados: obj({ gerado_em: ts, perfil: livre, cobrancas: arr(livre), presencas: arr(livre), leituras: arr(livre) }),
  ConsentimentoReligioso: obj({ consentimento_religioso: bool }),
  PedidoExclusao: obj({ recebido: bool, mensagem: str }),
  WebhookResposta: obj({ recebido: bool }),
  Mensagem: obj({ ok: bool, mensagem: str }),
  RedefinirInfo: obj({ nome: str, expira_em: ts }),
  Preferencias: obj({ push: bool, whatsapp: bool, email: bool }, []),
  ChavePush: obj({ chave_publica: S('string', { minLength: 40 }) }),
  LinkSenha: obj({ link: S('string', { pattern: '#/redefinir/' }), expira_em_horas: int }),
  Integracoes: obj({ gateway: obj({ nome: str }), canais: obj({ push: livre, whatsapp: livre, email: livre }), fila_7_dias: arr(livre), ultimas_falhas: arr(livre) }),
  TesteIntegracao: obj({ canal: S('string', { enum: ['gateway', 'email', 'whatsapp', 'push'] }), ok: bool }),
  // Contrato do gateway (formato Asaas)
  AsaasWebhookPagamento: obj({
    id: S('string', { pattern: '^evt_' }), event: S('string', { enum: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] }), dateCreated: str,
    payment: obj({ object: S('string', { const: 'payment' }), id: S('string', { pattern: '^pay_' }), value: S('number', { exclusiveMinimum: 0 }), billingType: S('string', { enum: ['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'] }), status: S('string', { enum: ['RECEIVED', 'CONFIRMED'] }), externalReference: strN }, ['object', 'id']),
  }),
  AsaasWebhookConta: obj({ id: str, event: S('string', { pattern: '^ACCOUNT_STATUS_GENERAL_APPROVAL_(APPROVED|REJECTED)$' }), accountStatus: obj({ id: str, general: S('string', { enum: ['APPROVED', 'REJECTED'] }) }) }),
  GatewayCobranca: obj({ id: S('string', { pattern: '^pay_' }), status: S('string', { enum: ['PENDING'] }), valorCentavos: int, vencimento: data, pixCopiaCola: S('string', { pattern: '^000201.*6304[0-9A-F]{4}$' }), boletoLinha: strN }, ['id', 'status', 'pixCopiaCola']),
  GatewaySubconta: obj({ id: S('string', { minLength: 3 }), status: S('string', { enum: ['PENDING', 'APPROVED'] }) }),
};

const P = (n) => ({ name: n, in: 'path', required: true, schema: { type: 'string' } });
const resp = (status, schema, desc = 'OK') => ({ [status]: { description: desc, content: schema ? { 'application/json': { schema } } : undefined } });
const erros = (...st) => Object.assign({}, ...st.map((s) => resp(s, ref('Erro'), 'Erro')));

// [método, caminho, resumo, tag, status de sucesso, schema, erros esperados, público?]
const OPS = [
  ['get', '/saude', 'Saúde do serviço', 'Público', 200, ref('Saude'), [], true],
  ['post', '/auth/login', 'Entrar com e-mail/telefone e senha', 'Autenticação', 200, ref('Sessao'), [400, 401], true],
  ['post', '/auth/logout', 'Sair', 'Autenticação', 200, ref('Ok'), [401]],
  ['get', '/auth/eu', 'Usuário logado e seus vínculos', 'Autenticação', 200, ref('Eu'), [401]],
  ['get', '/convites/{token}', 'Dados do convite', 'Autenticação', 200, ref('ConviteInfo'), [404, 422], true],
  ['post', '/convites/aceitar', 'Aceitar convite, criar senha e consentir (US-12)', 'Autenticação', 201, ref('Sessao'), [400, 404, 422], true],
  ['post', '/webhooks/gateway', 'Webhook do gateway (formato Asaas)', 'Pagamentos', 200, ref('WebhookResposta'), [400, 401], true],
  ['post', '/auth/senha', 'Trocar a própria senha (desconecta outros aparelhos)', 'Autenticação', 200, ref('Mensagem'), [400, 401]],
  ['post', '/auth/esqueci', 'Pedir link de nova senha (e-mail ou WhatsApp)', 'Autenticação', 202, ref('Mensagem'), [400], true],
  ['get', '/auth/redefinir/{token}', 'Validar link de nova senha', 'Autenticação', 200, ref('RedefinirInfo'), [404, 422], true],
  ['post', '/auth/redefinir', 'Criar nova senha pelo link', 'Autenticação', 200, ref('Sessao'), [400, 404, 422], true],
  ['get', '/auth/preferencias', 'Canais de notificação do usuário', 'Notificações', 200, ref('Preferencias'), [401]],
  ['patch', '/auth/preferencias', 'Ligar/desligar canais de notificação (RF-61)', 'Notificações', 200, ref('Preferencias'), [400, 401]],
  ['get', '/push/chave', 'Chave pública VAPID do Web Push', 'Notificações', 200, ref('ChavePush'), [], true],
  ['post', '/push/inscricao', 'Registrar este aparelho para notificações', 'Notificações', 201, ref('Ok'), [400, 401]],
  ['delete', '/push/inscricao', 'Remover este aparelho', 'Notificações', 204, null, [401]],
  ['post', '/admin/terreiros/{id}/link-senha', 'Link de nova senha para o sacerdote', 'Admin', 200, ref('LinkSenha'), [404, 422]],
  ['get', '/admin/integracoes', 'Situação do gateway e dos canais de envio', 'Admin', 200, ref('Integracoes'), [403]],
  ['post', '/admin/integracoes/testar', 'Testar gateway, e-mail, WhatsApp ou push', 'Admin', 200, ref('TesteIntegracao'), [400, 403]],
  ['post', '/t/{tid}/filhos/{id}/link-senha', 'Link de nova senha para um filho (gerado pelo sacerdote)', 'Filhos', 200, ref('LinkSenha'), [403, 404, 422]],
  ['get', '/admin/planos', 'Listar planos', 'Admin', 200, arr(ref('Plano')), [401, 403]],
  ['post', '/admin/planos', 'Criar plano (US-02)', 'Admin', 201, ref('Plano'), [400, 403]],
  ['patch', '/admin/planos/{id}', 'Alterar plano', 'Admin', 200, ref('Plano'), [404]],
  ['get', '/admin/terreiros', 'Listar terreiros', 'Admin', 200, ref('ListaTerreiros'), [403]],
  ['post', '/admin/terreiros', 'Cadastrar terreiro e convidar sacerdote (US-01)', 'Admin', 201, ref('TerreiroCriado'), [400, 409]],
  ['get', '/admin/terreiros/{id}', 'Detalhe do terreiro com faturas', 'Admin', 200, ref('TerreiroDetalheAdmin'), [404]],
  ['post', '/admin/terreiros/{id}/bloquear', 'Bloquear terreiro (US-05)', 'Admin', 200, ref('TerreiroAdmin'), [404]],
  ['post', '/admin/terreiros/{id}/desbloquear', 'Desbloquear terreiro', 'Admin', 200, ref('TerreiroAdmin'), [404]],
  ['post', '/admin/terreiros/{id}/encerrar', 'Encerrar terreiro', 'Admin', 200, ref('TerreiroAdmin'), [404]],
  ['get', '/admin/terreiros/{id}/exportacao', 'Exportar dados do terreiro', 'Admin', 200, ref('Exportacao'), [404, 422]],
  ['get', '/admin/faturas', 'Faturas do SaaS', 'Admin', 200, arr(ref('Fatura')), [403]],
  ['get', '/admin/metricas', 'Métricas do SaaS (RF-06)', 'Admin', 200, ref('Metricas'), [403]],
  ['post', '/admin/rotinas/rodar', 'Rodar rotinas diárias', 'Admin', 200, ref('ResultadoRotinas'), [403]],
  ['get', '/admin/auditoria', 'Log de auditoria', 'Admin', 200, arr(ref('Auditoria')), [403]],
  ['get', '/t/{tid}', 'Dados do terreiro para o usuário logado', 'Terreiro', 200, ref('Terreiro'), [404, 423]],
  ['patch', '/t/{tid}', 'Alterar dados da casa', 'Terreiro', 200, ref('TerreiroAtualizado'), [403, 423]],
  ['post', '/t/{tid}/onboarding', 'Marcar etapa do assistente (US-06)', 'Terreiro', 200, ref('Onboarding'), [400]],
  ['post', '/t/{tid}/conta-recebimento', 'Solicitar subconta no gateway (US-07)', 'Terreiro', 201, ref('ContaRecebimento'), [400, 422]],
  ['get', '/t/{tid}/entidades', 'Orixás e entidades da casa', 'Terreiro', 200, arr(ref('Entidade')), []],
  ['post', '/t/{tid}/entidades', 'Criar orixá/entidade (US-09)', 'Terreiro', 201, ref('Entidade'), [400, 409]],
  ['patch', '/t/{tid}/entidades/{id}', 'Renomear ou ocultar', 'Terreiro', 200, ref('Entidade'), [404]],
  ['get', '/t/{tid}/servicos', 'Catálogo de trabalhos', 'Terreiro', 200, arr(ref('Servico')), [403]],
  ['post', '/t/{tid}/servicos', 'Criar serviço (US-08)', 'Terreiro', 201, ref('Servico'), [400, 409]],
  ['patch', '/t/{tid}/servicos/{id}', 'Alterar serviço', 'Terreiro', 200, ref('Servico'), [404]],
  ['get', '/t/{tid}/grupos', 'Grupos da casa', 'Terreiro', 200, arr(ref('Grupo')), [403]],
  ['post', '/t/{tid}/grupos', 'Criar grupo (US-15)', 'Terreiro', 201, ref('Grupo'), [400, 409]],
  ['delete', '/t/{tid}/grupos/{id}', 'Excluir grupo', 'Terreiro', 204, null, [404]],
  ['get', '/t/{tid}/auxiliares', 'Auxiliares', 'Terreiro', 200, arr(ref('Auxiliar')), [403]],
  ['post', '/t/{tid}/auxiliares', 'Convidar auxiliar (RF-14)', 'Terreiro', 201, ref('AuxiliarCriado'), [400, 409]],
  ['patch', '/t/{tid}/auxiliares/{id}', 'Alterar permissões', 'Terreiro', 200, ref('Auxiliar'), [404]],
  ['get', '/t/{tid}/assinatura', 'Faturas da assinatura', 'Terreiro', 200, arr(ref('Fatura')), [403]],
  ['post', '/t/{tid}/assinatura/consentir-suporte', 'Liberar suporte (RF-07)', 'Terreiro', 200, ref('Consentimento'), [403]],
  ['get', '/t/{tid}/auditoria', 'Auditoria do terreiro', 'Terreiro', 200, arr(ref('Auditoria')), [403]],
  ['get', '/t/{tid}/filhos', 'Listar filhos', 'Filhos', 200, ref('ListaFilhos'), [403]],
  ['post', '/t/{tid}/filhos', 'Cadastrar filho (US-10)', 'Filhos', 201, ref('Filho'), [400, 409, 422]],
  ['get', '/t/{tid}/filhos/{id}', 'Detalhe do filho', 'Filhos', 200, ref('FilhoDetalhe'), [404]],
  ['patch', '/t/{tid}/filhos/{id}', 'Alterar filho', 'Filhos', 200, ref('Filho'), [400, 403, 409]],
  ['put', '/t/{tid}/filhos/{id}/grupos', 'Definir grupos do filho', 'Filhos', 200, arr(ref('Grupo')), [400, 404]],
  ['patch', '/t/{tid}/filhos/{id}/financeiro', 'Isenção e desconto (US-27)', 'Filhos', 200, ref('FilhoFinanceiro'), [400, 404]],
  ['post', '/t/{tid}/filhos/{id}/convite', 'Gerar convite por WhatsApp (US-11)', 'Filhos', 200, ref('ConviteFilho'), [404, 422]],
  ['post', '/t/{tid}/filhos/{id}/bloquear', 'Bloquear (US-13)', 'Filhos', 200, ref('Filho'), [403, 422]],
  ['post', '/t/{tid}/filhos/{id}/desbloquear', 'Desbloquear', 'Filhos', 200, ref('Filho'), [422]],
  ['post', '/t/{tid}/filhos/{id}/afastar', 'Afastar', 'Filhos', 200, ref('Filho'), [422]],
  ['post', '/t/{tid}/filhos/{id}/desligar', 'Desligar (US-14)', 'Filhos', 200, ref('Filho'), [422]],
  ['post', '/t/{tid}/filhos/{id}/reativar', 'Reativar', 'Filhos', 200, ref('Filho'), [422]],
  ['delete', '/t/{tid}/filhos/{id}', 'Anonimizar a pedido do titular (RN-08)', 'Filhos', 204, null, [422]],
  ['get', '/t/{tid}/filhos/{id}/obrigacoes', 'Obrigações do filho', 'Filhos', 200, arr(ref('Obrigacao')), [404]],
  ['post', '/t/{tid}/filhos/{id}/obrigacoes', 'Registrar obrigação (RF-19)', 'Filhos', 201, ref('Obrigacao'), [400]],
  ['get', '/t/{tid}/avisos', 'Mural (filho vê só o seu público)', 'Mural', 200, arr(ref('Aviso')), []],
  ['post', '/t/{tid}/avisos', 'Publicar aviso (US-16)', 'Mural', 201, ref('AvisoCriado'), [400, 403]],
  ['patch', '/t/{tid}/avisos/{id}', 'Alterar aviso', 'Mural', 200, ref('Aviso'), [404]],
  ['delete', '/t/{tid}/avisos/{id}', 'Excluir aviso', 'Mural', 204, null, [404]],
  ['get', '/t/{tid}/avisos/{id}/leituras', 'Quem leu (RF-27)', 'Mural', 200, ref('Leituras'), [404]],
  ['post', '/t/{tid}/avisos/{id}/lido', 'Marcar como lido', 'Mural', 200, ref('Lido'), [404]],
  ['post', '/t/{tid}/eventos/{id}/comunicar', 'Comunicado de gira (US-17)', 'Mural', 201, ref('AvisoCriado'), [404, 422]],
  ['post', '/t/{tid}/eventos/{id}/presenca', 'Confirmar presença', 'Mural', 200, ref('Presenca'), [400, 404, 422]],
  ['post', '/t/{tid}/eventos/{id}/checkin', 'Check-in na gira', 'Mural', 200, ref('Checkin'), [404]],
  ['get', '/t/{tid}/eventos/{id}/presencas', 'Lista de presença', 'Mural', 200, ref('Presencas'), [404]],
  ['get', '/t/{tid}/eventos', 'Calendário (US-19)', 'Agenda', 200, arr(ref('Evento')), [400]],
  ['post', '/t/{tid}/eventos', 'Criar evento, com recorrência semanal (US-20)', 'Agenda', 201, ref('EventosCriados'), [400]],
  ['patch', '/t/{tid}/eventos/{id}', 'Alterar evento', 'Agenda', 200, ref('Evento'), [404]],
  ['post', '/t/{tid}/eventos/{id}/cancelar', 'Cancelar data ou série', 'Agenda', 200, ref('Cancelados'), [404, 422]],
  ['get', '/t/{tid}/buzios/disponibilidade', 'Horários de búzios', 'Agenda', 200, ref('Disponibilidade'), []],
  ['post', '/t/{tid}/buzios/disponibilidade', 'Adicionar faixa de horário (US-21)', 'Agenda', 201, ref('FaixaBuzios'), [400]],
  ['delete', '/t/{tid}/buzios/disponibilidade/{id}', 'Remover faixa', 'Agenda', 204, null, []],
  ['post', '/t/{tid}/buzios/bloqueios', 'Bloquear data', 'Agenda', 201, ref('Bloqueio'), [400]],
  ['delete', '/t/{tid}/buzios/bloqueios/{data}', 'Desbloquear data', 'Agenda', 204, null, []],
  ['get', '/t/{tid}/buzios/horarios', 'Horários livres no dia', 'Agenda', 200, arr(ref('Horario')), [400]],
  ['post', '/t/{tid}/buzios/agendar', 'Agendar búzios', 'Agenda', 201, ref('Agendamento'), [400, 409, 422]],
  ['get', '/t/{tid}/mensalidade', 'Configuração da mensalidade', 'Financeiro', 200, ref('Mensalidade'), [403]],
  ['put', '/t/{tid}/mensalidade', 'Configurar mensalidade (US-22)', 'Financeiro', 200, ref('Mensalidade'), [400, 403]],
  ['get', '/t/{tid}/cobrancas', 'Listar cobranças', 'Financeiro', 200, ref('ListaCobrancas'), [400, 403]],
  ['get', '/t/{tid}/cobrancas/{id}', 'Detalhe da cobrança', 'Financeiro', 200, ref('Cobranca'), [404]],
  ['post', '/t/{tid}/cobrancas', 'Cobrança avulsa', 'Financeiro', 201, ref('Cobranca'), [400, 422]],
  ['post', '/t/{tid}/cobrancas/{id}/baixa', 'Baixa manual (US-25)', 'Financeiro', 200, ref('Cobranca'), [404, 422]],
  ['post', '/t/{tid}/cobrancas/{id}/cancelar', 'Cancelar com motivo (US-26)', 'Financeiro', 200, ref('Cobranca'), [400, 422]],
  ['post', '/t/{tid}/cobrancas/{id}/estornar', 'Estornar (US-26)', 'Financeiro', 200, ref('Cobranca'), [400, 422]],
  ['post', '/t/{tid}/lotes/previa', 'Prévia do lote (US-23)', 'Financeiro', 200, ref('LotePrevia'), [400]],
  ['post', '/t/{tid}/lotes', 'Gerar cobranças em lote (US-23)', 'Financeiro', 201, ref('Lote'), [400, 422]],
  ['get', '/t/{tid}/lotes', 'Lotes', 'Financeiro', 200, arr(ref('Lote')), [403]],
  ['post', '/t/{tid}/trabalhos', 'Trabalho individual: agenda + cobrança + aviso (US-24)', 'Financeiro', 201, ref('TrabalhoCriado'), [400, 422]],
  ['get', '/t/{tid}/trabalhos', 'Trabalhos', 'Financeiro', 200, arr(ref('Trabalho')), [403]],
  ['post', '/t/{tid}/trabalhos/{id}/cancelar', 'Cancelar trabalho', 'Financeiro', 200, ref('TrabalhoCancelado'), [400, 404, 422]],
  ['get', '/t/{tid}/despesas', 'Despesas do mês', 'Financeiro', 200, arr(ref('Despesa')), [403]],
  ['post', '/t/{tid}/despesas', 'Lançar despesa (RF-52)', 'Financeiro', 201, ref('Despesa'), [400]],
  ['delete', '/t/{tid}/despesas/{id}', 'Excluir despesa', 'Financeiro', 204, null, [404]],
  ['get', '/t/{tid}/dashboard', 'Dashboard financeiro (US-29)', 'Financeiro', 200, ref('Dashboard'), [400, 403]],
  ['get', '/t/{tid}/relatorios/cobrancas.csv', 'Relatório CSV (RF-55)', 'Financeiro', 200, null, [400, 403]],
  ['get', '/t/{tid}/meu/inicio', 'Início do filho (US-30)', 'Área do filho', 200, ref('InicioFilho'), [403]],
  ['get', '/t/{tid}/meu/cobrancas', 'Minhas cobranças', 'Área do filho', 200, arr(ref('Cobranca')), [403]],
  ['get', '/t/{tid}/meu/cobrancas/{id}', 'Pix e boleto da minha cobrança (US-28)', 'Área do filho', 200, ref('Cobranca'), [404]],
  ['get', '/t/{tid}/meu/cobrancas/{id}/recibo', 'Recibo (RF-50)', 'Área do filho', 200, ref('Recibo'), [404, 422]],
  ['get', '/t/{tid}/meu/perfil', 'Meu perfil (RF-59)', 'Área do filho', 200, ref('Perfil'), [403]],
  ['patch', '/t/{tid}/meu/perfil', 'Alterar meus contatos', 'Área do filho', 200, ref('PerfilAtualizado'), [403, 409]],
  ['get', '/t/{tid}/meu/dados', 'Exportar meus dados (LGPD)', 'Área do filho', 200, ref('MeusDados'), [403]],
  ['post', '/t/{tid}/meu/consentimento', 'Dar ou revogar consentimento religioso', 'Área do filho', 200, ref('ConsentimentoReligioso'), [400]],
  ['post', '/t/{tid}/meu/pedido-exclusao', 'Pedir exclusão (LGPD)', 'Área do filho', 202, ref('PedidoExclusao'), []],
];

const paths = {};
for (const [m, p, resumo, tag, st, schema, errs, publico] of OPS) {
  const params = [...p.matchAll(/\{(\w+)\}/g)].map((x) => P(x[1]));
  paths[p] = paths[p] || {};
  paths[p][m] = {
    summary: resumo, tags: [tag], operationId: `${m}${p.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))}`,
    ...(params.length ? { parameters: params } : {}),
    ...(publico ? { security: [] } : {}),
    ...(['post', 'put', 'patch'].includes(m) ? { requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
    responses: { ...resp(st, schema), ...erros(...new Set([...(publico ? [] : [401]), ...errs])) },
  };
  if (st === 204) paths[p][m].responses[204] = { description: 'Sem conteúdo' };
  if (p.endsWith('.csv')) paths[p][m].responses[200] = { description: 'CSV', content: { 'text/csv': { schema: { type: 'string' } } } };
}

const spec = {
  openapi: '3.1.0',
  info: { title: 'Terreiro Hub API', version: require('../package.json').version, description: 'API da plataforma de gestão de terreiros. Valores em centavos; datas AAAA-MM-DD; horários ISO 8601 (America/Sao_Paulo).' },
  servers: [{ url: '/api' }],
  security: [{ bearer: [] }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, schemas },
  paths,
};

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'openapi.json'), JSON.stringify(spec, null, 2));
  console.log(`openapi.json: ${OPS.length} operações, ${Object.keys(schemas).length} schemas`);
}
module.exports = { spec, OPS };
