'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const erro = {
  validacao: (msg, det) => new HttpError(400, 'validacao', msg, det),
  naoAutenticado: (msg = 'Faça login para continuar') => new HttpError(401, 'nao_autenticado', msg),
  proibido: (msg = 'Você não tem permissão para isso') => new HttpError(403, 'proibido', msg),
  naoEncontrado: (msg = 'Não encontrado') => new HttpError(404, 'nao_encontrado', msg),
  conflito: (msg, det) => new HttpError(409, 'conflito', msg, det),
  regra: (msg, det) => new HttpError(422, 'regra_de_negocio', msg, det),
  bloqueado: (msg, det) => new HttpError(423, 'terreiro_bloqueado', msg, det),
};

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- validação simples ----------
function campo(obj, nome, { obrigatorio = false, tipo = 'string', min, max, opcoes } = {}) {
  let v = obj ? obj[nome] : undefined;
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw erro.validacao(`O campo "${nome}" é obrigatório`, { campo: nome });
    return undefined;
  }
  if (tipo === 'string') {
    if (typeof v !== 'string') throw erro.validacao(`"${nome}" deve ser texto`, { campo: nome });
    v = v.trim();
    if (max && v.length > max) throw erro.validacao(`"${nome}" tem mais de ${max} caracteres`, { campo: nome });
    if (obrigatorio && !v) throw erro.validacao(`O campo "${nome}" é obrigatório`, { campo: nome });
  } else if (tipo === 'int') {
    v = Number(v);
    if (!Number.isInteger(v)) throw erro.validacao(`"${nome}" deve ser número inteiro`, { campo: nome });
    if (min !== undefined && v < min) throw erro.validacao(`"${nome}" deve ser no mínimo ${min}`, { campo: nome });
    if (max !== undefined && v > max) throw erro.validacao(`"${nome}" deve ser no máximo ${max}`, { campo: nome });
  } else if (tipo === 'bool') {
    v = v === true || v === 'true';
  } else if (tipo === 'date') {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')))
      throw erro.validacao(`"${nome}" deve ser uma data AAAA-MM-DD`, { campo: nome });
  } else if (tipo === 'datetime') {
    if (typeof v !== 'string' || isNaN(Date.parse(v))) throw erro.validacao(`"${nome}" deve ser data e hora ISO`, { campo: nome });
  } else if (tipo === 'uuid') {
    if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw erro.validacao(`"${nome}" inválido`, { campo: nome });
  } else if (tipo === 'array') {
    if (!Array.isArray(v)) throw erro.validacao(`"${nome}" deve ser uma lista`, { campo: nome });
  } else if (tipo === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) throw erro.validacao(`"${nome}" deve ser um objeto`, { campo: nome });
  }
  if (opcoes && !opcoes.includes(v)) throw erro.validacao(`"${nome}" deve ser um de: ${opcoes.join(', ')}`, { campo: nome });
  return v;
}

const soDigitos = (s) => (s ? String(s).replace(/\D/g, '') : s);

function telefoneNormalizado(t) {
  const d = soDigitos(t);
  if (!d) return undefined;
  if (d.length < 10 || d.length > 13) throw erro.validacao('Telefone inválido', { campo: 'telefone' });
  return d.length <= 11 ? '55' + d : d;
}

function documentoValido(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return cpfValido(d) ? d : null;
  if (d.length === 14) return cnpjValido(d) ? d : null;
  return null;
}

function cpfValido(c) {
  if (/^(\d)\1{10}$/.test(c)) return false;
  const calc = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

function cnpjValido(c) {
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * pesos[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

// ---------- relógio (substituível em testes) ----------
let hojeFixo = null;
const relogio = {
  fixar(data) { hojeFixo = data; },
  limpar() { hojeFixo = null; },
  hoje() {
    if (hojeFixo) return hojeFixo;
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  },
  agora() {
    return hojeFixo ? new Date(hojeFixo + 'T12:00:00-03:00') : new Date();
  },
};

function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

function competenciaDe(dataISO) {
  return dataISO.slice(0, 7);
}

function diasNoMes(competencia) {
  const [y, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dataNaCompetencia(competencia, dia) {
  return `${competencia}-${String(Math.min(dia, diasNoMes(competencia))).padStart(2, '0')}`;
}

function proximaCompetencia(competencia) {
  const [y, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

// ---------- tokens ----------
const tokenAleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function paginacao(q) {
  const limite = Math.min(Math.max(Number(q.limite) || 50, 1), 200);
  const pagina = Math.max(Number(q.pagina) || 1, 1);
  return { limite, offset: (pagina - 1) * limite, pagina };
}

module.exports = {
  HttpError, erro, wrap, campo, soDigitos, telefoneNormalizado, documentoValido, cpfValido, cnpjValido,
  relogio, somarDias, diasEntre, competenciaDe, diasNoMes, dataNaCompetencia, proximaCompetencia,
  tokenAleatorio, sha256, paginacao,
};
