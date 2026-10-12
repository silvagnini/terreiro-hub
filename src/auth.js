'use strict';
const crypto = require('crypto');
const db = require('./db');
const { erro, wrap, tokenAleatorio, sha256 } = require('./util');

const SESSAO_HORAS = Number(process.env.SESSAO_HORAS || 24 * 14);
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function conferirSenha(senha, armazenado) {
  if (!armazenado) return false;
  const [alg, saltB64, hashB64] = armazenado.split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtido = crypto.scryptSync(senha, Buffer.from(saltB64, 'base64'), esperado.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(esperado, obtido);
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) throw erro.validacao('A senha precisa ter pelo menos 8 caracteres', { campo: 'senha' });
}

async function criarSessao(usuarioId, impersonadoPor = null) {
  const token = tokenAleatorio();
  await db.query(
    `insert into sessoes(token_hash, usuario_id, expira_em, impersonado_por) values ($1,$2, now() + ($3 || ' hours')::interval, $4)`,
    [sha256(token), usuarioId, String(SESSAO_HORAS), impersonadoPor]
  );
  return token;
}

async function login(identificador, senha) {
  const id = String(identificador || '').trim().toLowerCase();
  const digitos = id.replace(/\D/g, '');
  const tel = digitos.length >= 10 && !id.includes('@') ? (digitos.length <= 11 ? '55' + digitos : digitos) : null;
  const u = await db.one('select * from usuarios where lower(email) = $1 or telefone = $2', [id, tel]);
  if (!u) throw erro.naoAutenticado('E-mail, telefone ou senha incorretos');
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date())
    throw erro.naoAutenticado('Muitas tentativas. Tente de novo em alguns minutos.');
  if (!conferirSenha(String(senha || ''), u.senha_hash)) {
    const tentativas = u.tentativas_login + 1;
    if (tentativas >= MAX_TENTATIVAS) {
      await db.query(`update usuarios set tentativas_login = 0, bloqueado_ate = now() + ($2 || ' minutes')::interval where id = $1`, [u.id, String(BLOQUEIO_MIN)]);
    } else {
      await db.query('update usuarios set tentativas_login = $2 where id = $1', [u.id, tentativas]);
    }
    throw erro.naoAutenticado('E-mail, telefone ou senha incorretos');
  }
  await db.query('update usuarios set tentativas_login = 0, bloqueado_ate = null where id = $1', [u.id]);
  const token = await criarSessao(u.id);
  return { token, usuario: publico(u) };
}

const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, is_admin: u.is_admin });

function tokenDaRequisicao(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sessao=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const autenticar = wrap(async (req, _res, next) => {
  const token = tokenDaRequisicao(req);
  if (!token) throw erro.naoAutenticado();
  const s = await db.one(
    `select s.token_hash, s.impersonado_por, u.* from sessoes s join usuarios u on u.id = s.usuario_id
      where s.token_hash = $1 and s.expira_em > now()`,
    [sha256(token)]
  );
  if (!s) throw erro.naoAutenticado('Sessão expirada. Entre de novo.');
  req.usuario = publico(s);
  req.sessao = { tokenHash: s.token_hash, impersonadoPor: s.impersonado_por };
  next();
});

const exigirAdmin = (req, _res, next) => {
  if (!req.usuario || !req.usuario.is_admin) return next(erro.proibido());
  next();
};

const PERMISSOES_AUXILIAR_PADRAO = { filhos: true, mural: true, agenda: true, financeiro: false, despesas: false, dashboard: false };

// Carrega o terreiro de /api/t/:tid e o vínculo do usuário. Aplica RN-01 e RN-09.
const carregarTerreiro = wrap(async (req, _res, next) => {
  const tid = req.params.tid;
  if (!/^[0-9a-f-]{36}$/i.test(tid)) throw erro.naoEncontrado('Terreiro não encontrado');
  const t = await db.one('select * from terreiros where id = $1', [tid]);
  if (!t) throw erro.naoEncontrado('Terreiro não encontrado');
  let vinculo = await db.one(
    'select * from vinculos where terreiro_id = $1 and usuario_id = $2 and ativo', [tid, req.usuario.id]
  );
  // Suporte do Admin só com consentimento do sacerdote (RF-07)
  if (!vinculo && req.usuario.is_admin && req.sessao.impersonadoPor == null) {
    if (t.suporte_consentido_ate && new Date(t.suporte_consentido_ate) > new Date()) {
      vinculo = { papel: 'sacerdote', permissoes: {}, suporte: true };
    }
  }
  if (!vinculo) throw erro.naoEncontrado('Terreiro não encontrado');
  if (vinculo.papel === 'filho') {
    const f = await db.one('select status from filhos where id = $1', [vinculo.filho_id]);
    if (!f || f.status === 'bloqueado' || f.status === 'desligado') throw erro.proibido('Seu acesso a esta casa está suspenso. Fale com o sacerdote.');
  }
  if (t.status === 'bloqueado' || t.status === 'encerrado') {
    throw erro.bloqueado(
      t.status === 'encerrado' ? 'Este terreiro foi encerrado.' : `Acesso bloqueado${t.motivo_bloqueio ? ': ' + t.motivo_bloqueio : '. Regularize a assinatura.'}`,
      { status: t.status }
    );
  }
  const escrita = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (t.status === 'somente_leitura' && escrita && vinculo.papel !== 'filho' && !req.path.startsWith('/assinatura')) {
    throw erro.bloqueado('Painel em modo somente leitura por fatura em atraso. Pague a assinatura para voltar a editar.', { status: t.status });
  }
  req.terreiro = t;
  req.vinculo = vinculo;
  next();
});

function exigir(...papeisOuPermissao) {
  // exigir('sacerdote') | exigir('staff', 'financeiro') | exigir('filho')
  return (req, _res, next) => {
    const v = req.vinculo;
    if (!v) return next(erro.proibido());
    const [alvo, perm] = papeisOuPermissao;
    if (alvo === 'sacerdote') return v.papel === 'sacerdote' ? next() : next(erro.proibido());
    if (alvo === 'filho') return v.papel === 'filho' ? next() : next(erro.proibido());
    if (alvo === 'staff') {
      if (v.papel === 'sacerdote') return next();
      if (v.papel === 'auxiliar') {
        const p = { ...PERMISSOES_AUXILIAR_PADRAO, ...(v.permissoes || {}) };
        if (!perm || p[perm]) return next();
      }
      return next(erro.proibido());
    }
    return next(erro.proibido());
  };
}

module.exports = {
  hashSenha, conferirSenha, validarSenha, criarSessao, login, autenticar, exigirAdmin, carregarTerreiro, exigir,
  publico, PERMISSOES_AUXILIAR_PADRAO,
};
