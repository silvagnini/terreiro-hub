'use strict';
const { erro, campo, documentoValido, telefoneNormalizado, tokenAleatorio, sha256, relogio, somarDias } = require('../util');
const { auditar, notificar } = require('./base');

const ORIXAS = ['Exu', 'Ogum', 'Oxóssi', 'Ossaim', 'Obaluaê', 'Oxumaré', 'Xangô', 'Iansã', 'Oxum', 'Logun Edé', 'Obá', 'Ewá', 'Iemanjá', 'Nanã', 'Oxalá'];
const ENTIDADES = ['Caboclo', 'Preto-velho', 'Erê', 'Exu', 'Pombagira', 'Boiadeiro', 'Baiano', 'Marinheiro', 'Cigano', 'Malandro'];
const SERVICOS = [['Bori', 0], ['Ebó', 0], ['Amaci', 0], ['Jogo de búzios', 0], ['Feitura', 0]];
const GRUPOS = ['Corrente', 'Ogãs', 'Ekedes', 'Cambonos', 'Iniciantes'];

const APP_URL = () => process.env.APP_URL || 'http://localhost:8080';

async function gerarConvite(q, vinculoId, dias = 7) {
  const token = tokenAleatorio(24);
  await q.query(
    `update vinculos set convite_token_hash = $2, convite_expira = now() + ($3 || ' days')::interval where id = $1`,
    [vinculoId, sha256(token), String(dias)]
  );
  return { token, link: `${APP_URL()}/#/convite/${token}` };
}

function linkWhatsApp(telefone, texto) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(texto)}`;
}

async function criarTerreiro(q, body, adminId) {
  const nome = campo(body, 'nome', { obrigatorio: true, max: 120 });
  const documento = documentoValido(campo(body, 'documento', { obrigatorio: true }));
  if (!documento) throw erro.validacao('CPF ou CNPJ inválido', { campo: 'documento' });
  const responsavel = campo(body, 'responsavel_nome', { obrigatorio: true, max: 120 });
  const email = campo(body, 'email', { obrigatorio: true, max: 160 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro.validacao('E-mail inválido', { campo: 'email' });
  const telefone = telefoneNormalizado(campo(body, 'telefone'));
  const planoId = campo(body, 'plano_id', { tipo: 'uuid' });
  const plano = planoId ? await q.one('select id from planos where id = $1 and ativo', [planoId]) : await q.one('select id from planos where ativo order by preco_centavos limit 1');
  if (planoId && !plano) throw erro.validacao('Plano não encontrado', { campo: 'plano_id' });
  const existe = await q.one('select 1 from terreiros where documento = $1', [documento]);
  if (existe) throw erro.conflito('Já existe um terreiro com este CPF/CNPJ', { campo: 'documento' });

  const t = await q.one(
    `insert into terreiros(nome, documento, tradicao, responsavel_nome, email, telefone, endereco, plano_id, teste_ate, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'teste') returning *`,
    [nome, documento, campo(body, 'tradicao', { max: 60 }) || null, responsavel, email, telefone || null, campo(body, 'endereco', { max: 300 }) || null,
     plano?.id || null, somarDias(relogio.hoje(), 30)]
  );
  await q.query(
    `insert into entidades_casa(terreiro_id, tipo, nome) select $1::uuid, 'orixa', unnest($2::text[]) union all select $1::uuid, 'entidade', unnest($3::text[])`,
    [t.id, ORIXAS, ENTIDADES]
  );
  await q.query(`insert into servicos(terreiro_id, nome, preco_sugerido_centavos) select $1::uuid, s, 0 from unnest($2::text[]) s`, [t.id, SERVICOS.map((s) => s[0])]);
  await q.query(`insert into grupos(terreiro_id, nome) select $1::uuid, unnest($2::text[])`, [t.id, GRUPOS]);

  let usuario = await q.one('select * from usuarios where lower(email) = $1', [email]);
  if (!usuario) usuario = await q.one('insert into usuarios(nome, email, telefone) values ($1,$2,$3) returning *', [responsavel, email, telefone || null]);
  const vinculo = await q.one(
    `insert into vinculos(usuario_id, terreiro_id, papel) values ($1,$2,'sacerdote') returning *`,
    [usuario.senha_hash ? usuario.id : null, t.id]
  );
  let convite = null;
  if (!usuario.senha_hash) {
    await q.query('update vinculos set usuario_id = $2 where id = $1', [vinculo.id, usuario.id]);
    convite = await gerarConvite(q, vinculo.id);
    await notificar(q, { terreiroId: t.id, usuarioId: usuario.id, tipo: 'convite', referencia: vinculo.id, canais: ['email'], link: convite.link });
  }
  await auditar(q, { terreiroId: t.id, usuarioId: adminId, acao: 'terreiro_criado', entidade: 'terreiro', entidadeId: t.id });
  return { terreiro: t, convite };
}

module.exports = { criarTerreiro, gerarConvite, linkWhatsApp, ORIXAS, ENTIDADES, GRUPOS, APP_URL };
