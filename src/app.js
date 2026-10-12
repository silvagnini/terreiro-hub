'use strict';
const path = require('path');
const express = require('express');
const auth = require('./auth');
const { HttpError } = require('./util');

function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    if (process.env.NODE_ENV === 'production') res.setHeader('strict-transport-security', 'max-age=31536000');
    next();
  });

  const api = express.Router();
  api.use(require('./routes/publico'));
  api.use('/admin', require('./routes/admin'));

  const t = express.Router({ mergeParams: true });
  t.use(require('./routes/terreiro'));
  t.use('/filhos', require('./routes/filhos'));
  t.use(require('./routes/mural'));
  t.use(require('./routes/agenda'));
  t.use(require('./routes/financeiro'));
  t.use('/meu', require('./routes/meu'));
  api.use('/t/:tid', auth.autenticar, auth.carregarTerreiro, t);

  api.use((_req, _res, next) => next(new HttpError(404, 'nao_encontrado', 'Rota não encontrada')));
  app.use('/api', api);

  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(pub, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ erro: { codigo: err.codigo, mensagem: err.message, detalhes: err.detalhes } });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: { codigo: 'validacao', mensagem: 'JSON inválido' } });
    if (err.code === '23505') return res.status(409).json({ erro: { codigo: 'conflito', mensagem: 'Registro duplicado' } });
    if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ erro: { codigo: 'validacao', mensagem: 'Valor inválido' } });
    if (err.code === '23503') return res.status(400).json({ erro: { codigo: 'validacao', mensagem: 'Referência inválida' } });
    console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ erro: { codigo: 'interno', mensagem: 'Erro interno. Tente de novo.' } });
  });
  return app;
}

module.exports = { criarApp };
