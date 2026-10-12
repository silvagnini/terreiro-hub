'use strict';
const db = require('./db');
const { criarApp } = require('./app');
const { hashSenha } = require('./auth');
const jobs = require('./services/jobs');

const PLANOS_PADRAO = [
  ['Semente', 4900, 30, { auxiliares: false, relatorios: false }],
  ['Raiz', 9900, 100, { auxiliares: true, relatorios: true }],
  ['Axé', 17900, null, { auxiliares: true, relatorios: true, pix_automatico: true, whatsapp: true }],
];

async function preparar() {
  await db.migrate();
  if (!(await db.one('select 1 from planos limit 1'))) {
    for (const [nome, preco, limite, recursos] of PLANOS_PADRAO) {
      await db.query('insert into planos(nome, preco_centavos, limite_filhos, recursos) values ($1,$2,$3,$4)', [nome, preco, limite, recursos]);
    }
  }
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA;
  if (email && senha && !(await db.one('select 1 from usuarios where is_admin'))) {
    await db.query(
      `insert into usuarios(nome, email, senha_hash, is_admin, dois_fatores) values ('Admin', $1, $2, true, true)
       on conflict (email) do update set is_admin = true`,
      [email.toLowerCase(), hashSenha(senha)]
    );
    console.log(`[setup] admin criado: ${email}`);
  }
}

async function iniciar(porta = Number(process.env.PORT || 8080)) {
  await preparar();
  const app = criarApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(porta, () => resolve(s));
  });
  if (process.env.RODAR_ROTINAS !== 'false') {
    const rodar = () => jobs.rodarTudo().then((r) => console.log('[rotinas]', JSON.stringify(r))).catch((e) => console.error('[rotinas] erro', e));
    setTimeout(rodar, 10e3).unref();
    setInterval(rodar, 60 * 60e3).unref();
  }
  console.log(`[terreiro-hub] ouvindo na porta ${server.address().port}`);
  return server;
}

if (require.main === module) {
  iniciar().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { iniciar, preparar };
