'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const u = require('../../src/util');
const { statusPorAtraso, valorMensalidade } = require('../../src/services/jobs');
const { aplicarDesconto, situacao } = require('../../src/services/cobrancas');
const { ocorrenciasSemanais } = require('../../src/routes/agenda');
const sim = require('../../src/gateway/simulado');

describe('Unitários · regras puras', () => {
  it('CPF e CNPJ: aceita válidos e recusa repetidos/inválidos', () => {
    assert.equal(u.documentoValido('529.982.247-25'), '52998224725');
    assert.equal(u.documentoValido('11.222.333/0001-81'), '11222333000181');
    assert.equal(u.documentoValido('111.111.111-11'), null);
    assert.equal(u.documentoValido('123'), null);
  });

  it('Telefone ganha DDI 55 e recusa tamanhos inválidos', () => {
    assert.equal(u.telefoneNormalizado('(11) 98765-4321'), '5511987654321');
    assert.equal(u.telefoneNormalizado('5511987654321'), '5511987654321');
    assert.throws(() => u.telefoneNormalizado('1234'));
  });

  it('Datas: dias no mês, fim de mês e soma de dias', () => {
    assert.equal(u.diasNoMes('2028-02'), 29);
    assert.equal(u.dataNaCompetencia('2026-02', 30), '2026-02-28');
    assert.equal(u.somarDias('2026-12-30', 3), '2027-01-02');
    assert.equal(u.diasEntre('2026-02-06', '2026-03-08'), 30);
    assert.equal(u.proximaCompetencia('2026-12'), '2027-01');
  });

  it('RN-09: status pela quantidade de dias em atraso', () => {
    assert.equal(statusPorAtraso(0), 'ativo');
    assert.equal(statusPorAtraso(4), 'ativo');
    assert.equal(statusPorAtraso(5), 'aviso');
    assert.equal(statusPorAtraso(15), 'somente_leitura');
    assert.equal(statusPorAtraso(30), 'bloqueado');
    assert.equal(statusPorAtraso(90), 'encerrado');
  });

  it('US-22: mensalidade integral x proporcional na entrada', () => {
    const cfg = { valor_centavos: 3000, entrada: 'proporcional' };
    assert.equal(valorMensalidade(cfg, { data_entrada: '2026-04-01' }, '2026-04').valor, 3000);
    assert.equal(valorMensalidade(cfg, { data_entrada: '2026-04-16' }, '2026-04').valor, 1500);
    assert.equal(valorMensalidade({ ...cfg, entrada: 'integral' }, { data_entrada: '2026-04-16' }, '2026-04').valor, 3000);
    assert.equal(valorMensalidade(cfg, { data_entrada: '2026-01-16' }, '2026-04').valor, 3000, 'só no mês de entrada');
  });

  it('US-27: desconto em valor e percentual, nunca maior que o valor', () => {
    assert.equal(aplicarDesconto(5000, { tipo: 'percentual', valor: 10 }), 500);
    assert.equal(aplicarDesconto(5000, { tipo: 'valor', valor: 700 }), 700);
    assert.equal(aplicarDesconto(500, { tipo: 'valor', valor: 700 }), 500);
    assert.equal(aplicarDesconto(5000, null), 0);
  });

  it('Situação "vencida" é derivada de aberta + vencimento passado', () => {
    assert.equal(situacao({ status: 'aberta', vencimento: '2026-01-01' }, '2026-01-02'), 'vencida');
    assert.equal(situacao({ status: 'aberta', vencimento: '2026-01-02' }, '2026-01-02'), 'aberta');
    assert.equal(situacao({ status: 'paga', vencimento: '2020-01-01' }, '2026-01-02'), 'paga');
  });

  it('US-20: recorrência semanal respeita data final, intervalo e teto', () => {
    const ini = new Date('2099-05-01T19:30:00-03:00');
    assert.equal(ocorrenciasSemanais(ini, { ate: '2099-05-29' }).length, 5);
    assert.equal(ocorrenciasSemanais(ini, { ate: '2099-05-29', intervalo: 2 }).length, 3);
    assert.equal(ocorrenciasSemanais(ini, { ate: '2199-01-01' }).length, 52);
  });

  it('Pix copia e cola segue o padrão EMV com CRC16 correto', () => {
    const p = sim.pixCopiaCola({ chave: 'acc_123', nome: 'Tenda São Jorge', cidade: 'SAO PAULO', valorCentavos: 3500, txid: 'abc123' });
    assert.match(p, /^000201/);
    assert.ok(p.includes('5405' + '35.00'), 'campo 54 (valor) com tamanho 05');
    assert.equal(sim.crc16(p.slice(0, -4)), p.slice(-4));
    assert.equal(sim.crc16('123456789'), '29B1', 'vetor de teste CRC-16/CCITT-FALSE');
  });
});
