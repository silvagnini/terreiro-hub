// Reporter do node:test que grava cada teste (nome, arquivo, resultado, duração) em JSON. Suítes (describe) não entram.
export default async function* reporter(source) {
  const testes = [];
  for await (const ev of source) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data;
    if (d.details?.type === 'suite') continue;
    if (d.nesting === 0 && d.file && d.name === d.file) continue; // arquivo inteiro (quando um arquivo falha ao carregar)
    testes.push({
      nome: d.name,
      arquivo: d.file ? d.file.split('/test/')[1] || d.file : null,
      ok: ev.type === 'test:pass',
      duracao_ms: Math.round(d.details?.duration_ms || 0),
      erro: ev.type === 'test:fail' ? String(d.details?.error?.cause?.message || d.details?.error?.message || '').slice(0, 500) : null,
    });
  }
  yield JSON.stringify(testes, null, 2);
}
