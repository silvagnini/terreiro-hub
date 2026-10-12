# Terreiro Hub

Plataforma SaaS (PWA) para sacerdotes de religiões de matriz africana gerirem a casa: filhos de santo, mural, agenda, búzios, mensalidades e trabalhos com Pix/boleto, e dashboard financeiro. Multi-terreiro, com painel de administração da plataforma.

## Stack

- **Back-end:** Node.js 20+ com Express e PostgreSQL 16 (driver `pg`). Migrações SQL em `migrations/`.
- **Front-end:** PWA sem framework (`public/`), instalável em Android e iOS e com mural e agenda disponíveis offline.
- **Pagamentos:** interface única com dois adaptadores.
  - `simulado` (padrão) imita o formato do Asaas.
  - `asaas` (API v3) está escrito, mas ainda não foi exercitado contra o sandbox.

## Rodar localmente

```bash
cp .env.example .env            # ajuste DATABASE_URL, ADMIN_EMAIL e ADMIN_SENHA
npm install
npm start                       # cria o esquema, os planos padrão e o admin; abre em http://localhost:8080
```

Com o gateway simulado, há duas rotas que fazem o papel do Asaas:

- `POST /api/simulador/pagar/:gatewayId` simula um pagamento.
- `POST /api/simulador/aprovar-conta/:contaId` simula a aprovação da subconta.

As duas disparam o webhook real do sistema.

## Testes

```bash
npm test                 # todas as suítes; grava reports/testes.json
npm run test:unit        # regras puras (datas, CPF, régua, Pix EMV/CRC16)
npm run test:api         # integração: um teste por história (US-01 a US-30) + segurança
npm run test:ui          # interface: roda public/app.js num DOM (jsdom) contra a API
npm run test:contrato    # contrato OpenAPI (rotas x documentação x respostas) e contrato do gateway
npm run carga            # carga e volume em degraus; grava reports/carga.json
```

Os testes usam o banco `terreiro_test`; a carga usa `terreiro_carga`. Configure com `TEST_DATABASE_URL` e `CARGA_DATABASE_URL`.

O contrato da API está em `openapi.json`. Para gerá-lo de novo: `npm run openapi`.

## Deploy no Railway

1. Crie um serviço a partir deste repositório e adicione um Postgres.
2. Defina estas variáveis:
   - `DATABASE_URL` (referência ao Postgres)
   - `DATABASE_SSL=true` se usar a URL pública
   - `NODE_ENV=production`
   - `APP_URL`
   - `ADMIN_EMAIL` e `ADMIN_SENHA`
   - `WEBHOOK_TOKEN`
3. O health check é `/api/saude`. As rotinas diárias rodam a cada hora:
   - fatura do SaaS
   - régua de inadimplência
   - mensalidades
   - lembretes

## Estrutura

```
src/
  app.js, server.js        servidor, migrações, setup do admin e rotinas
  auth.js                  sessões, senhas (scrypt), isolamento por terreiro, permissões
  routes/                  publico, admin, terreiro, filhos, mural, agenda, financeiro, meu (área do filho)
  services/                cobranças, rotinas (mensalidade, faturamento, régua), terreiros, auditoria e notificações
  gateway/                 simulado.js, asaas.js
public/                    PWA (index.html, app.js, app.css, sw.js, manifest)
test/                      unit, api, ui, contract
load/                      massa de dados e teste de carga
scripts/                   gerador do OpenAPI, lista de rotas, reporter e runner de testes
```

## O que ainda não está pronto

- **Notificações:** são gravadas na tabela `notificacoes` (com texto neutro), mas ainda não são enviadas.
  - Falta integrar Web Push, WhatsApp e e-mail.
  - Os convites saem como link para abrir no WhatsApp.
- **Gateway:** o adaptador Asaas real precisa ser validado no sandbox com `ASAAS_API_KEY`.
- **Fora desta entrega:**
  - autenticação em 2 fatores (o campo existe, mas não há verificação)
  - upload de arquivos (fotos e comprovantes são URLs)
  - importação por planilha
  - link público de búzios para consulente sem login
  - Pix Automático
- **Visual:** a interface foi testada em DOM simulado, ainda não em aparelhos reais.
