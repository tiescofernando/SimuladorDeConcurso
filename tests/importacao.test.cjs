const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8');
const context = {};
vm.runInNewContext(`
  const LETRAS = ['A', 'B', 'C', 'D', 'E'];
  const NIVEIS = { fundamental: 'Ensino Fundamental', medio: 'Ensino Médio', superior: 'Ensino Superior' };
  const slugify = t => String(t || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  ${source.slice(source.indexOf('function normalizarNivel('), source.indexOf('function lerJsonQuestoes('))}
  ${source.slice(source.indexOf('function lerJsonQuestoes('), source.indexOf('function adicionarQuestoes('))}
`, context);
const normalize = q => JSON.parse(JSON.stringify(context.normalizarQuestao(q, 'medio')));

test('aceita alternativas por letra fora de ordem e preserva justificativa e gabarito', () => {
  const result = normalize({ pergunta: 'Pergunta?', alternativas: { C: 'Terceira', A: 'Primeira', B: 'Segunda' }, resposta_correta: 'B', justificativa: 'Motivo.' });
  assert.deepEqual(result.q, { enunciado: 'Pergunta?', opcoes: ['Primeira', 'Segunda', 'Terceira'], correta: 1, nivel: 'medio', explicacao: 'Motivo.' });
});

test('mantém importação de listas e explicações existentes', () => {
  const result = normalize({ enunciado: 'Pergunta?', opcoes: ['A. Primeira', 'B. Segunda'], correta: 0, explicacao: 'Explicação.' });
  assert.deepEqual(result.q.opcoes, ['Primeira', 'Segunda']);
  assert.equal(result.q.correta, 0);
  assert.equal(result.q.explicacao, 'Explicação.');
});

test('rejeita objetos com lacunas, letras duplicadas ou textos vazios para evitar gabarito incorreto', () => {
  for (const alternativas of [{ A: 'Um', C: 'Três' }, { A: 'Um', B: '' }, { A: 'Um', a: 'Outro' }, {}]) {
    assert.ok(normalize({ pergunta: 'Pergunta?', alternativas, resposta_correta: 'A' }).erro);
  }
});

test('lê lote com os nomes de campos do arquivo enviado', () => {
  const item = { id: 1, pergunta: 'Pergunta?', alternativas: { A: 'Um', B: 'Dois', C: 'Três', D: 'Quatro', E: 'Cinco' }, resposta_correta: 'E', justificativa: 'Motivo.' };
  const lote = context.lerJsonQuestoes(JSON.stringify([item, { ...item, id: 2 }]));
  assert.equal(lote.itens.length, 2);
  for (const q of lote.itens) {
    assert.equal(normalize(q).q.correta, 4);
    assert.equal(normalize(q).q.explicacao, item.justificativa);
  }
});

test('identifica o ensino por questão, incluindo aliases e nomes com acentos', () => {
  const base = { pergunta: 'Pergunta?', alternativas: { A: 'Um', B: 'Dois' }, resposta_correta: 'A' };
  for (const [field, value, expected] of [['nivel', 'Ensino Fundamental', 'fundamental'], ['nivel', 'Ensino Médio', 'medio'], ['ensino', 'Superior', 'superior'], ['escolaridade', 'Ensino Técnico', 'tecnico'], ['nivel_ensino', 'Educação de Jovens e Adultos', 'educacao_de_jovens_e_adultos']]) {
    assert.equal(normalize({ ...base, [field]: value }).q.nivel, expected);
  }
});
test('importação sem nível não atribui Ensino Médio automaticamente', () => {
  const result = context.normalizarQuestao({ pergunta: 'Pergunta?', alternativas: { A: 'Um', B: 'Dois' }, resposta_correta: 'A' });
  assert.equal(result.q.nivel, '');
});
