-- Terreiro Hub — esquema inicial
-- Todo dado de negócio carrega terreiro_id (RN-01). Valores em centavos.

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text unique,
  telefone text unique,
  senha_hash text,
  is_admin boolean not null default false,
  dois_fatores boolean not null default false,
  tentativas_login int not null default 0,
  bloqueado_ate timestamptz,
  created_at timestamptz not null default now(),
  check (email is not null or telefone is not null)
);

create table sessoes (
  token_hash text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  expira_em timestamptz not null,
  impersonado_por uuid references usuarios(id),
  created_at timestamptz not null default now()
);
create index sessoes_usuario on sessoes(usuario_id);

create table planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  preco_centavos int not null check (preco_centavos >= 0),
  limite_filhos int,               -- null = ilimitado
  recursos jsonb not null default '{}',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create type status_terreiro as enum ('teste','ativo','aviso','somente_leitura','bloqueado','encerrado');

create table terreiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text not null unique,          -- CPF ou CNPJ, só dígitos
  tradicao text,
  responsavel_nome text not null,
  email text not null,
  telefone text,
  endereco text,
  logo_url text,
  cor text default '#0F5C4D',
  status status_terreiro not null default 'teste',
  status_manual boolean not null default false,  -- bloqueio pelo admin não é desfeito pela régua
  motivo_bloqueio text,
  plano_id uuid references planos(id),
  teste_ate date,
  dia_faturamento int not null default 1 check (dia_faturamento between 1 and 28),
  nomenclatura jsonb not null default '{}',
  onboarding jsonb not null default '{}',
  mensalidade jsonb not null default '{}',     -- {ativa, valor, dia_geracao, dia_vencimento, entrada:'integral'|'proporcional'}
  regras jsonb not null default '{}',          -- {cancelamento_buzios_horas}
  gateway_conta_id text,
  gateway_conta_status text not null default 'nao_conectada', -- nao_conectada|pendente|aprovada|recusada
  suporte_consentido_ate timestamptz,
  encerrado_em timestamptz,
  export_url text,
  created_at timestamptz not null default now()
);

create table vinculos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  papel text not null check (papel in ('sacerdote','auxiliar','filho')),
  permissoes jsonb not null default '{}',
  filho_id uuid,
  convite_token_hash text,
  convite_expira timestamptz,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index vinculos_usuario on vinculos(usuario_id);
create index vinculos_terreiro on vinculos(terreiro_id);
create unique index vinculos_unico on vinculos(usuario_id, terreiro_id) where usuario_id is not null;

create table faturas_saas (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  competencia text not null,               -- YYYY-MM
  valor_centavos int not null,
  vencimento date not null,
  status text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  gateway_id text unique,
  pix_copia_cola text,
  boleto_linha text,
  pago_em timestamptz,
  created_at timestamptz not null default now(),
  unique (terreiro_id, competencia)
);

create table entidades_casa (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  tipo text not null check (tipo in ('orixa','entidade')),
  nome text not null,
  oculto boolean not null default false,
  unique (terreiro_id, tipo, nome)
);

create table servicos (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  nome text not null,
  preco_sugerido_centavos int not null default 0,
  duracao_min int,
  ativo boolean not null default true,
  unique (terreiro_id, nome)
);

create table grupos (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  nome text not null,
  unique (terreiro_id, nome)
);

create type status_filho as enum ('ativo','afastado','bloqueado','desligado');

create table filhos (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  usuario_id uuid references usuarios(id),
  nome_civil text not null,
  nome_santo text,
  nascimento date,
  cpf text,
  telefone text,
  email text,
  foto_url text,
  pai_cabeca text,
  mae_cabeca text,
  juntos jsonb not null default '[]',
  guias jsonb not null default '[]',
  data_entrada date default current_date,
  status status_filho not null default 'ativo',
  isento boolean not null default false,
  desconto jsonb,                           -- {tipo:'valor'|'percentual', valor}
  convite_status text not null default 'nao_enviado', -- nao_enviado|convidado|ativo|expirado
  consentimento_em timestamptz,
  consentimento_versao text,
  consentimento_ip text,
  consentimento_religioso boolean not null default false,
  anonimizado boolean not null default false,
  desligado_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index filhos_telefone_unico on filhos(terreiro_id, telefone) where not anonimizado and telefone is not null;
create index filhos_terreiro_status on filhos(terreiro_id, status);
alter table vinculos add constraint vinculos_filho_fk foreign key (filho_id) references filhos(id) on delete set null;

create table filho_grupos (
  filho_id uuid not null references filhos(id) on delete cascade,
  grupo_id uuid not null references grupos(id) on delete cascade,
  primary key (filho_id, grupo_id)
);
create index filho_grupos_grupo on filho_grupos(grupo_id);

create table obrigacoes (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  filho_id uuid not null references filhos(id) on delete cascade,
  tipo text not null,
  data date not null,
  observacao text,
  created_at timestamptz not null default now()
);
create index obrigacoes_filho on obrigacoes(filho_id);

create table eventos (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  tipo text not null check (tipo in ('gira','obrigacao','trabalho','buzios','festa','outro')),
  titulo text not null,
  descricao text,
  inicio timestamptz not null,
  fim timestamptz,
  serie_id uuid,
  regra_recorrencia jsonb,
  cancelado boolean not null default false,
  publico boolean not null default true,
  filho_id uuid references filhos(id) on delete set null,
  consulente jsonb,
  valor_centavos int,
  created_at timestamptz not null default now()
);
create index eventos_terreiro_inicio on eventos(terreiro_id, inicio);
create unique index buzios_sem_conflito on eventos(terreiro_id, inicio) where tipo = 'buzios' and not cancelado;

create table buzios_disponibilidade (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fim time not null,
  duracao_min int not null default 60,
  valor_centavos int not null default 0
);
create table buzios_bloqueios (
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  data date not null,
  primary key (terreiro_id, data)
);

create table presencas (
  evento_id uuid not null references eventos(id) on delete cascade,
  filho_id uuid not null references filhos(id) on delete cascade,
  resposta text check (resposta in ('vou','nao_vou')),
  checkin_em timestamptz,
  updated_at timestamptz not null default now(),
  primary key (evento_id, filho_id)
);

create table avisos (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  titulo text not null,
  texto text,
  imagem_url text,
  anexo_url text,
  publico jsonb not null default '{"tipo":"todos"}',  -- {tipo:'todos'} | {tipo:'grupos', ids:[]} | {tipo:'filhos', ids:[]}
  fixado boolean not null default false,
  valido_ate date,
  evento_id uuid references eventos(id) on delete set null,
  preceitos text[],
  categoria text not null default 'aviso',   -- aviso|gira|privado
  autor_id uuid references usuarios(id),
  created_at timestamptz not null default now()
);
create index avisos_terreiro on avisos(terreiro_id, created_at desc);

create table aviso_leituras (
  aviso_id uuid not null references avisos(id) on delete cascade,
  filho_id uuid not null references filhos(id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (aviso_id, filho_id)
);

create table lotes (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  descricao text not null,
  valor_centavos int not null,
  vencimento date not null,
  publico jsonb not null,
  quantidade int not null,
  total_centavos bigint not null,
  created_by uuid references usuarios(id),
  created_at timestamptz not null default now()
);

create type status_cobranca as enum ('aguardando_conta','aberta','paga','cancelada','estornada');

create table cobrancas (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  filho_id uuid references filhos(id) on delete set null,
  consulente jsonb,
  descricao text not null,
  valor_centavos int not null check (valor_centavos > 0),
  desconto_centavos int not null default 0,
  vencimento date not null,
  status status_cobranca not null default 'aberta',
  origem text not null check (origem in ('mensalidade','lote','trabalho','avulsa','buzios')),
  competencia text,
  lote_id uuid references lotes(id) on delete set null,
  trabalho_id uuid,
  parcela int,
  parcelas int,
  gateway_id text unique,
  pix_copia_cola text,
  boleto_linha text,
  pago_em timestamptz,
  forma_pagamento text,
  comprovante_url text,
  motivo text,
  recibo_numero bigint,
  created_by uuid references usuarios(id),
  created_at timestamptz not null default now()
);
create index cobrancas_terreiro_status_venc on cobrancas(terreiro_id, status, vencimento);
create index cobrancas_filho on cobrancas(filho_id, vencimento desc);
create index cobrancas_terreiro_pago on cobrancas(terreiro_id, pago_em) where status = 'paga';
create unique index cobrancas_mensalidade_unica on cobrancas(filho_id, competencia) where origem = 'mensalidade' and status <> 'cancelada';
create sequence recibos_seq;

create table trabalhos (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  filho_id uuid not null references filhos(id) on delete cascade,
  servico_id uuid references servicos(id) on delete set null,
  nome text not null,
  valor_centavos int not null,
  data timestamptz not null,
  preceitos text,
  status text not null default 'agendado' check (status in ('agendado','realizado','cancelado')),
  evento_id uuid references eventos(id) on delete set null,
  aviso_id uuid references avisos(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table cobrancas add constraint cobrancas_trabalho_fk foreign key (trabalho_id) references trabalhos(id) on delete set null;

create table despesas (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid not null references terreiros(id) on delete cascade,
  categoria text not null,
  descricao text,
  valor_centavos int not null check (valor_centavos > 0),
  data date not null,
  created_by uuid references usuarios(id),
  created_at timestamptz not null default now()
);
create index despesas_terreiro_data on despesas(terreiro_id, data);

create table webhook_eventos (
  evento_id text primary key,
  tipo text not null,
  payload jsonb not null,
  recebido_em timestamptz not null default now()
);

create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  terreiro_id uuid references terreiros(id) on delete cascade,
  filho_id uuid references filhos(id) on delete cascade,
  usuario_id uuid references usuarios(id) on delete cascade,
  canal text not null check (canal in ('push','whatsapp','email')),
  titulo text not null,
  texto text not null,
  referencia text,
  enviada_em timestamptz,
  created_at timestamptz not null default now()
);
create index notificacoes_filho on notificacoes(filho_id, created_at desc);

create table auditoria (
  id bigserial primary key,
  terreiro_id uuid,
  usuario_id uuid,
  acao text not null,
  entidade text not null,
  entidade_id text,
  dados jsonb,
  created_at timestamptz not null default now()
);
create index auditoria_terreiro on auditoria(terreiro_id, created_at desc);

-- RNF-06: log imutável
create function auditoria_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'auditoria é somente inserção';
end $$;
create trigger auditoria_sem_update before update or delete on auditoria
  for each row execute function auditoria_imutavel();
