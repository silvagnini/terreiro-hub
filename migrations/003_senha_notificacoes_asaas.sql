-- Troca/recuperação de senha, fila real de notificações (push, WhatsApp, e-mail) e dados do Asaas

-- Notificações viram uma fila: nascem "pendente" e o despachante envia
alter table notificacoes
  add column status text not null default 'pendente' check (status in ('pendente','enviada','falhou','ignorada')),
  add column tentativas int not null default 0,
  add column erro text,
  add column link text,
  add column proxima_tentativa timestamptz not null default now();
update notificacoes set status = 'ignorada', erro = 'criada antes do envio real' where enviada_em is not null;
create index notificacoes_fila on notificacoes(proxima_tentativa) where status = 'pendente';

alter table usuarios
  add column preferencias jsonb not null default '{"push":true,"whatsapp":true,"email":true}',
  add column senha_alterada_em timestamptz;

create table recuperacoes_senha (
  token_hash text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  expira_em timestamptz not null,
  usada_em timestamptz,
  criado_por uuid references usuarios(id),
  canal text,
  created_at timestamptz not null default now()
);
create index recuperacoes_usuario on recuperacoes_senha(usuario_id, created_at desc);

create table push_inscricoes (
  endpoint text primary key,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  falhas int not null default 0,
  created_at timestamptz not null default now()
);
create index push_inscricoes_usuario on push_inscricoes(usuario_id);

-- configurações geradas pelo próprio sistema (ex.: chaves VAPID do Web Push)
create table config (
  chave text primary key,
  valor text not null
);

-- Asaas: subconta do terreiro (chave cifrada), carteira e clientes
alter table terreiros
  add column gateway_wallet_id text,
  add column gateway_api_key text,          -- cifrada (AES-256-GCM, CHAVE_CIFRA)
  add column gateway_cliente_id text;       -- cliente do terreiro na conta da plataforma (fatura do SaaS)
alter table filhos add column gateway_cliente_id text;
alter table cobrancas add column gateway_erro text, add column link_pagamento text;
create index cobrancas_sem_gateway on cobrancas(terreiro_id) where status = 'aberta' and gateway_id is null;
