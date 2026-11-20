const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8');
function ambiente(questoes = []) {
  const context = { state: { questoes, disciplinas: [] } };
  vm.runInNewContext(`
    const LETRAS=['A','B','C','D','E'];
    const NIVEIS={fundamental:'Ensino Fundamental',medio:'Ensino Médio',superior:'Ensino Superior'};
    const ler=t=>state[t];
    const slugify=t=>String(t??'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    const normalizarCat=slugify;
    const getMaterias=()=>({informatica:'Informática'});
    const salvarDisciplina=slugify;
    const proximoId=(lista,prefixo)=>prefixo+(lista.length+1);
    ${source.slice(source.indexOf('function rotuloNivel('),source.indexOf('const MATERIAS_PADRAO'))}
    ${source.slice(source.indexOf('function filtrarQuestoes('),source.indexOf('/* ---------- prova ---------- */'))}
    ${source.slice(source.indexOf('function normalizarNivel('),source.indexOf('function viewAdmin('))}
  `,context);
  return context;
}
test('filtros são gerados dos níveis realmente presentes e incluem níveis novos', () => {
  const c=ambiente([{nivel:'Ensino Médio'},{nivel:'medio'},{nivel:'superior'},{nivel:'Ensino Técnico'},{nivel:''}]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.niveisDisponiveis())),[
    ['medio','Ensino Médio',2],['superior','Ensino Superior',1],['tecnico','Ensino Técnico',1],['sem_nivel','Não informado',1]
  ]);
});
test('filtro combina ensino e matéria, sem misturar questões sem nível', () => {
  const c=ambiente([{cat:'informatica',nivel:'Ensino Médio'},{cat:'informatica',nivel:'superior'},{cat:'portugues',nivel:'medio'},{cat:'informatica',nivel:''}]);
  assert.equal(c.filtrarQuestoes(['informatica'],'medio').length,1);
  assert.equal(c.filtrarQuestoes(['informatica'],'sem_nivel').length,1);
  assert.equal(c.filtrarQuestoes([],'medio').length,2);
});
test('importação preserva a mesma pergunta em ensinos distintos e ignora repetição no mesmo ensino', () => {
  const c=ambiente();
  const q={cat:'informatica',enunciado:'Pergunta?',opcoes:['Um','Dois'],correta:'A'};
  const result=c.adicionarQuestoes([{...q,nivel:'Ensino Fundamental'},{...q,nivel:'Ensino Médio'},{...q,nivel:'medio'}]);
  assert.equal(result.add,2); assert.equal(result.dup,1);
  assert.deepEqual(c.state.questoes.map(q=>q.nivel),['fundamental','medio']);
});
test('lote não oferece campo de nível padrão', () => {
  assert.doesNotMatch(source,/name="nivel_lote"/);
});
