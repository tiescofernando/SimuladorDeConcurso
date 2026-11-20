/* Simulador de Concurso — versão estática (HTML/CSS/JS puro).
   Dados base: data/dados.js. Conteúdo compartilhado e autenticação via Supabase. */
(function () {
'use strict';
const MAX_TENTATIVAS = 5;
const LETRAS = ['A', 'B', 'C', 'D', 'E'];
const NIVEIS = { fundamental: 'Ensino Fundamental', medio: 'Ensino Médio', superior: 'Ensino Superior' };
function rotuloNivel(valor) {
  const nivel = normalizarNivel(valor);
  return NIVEIS[nivel] || ({ tecnico: 'Ensino Técnico', pos_graduacao: 'Pós-graduação' })[nivel]
    || (nivel ? nivel.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Não informado');
}
function getNiveis() {
  const niveis = Object.assign(Object.create(null), NIVEIS);
  ler('questoes').forEach((q) => { const nivel = normalizarNivel(q.nivel); if (nivel) niveis[nivel] = rotuloNivel(nivel); });
  return niveis;
}
function niveisDisponiveis() {
  const contagens = Object.create(null);
  ler('questoes').forEach((q) => { const nivel = normalizarNivel(q.nivel) || 'sem_nivel'; contagens[nivel] = (contagens[nivel] || 0) + 1; });
  const ordem = Object.keys(getNiveis()).concat('sem_nivel');
  return ordem.filter((nivel) => contagens[nivel]).map((nivel) => [nivel, nivel === 'sem_nivel' ? 'Não informado' : rotuloNivel(nivel), contagens[nivel]]);
}
function doNivel(q, nivel) {
  return !nivel || (nivel === 'sem_nivel' ? !normalizarNivel(q.nivel) : normalizarNivel(q.nivel) === normalizarNivel(nivel));
}
const MATERIAS_PADRAO = {
  portugues: 'Língua Portuguesa', interpretacao: 'Interpretação de Texto', matematica: 'Matemática e Raciocínio Lógico',
  gerais: 'Conhecimentos Gerais', legislacao: 'Legislação Municipal', rotinas: 'Rotinas Administrativas',
  atendimento: 'Atendimento ao Público', infantil: 'Educação Infantil e BNCC', creche: 'Rotinas de Creche',
  higiene: 'Higiene e Primeiros Socorros'
};
const $app = document.getElementById('app');

/* ---------- armazenamento ---------- */
const LS = 'simulador_dados_v1', SS = 'simulador_prova_v1';
const clone = (o) => JSON.parse(JSON.stringify(o));
function lerStore(k, store) { try { return JSON.parse(store.getItem(k)); } catch (e) { return null; } }
function gravarStore(k, v, store) { try { store.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
const nuvem = window.SimuladorNuvem;
const online = !!nuvem?.configured;
let pronto = !online, admin = false, falhaConexao = '', ocupado = false, publicado = false, rotaPendente = false;
const DADOS_VAZIOS = { questoes: [], apostilas: [], disciplinas: [], simulados: [] };
let DB = online ? clone(DADOS_VAZIOS) : lerStore(LS, localStorage) || clone(window.DADOS_BASE || DADOS_VAZIOS);
let basePromise;
function carregarBase() {
  if (window.DADOS_BASE) return Promise.resolve(clone(window.DADOS_BASE));
  if (!basePromise) basePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/data/dados.js';
    script.onload = () => window.DADOS_BASE ? resolve(clone(window.DADOS_BASE)) : reject(new Error('Conteúdo original indisponível.'));
    script.onerror = () => { basePromise = null; script.remove(); reject(new Error('Não foi possível carregar o conteúdo original.')); };
    document.head.appendChild(script);
  });
  return basePromise.then(clone);
}
['questoes', 'apostilas', 'disciplinas', 'simulados'].forEach((k) => { if (!Array.isArray(DB[k])) DB[k] = []; });
async function salvarDB() {
  if (online) { await nuvem.save(DB); publicado = true; }
  else if (!gravarStore(LS, DB, localStorage)) throw new Error('Não foi possível salvar neste navegador. Exporte um backup.');
}
// Impede duas edições simultâneas e restaura a tela se o banco recusar a escrita.
function protegerAcoes() {
  const elementos = $app.querySelectorAll('[data-del], form[data-f], #importar, #restaurar, #f-edit, #publicar');
  elementos.forEach((el) => {
    const prop = el.tagName === 'FORM' ? 'onsubmit' : el.id === 'importar' ? 'onchange' : 'onclick';
    const acao = el[prop]; if (!acao) return;
    el[prop] = async (ev) => {
      ev.preventDefault();
      if (ocupado) return;
      ocupado = true;
      const anterior = clone(DB);
      const controles = [...$app.querySelectorAll('button, input, select, textarea')];
      const desabilitados = controles.map((c) => c.disabled);
      // Só desabilita depois que o handler já leu os campos do formulário.
      const indicador = document.getElementById('estado-nuvem');
      if (indicador) indicador.textContent = online ? 'Salvando no Supabase…' : 'Salvando…';
      try {
        const promessa = acao(ev);
        controles.forEach((c) => { c.disabled = true; });
        await promessa;
      } catch (error) {
        DB = anterior;
        flash('Alteração não salva: ' + error.message, false);
        if (location.hash.includes('/editar/')) {
          const partes = location.hash.split('/'); viewEditar(partes[3], partes[4]);
        } else viewAdmin('');
      } finally {
        ocupado = false;
        controles.forEach((c, i) => { c.disabled = desabilitados[i]; });
        const status = document.getElementById('estado-nuvem');
        if (status) status.textContent = online ? 'Conectado ao Supabase.' : 'Modo local: alterações neste navegador.';
        if (rotaPendente) { rotaPendente = false; rota(); }
      }
    };
  });
}
const ler = (t) => DB[t];
let estado = lerStore(SS, sessionStorage) || null; // {prova, resultado, historico}
const salvarEstado = () => gravarStore(SS, estado, sessionStorage);

/* ---------- utilitários ---------- */
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => e(s).replace(/\r?\n/g, '<br>');
function pdfSeguro(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const parsed = new URL(value.trim(), location.origin || 'https://simulador.local');
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_) { return ''; }
}
const campoArquivoPdf = () => `<label>Selecionar apostila em PDF <input type="file" name="arquivo_pdf" accept=".pdf,application/pdf" ${online ? '' : 'disabled'}></label>
  <small>${online ? 'PDF de até 20 MB. Ao salvar, o arquivo será enviado e ficará disponível aos visitantes. Se selecionar um arquivo, ele será usado no lugar do link abaixo.' : 'Configure o Supabase para enviar arquivos.'}</small>`;
async function pdfDoFormulario(f) {
  const file = f.elements.arquivo_pdf?.files[0];
  if (!file) {
    const valor = f.elements.pdf.value.trim(), seguro = pdfSeguro(valor);
    if (valor && !seguro) throw new Error('Informe um link HTTP/HTTPS válido ou selecione um PDF.');
    return seguro;
  }
  const status = document.getElementById('estado-nuvem');
  if (status) status.textContent = 'Enviando PDF… Aguarde a confirmação.';
  return nuvem.uploadPdf(file);
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function slugify(t) {
  return String(t ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function proximoId(lista, pref) {
  let max = 0; lista.forEach((x) => { max = Math.max(max, parseInt(String(x.id ?? '').replace(/\D/g, ''), 10) || 0); });
  return pref + (max + 1);
}

/* ---------- matérias ---------- */
function getMaterias() {
  const m = Object.assign({}, MATERIAS_PADRAO);
  ler('disciplinas').forEach((d) => { const nome = (d.nome || '').trim(), slug = d.slug || slugify(nome); if (nome && slug) m[slug] = nome; });
  return m;
}
function normalizarCat(c) {
  c = String(c ?? '').trim(); if (!c) return '';
  const m = getMaterias(), s = slugify(c);
  if (m[c]) return c; if (m[s]) return s;
  for (const k in m) if (slugify(m[k]) === s) return k;
  return s;
}
function contarPorCat() { const n = {}; ler('questoes').forEach((q) => { const c = normalizarCat(q.cat); n[c] = (n[c] || 0) + 1; }); return n; }
function salvarDisciplina(nome) {
  nome = nome.trim(); const slug = slugify(nome); if (!slug) return false;
  const ex = normalizarCat(nome); if (getMaterias()[ex]) return ex;
  const l = ler('disciplinas'); l.push({ id: l.length ? Math.max(...l.map((d) => d.id || 0)) + 1 : 1, slug, nome });
  return slug;
}
function excluirDisciplina(slug) {
  if (MATERIAS_PADRAO[slug]) return 'Matérias padrão do sistema não podem ser excluídas.';
  const l = ler('disciplinas'), novo = l.filter((d) => (d.slug || slugify(d.nome)) !== slug);
  if (novo.length === l.length) return 'Matéria não encontrada.';
  if ((contarPorCat()[slug] || 0) > 0) return 'Esta matéria ainda tem questões. Exclua-as primeiro.';
  if (ler('apostilas').some((a) => normalizarCat(a.cat) === slug)) return 'Esta matéria ainda tem apostilas. Exclua-as primeiro.';
  DB.disciplinas = novo; return true;
}
function filtrarQuestoes(cats, nivel) {
  cats = (cats || []).map(normalizarCat).filter(Boolean);
  return ler('questoes').filter((q) => (!cats.length || cats.includes(normalizarCat(q.cat))) && doNivel(q, nivel));
}

/* ---------- prova ---------- */
function montarProva(qs) {
  qs = shuffle(qs.map(clone)); const n = qs.length; let alvo = [];
  while (alvo.length < n) {
    let b = shuffle(LETRAS.slice());
    if (alvo.length && b[0] === alvo[alvo.length - 1]) b.reverse();
    alvo = alvo.concat(b);
  }
  qs.forEach((q, i) => {
    const certa = q.opcoes[q.correta];
    const outras = shuffle(q.opcoes.filter((_, k) => k !== q.correta));
    const pos = Math.min(LETRAS.indexOf(alvo[i]), outras.length);
    outras.splice(pos, 0, certa);
    q.opcoes = outras; q.correta = pos; q.gabarito = LETRAS[pos];
  });
  return qs;
}
function iniciarProva(pool, qtd, nome) {
  pool = shuffle(pool.slice()); if (qtd > 0) pool = pool.slice(0, qtd);
  estado = { prova: { tentativa: 1, questoes: montarProva(pool), inicio: Date.now(), nome: nome || '' }, resultado: null, historico: [], respostas: {} };
  salvarEstado(); location.hash = '#/prova';
}

/* ---------- layout / roteador ---------- */
let timerId = null;
function pagina(html) {
  const aviso = falhaConexao && !location.hash.startsWith('#/admin')
    ? '<p class="aviso" role="alert">Não foi possível atualizar o conteúdo. Exibindo a versão original; tente recarregar a página.</p>' : '';
  $app.innerHTML = aviso + html; window.scrollTo(0, 0);
}
function rota() {
  if (!pronto) return pagina('<p class="card" role="status">Conectando ao Supabase…</p>');
  if (ocupado) { rotaPendente = true; return; }
  clearInterval(timerId);
  const h = location.hash.replace(/^#/, '') || (/^\/admin(?:\/|$)/.test(location.pathname || '') ? location.pathname : '/');
  let partes;
  try { partes = h.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent); }
  catch (_) { return pagina('<p class="aviso">Endereço inválido.</p>'); }
  const [r, a, b] = partes;
  if (!r) return viewHome();
  if (r === 'prova') return viewProva();
  if (r === 'resultado') return viewResultado();
  if (r === 'resumo') return viewResumo(a || '');
  if (r === 'admin') return a === 'editar' ? viewEditar(b, partes[3]) : viewAdmin(a || '');
  viewHome();
}
window.addEventListener('hashchange', rota);

/* ---------- Home ---------- */
function viewHome(erro) {
  const materias = getMaterias(), cont = contarPorCat(), contN = {}, niveis = niveisDisponiveis();
  ler('questoes').forEach((q) => { const c = normalizarCat(q.cat), nivel = normalizarNivel(q.nivel) || 'sem_nivel'; (contN[c] = contN[c] || {})[nivel] = ((contN[c] || {})[nivel] || 0) + 1; });
  const sims = ler('simulados');
  const cardsSim = sims.map((s) => {
    const disp = filtrarQuestoes(s.cats, s.nivel).length, qtd = +s.qtd || 0, n = qtd > 0 ? Math.min(qtd, disp) : disp;
    const nomes = (s.cats || []).map((c) => materias[c] || c).join(', ') || 'Todas as matérias';
    return `<div class="card sim"><h3>${e(s.nome)}</h3>${s.descricao ? `<p class="sub">${e(s.descricao)}</p>` : ''}
      <p class="sub">${n} questões · ${e(s.nivel ? rotuloNivel(s.nivel) : 'Todos os níveis')}<br>${e(nomes)}</p>
      <button class="btn" data-sim="${e(s.id)}" ${n ? '' : 'disabled'}>Iniciar</button></div>`;
  }).join('');
  const chips = Object.keys(materias).map((k) => {
    const n = cont[k] || 0;
    return `<label class="chip ${n ? '' : 'zero'}" data-total="${n}" ${niveis.map(([nk]) => `data-${e(nk)}="${(contN[k] || {})[nk] || 0}"`).join(' ')}>
      <input type="checkbox" name="cats" value="${e(k)}"> ${e(materias[k])} <small class="n">${n}</small></label>`;
  }).join('');
  pagina(`<h1>Simulado de concurso</h1>
  <p class="sub">Questões de múltipla escolha (A a E), uma única correta. Ao final você recebe o gabarito comentado e pode refazer as erradas em até ${MAX_TENTATIVAS} tentativas.</p>
  ${erro ? '<p class="aviso">Não há questões para essa combinação. Escolha outras matérias ou cadastre questões no painel admin.</p>' : ''}
  ${sims.length ? `<h2>Simulados prontos</h2><div class="cards-sim">${cardsSim}</div>` : ''}
  <h2>Monte o seu próprio</h2>
  <form class="card" id="form-monte">
    <fieldset><legend>Nível da prova</legend>
      <label class="chip"><input type="radio" name="nivel" value="" checked> Todos</label>
      ${niveis.map(([k, v, n]) => `<label class="chip"><input type="radio" name="nivel" value="${e(k)}"> ${e(v)} <small>${n}</small></label>`).join('')}
    </fieldset>
    <fieldset><legend>Matérias <small>(vazio = todas)</small></legend><div class="grid-cats">${chips}</div></fieldset>
    <label>Quantidade de questões <input type="number" name="qtd" value="10" min="1" max="100"></label>
    <p class="resumo-sel" id="resumo-sel" aria-live="polite"></p>
    <button class="btn" type="submit">Iniciar simulado</button>
  </form>`);
  $app.querySelectorAll('[data-sim]').forEach((b) => b.onclick = () => {
    const s = sims.find((x) => x.id === b.dataset.sim), pool = s ? filtrarQuestoes(s.cats, s.nivel) : [];
    if (!pool.length) return viewHome(true);
    iniciarProva(pool, +s.qtd || 0, s.nome);
  });
  const f = document.getElementById('form-monte'), chipEls = [...f.querySelectorAll('.chip[data-total]')];
  const qtd = f.qtd, out = document.getElementById('resumo-sel'), btn = f.querySelector('button[type=submit]');
  const nivel = () => (f.querySelector('[name=nivel]:checked') || {}).value || '';
  const num = (c) => nivel() === '' ? +c.dataset.total : +c.dataset[nivel()];
  const atualizar = () => {
    const sel = chipEls.filter((c) => c.querySelector('input').checked), base = sel.length ? sel : chipEls;
    chipEls.forEach((c) => { const n = num(c); c.querySelector('.n').textContent = n; c.classList.toggle('zero', n === 0); });
    const total = base.reduce((t, c) => t + num(c), 0);
    qtd.max = Math.max(1, Math.min(100, total));
    const pedido = +qtd.value || 0;
    out.textContent = total === 0 ? 'Nenhuma questão disponível para essa combinação.'
      : (sel.length ? sel.length + ' matéria(s) selecionada(s)' : 'Todas as matérias') + ' · ' + total + ' questões disponíveis' + (pedido > total ? ' · o simulado terá ' + total : '');
    btn.disabled = total === 0;
  };
  f.addEventListener('change', atualizar); f.addEventListener('input', atualizar); atualizar();
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const cats = [...f.querySelectorAll('[name=cats]:checked')].map((i) => i.value);
    const pool = filtrarQuestoes(cats, nivel());
    if (!pool.length) return viewHome(true);
    iniciarProva(pool, Math.max(1, Math.min(100, +qtd.value || 10)));
  });
}

/* ---------- Prova ---------- */
function viewProva() {
  if (!estado || !estado.prova) return (location.hash = '#/');
  if (estado.resultado) return (location.hash = '#/resultado');
  const p = estado.prova, qs = p.questoes, materias = getMaterias(), total = qs.length;
  pagina(`${p.nome ? `<h1>${e(p.nome)}</h1>` : ''}
  <div class="barra-prova card"><span>Tentativa <b>${p.tentativa}</b> de ${MAX_TENTATIVAS}</span>
    <span>Tempo <b id="timer">00:00</b></span><span><b id="contagem">0</b>/${total} respondidas</span>
    <div class="progresso"><i id="prog"></i></div></div>
  <div class="layout">
  <form id="form-prova">
    ${qs.map((q, i) => `<section class="card questao" id="q${i + 1}">
      <div class="meta">Questão ${i + 1} · ${e(materias[normalizarCat(q.cat)] || q.cat || '')} · ${e(rotuloNivel(q.nivel))}</div>
      <p class="enun">${nl2br(q.enunciado)}</p>
      ${q.opcoes.map((o, k) => `<label class="opcao"><input type="radio" name="r_${e(q.id)}" value="${LETRAS[k]}" ${estado.respostas[q.id] === LETRAS[k] ? 'checked' : ''}><span class="letra">${LETRAS[k]}</span><span>${e(o)}</span></label>`).join('')}
    </section>`).join('')}
    <button class="btn" type="submit">Finalizar e ver gabarito</button>
  </form>
  <aside class="mapa card"><h3>Questões</h3><div class="grade">${qs.map((_, i) => `<a href="#" data-ir="q${i + 1}" id="m${i + 1}">${i + 1}</a>`).join('')}</div></aside></div>`);
  const form = document.getElementById('form-prova'), timer = document.getElementById('timer');
  const tick = () => { const s = Math.max(0, Math.floor((Date.now() - p.inicio) / 1000)); timer.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  tick(); timerId = setInterval(tick, 1000);
  const atualizar = () => {
    let n = 0;
    qs.forEach((q, i) => {
      const c = form.querySelector(`[name="r_${CSS.escape(q.id)}"]:checked`);
      if (c) { estado.respostas[q.id] = c.value; n++; } else delete estado.respostas[q.id];
      document.getElementById('m' + (i + 1)).classList.toggle('feita', !!c);
    });
    document.getElementById('contagem').textContent = n;
    document.getElementById('prog').style.width = (n / total * 100) + '%';
    salvarEstado(); return n;
  };
  form.addEventListener('change', atualizar);
  $app.querySelectorAll('[data-ir]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); document.getElementById(a.dataset.ir).scrollIntoView({ behavior: 'smooth' }); });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = atualizar();
    if (n < total && !confirm('Você deixou ' + (total - n) + ' questão(ões) em branco. Finalizar mesmo assim?')) return;
    const ac = qs.filter((q) => estado.respostas[q.id] === q.gabarito).length;
    estado.resultado = { respostas: Object.assign({}, estado.respostas), acertos: ac };
    estado.historico.push({ t: p.tentativa, ac, tot: total });
    salvarEstado(); location.hash = '#/resultado';
  });
  atualizar();
}

/* ---------- Resultado ---------- */
function viewResultado() {
  if (!estado || !estado.prova) return (location.hash = '#/');
  if (!estado.resultado) return (location.hash = '#/prova');
  const p = estado.prova, res = estado.resultado, resp = res.respostas, materias = getMaterias();
  const erradas = p.questoes.filter((q) => (resp[q.id] || '') !== q.gabarito).map((q) => q.id);
  const total = Math.max(1, p.questoes.length), pct = Math.round(res.acertos / total * 100);
  const catsErradas = [...new Set(p.questoes.filter((q) => erradas.includes(q.id)).map((q) => normalizarCat(q.cat)))];
  const acoes = !erradas.length
    ? '<p class="aviso ok">Parabéns! Você acertou tudo.</p><a class="btn" href="#/">Novo simulado</a>'
    : p.tentativa < MAX_TENTATIVAS
      ? `<button class="btn" id="btn-refazer">Refazer as ${erradas.length} erradas (tentativa ${p.tentativa + 1})</button>`
      : `<p class="aviso">Você usou as ${MAX_TENTATIVAS} tentativas. Revise os resumos e comece um novo simulado.</p><a class="btn" href="#/">Novo simulado</a>`;
  pagina(`<h1>Gabarito · Tentativa ${p.tentativa} de ${MAX_TENTATIVAS}</h1>
  <div class="card resumo-nota">
    <div class="nota ${pct >= 70 ? 'ok' : 'ruim'}">${res.acertos}/${total} <small>${pct}%</small></div>
    <div class="gab-grade">${p.questoes.map((q, i) => { const m = resp[q.id] || '', ok = m === q.gabarito;
      return `<a href="#" data-ir="r${i + 1}" class="gab ${ok ? 'certa' : 'errada'}" title="Sua resposta: ${m || 'em branco'} · Correta: ${q.gabarito}"><b>${i + 1}</b><span>${m || '–'}</span>${ok ? '' : `<em>${q.gabarito}</em>`}</a>`; }).join('')}</div>
    <p class="legenda"><i class="certa"></i> acertou <i class="errada"></i> errou (embaixo, a alternativa correta)</p>
    <div class="acoes">${acoes}</div>
    ${catsErradas.length ? `<p class="revisar">Revise: ${catsErradas.map((c) => `<a href="#/resumo/${encodeURIComponent(c)}">${e(materias[c] || c)}</a>`).join(' ')}</p>` : ''}
    ${estado.historico.length > 1 ? `<p class="hist">Histórico: ${estado.historico.map((h) => `<span>T${h.t}: ${h.ac}/${h.tot}</span>`).join('')}</p>` : ''}
  </div>
  ${p.questoes.map((q, i) => { const m = resp[q.id] || '', ok = m === q.gabarito;
    return `<section class="card questao" id="r${i + 1}"><div class="meta">Questão ${i + 1} · ${e(materias[normalizarCat(q.cat)] || '')} · <b class="${ok ? 'tcerta' : 'terrada'}">${ok ? 'Acertou' : (m ? 'Errou' : 'Em branco')}</b></div>
      <p class="enun">${nl2br(q.enunciado)}</p>
      ${q.opcoes.map((o, k) => { const L = LETRAS[k], cls = L === q.gabarito ? 'certa' : (L === m ? 'errada' : '');
        return `<div class="opcao ${cls}"><span class="letra">${L}</span><span>${e(o)}</span>${L === m ? '<small>sua resposta</small>' : ''}</div>`; }).join('')}
      <div class="expl"><b>Explicação:</b> ${nl2br(q.explicacao || '')}</div></section>`; }).join('')}`);
  $app.querySelectorAll('[data-ir]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); document.getElementById(a.dataset.ir).scrollIntoView({ behavior: 'smooth' }); });
  const br = document.getElementById('btn-refazer');
  if (br) br.onclick = () => {
    const base = ler('questoes').filter((q) => erradas.includes(q.id));
    if (!base.length) return;
    estado = { prova: { tentativa: p.tentativa + 1, questoes: montarProva(base), inicio: Date.now(), nome: p.nome || '' }, resultado: null, historico: estado.historico, respostas: {} };
    salvarEstado(); location.hash = '#/prova';
  };
}

/* ---------- Resumos ---------- */
function viewResumo(cat) {
  const materias = getMaterias(), cn = normalizarCat(cat);
  const ap = ler('apostilas').filter((a) => !cn || normalizarCat(a.cat) === cn);
  pagina(`<h1>Resumos para revisão</h1>
  <div class="filtros"><a class="chip ${!cn ? 'ativo' : ''}" href="#/resumo">Todos</a>
  ${Object.entries(materias).map(([k, v]) => `<a class="chip ${cn === k ? 'ativo' : ''}" href="#/resumo/${encodeURIComponent(k)}">${e(v)}</a>`).join('')}</div>
  ${ap.map((a) => `<article class="card apostila"><div class="meta">${e(materias[normalizarCat(a.cat)] || a.cat)} · ${e(a.nivel ? rotuloNivel(a.nivel) : 'Todos os níveis')}</div>
    <h2>${e(a.titulo)}</h2><div class="texto">${nl2br(a.conteudo)}</div>
    ${pdfSeguro(a.pdf) ? `<p><a class="btn sec" href="${e(pdfSeguro(a.pdf))}" target="_blank" rel="noopener noreferrer">Abrir apostila em PDF</a></p>` : ''}</article>`).join('')}
  ${ap.length ? '' : '<p class="aviso">Nenhum resumo cadastrado para essa matéria.</p>'}`);
}

/* ---------- Admin ---------- */
const flash = (msg, ok = true) => gravarStore('simulador_flash', [msg, ok], sessionStorage);
const pegarFlash = () => { const f = lerStore('simulador_flash', sessionStorage); sessionStorage.removeItem('simulador_flash'); return f; };
function viewLogin() {
  if (online) return viewLoginNuvem();
  pagina('<h1>Administração indisponível</h1><p class="aviso">Configure a autenticação do Supabase para acessar esta área.</p>');
}
function viewLoginNuvem() {
  pagina(`<h1>Entrar no painel</h1><p class="aviso oculto" id="erro" role="alert"></p>
    <form class="card estreito" id="f-login"><label>E-mail <input type="email" name="email" autocomplete="username" required></label>
    <label>Senha <input type="password" name="senha" autocomplete="current-password" required></label>
    <button class="btn">Entrar</button><p class="sub">Use a conta de administrador cadastrada no Supabase Authentication.</p></form>`);
  document.getElementById('f-login').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target, btn = f.querySelector('button'), erro = document.getElementById('erro');
    if (btn.disabled) return;
    btn.disabled = true; erro.classList.add('oculto');
    try { await nuvem.signIn(f.email.value.trim(), f.senha.value); admin = true; rota(); }
    catch (error) { erro.textContent = error.message; erro.classList.remove('oculto'); }
    finally { btn.disabled = false; }
  };
}
const selMateria = (nome, materias, vazio = '-- Selecione a matéria --', req = true, atual = '') =>
  `<select name="${nome}" ${req ? 'required' : ''}><option value="">${e(vazio)}</option>${Object.entries(materias).map(([k, v]) => `<option value="${e(k)}" ${k === atual ? 'selected' : ''}>${e(v)}</option>`).join('')}</select>`;
const opNiveis = (atual = '', todos = true) => (todos ? `<option value="">Todos os níveis</option>` : '<option value="">Não informado</option>') + Object.entries(getNiveis()).map(([k, v]) => `<option value="${e(k)}" ${k === normalizarNivel(atual) ? 'selected' : ''}>${e(v)}</option>`).join('');
const lapis = (tipo, id) => `<a class="btn sec peq btn-icone" href="#/admin/editar/${tipo}/${encodeURIComponent(id)}" title="Editar" aria-label="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></a> `;

/* importação em lote (JSON) — mesma tolerância do PHP */
function normalizarNivel(valor) {
  const nivel = slugify(valor);
  if (!nivel || ['sem_nivel', 'nao_informado'].includes(nivel)) return '';
  if (nivel.includes('fundamental') || ['basico', '1_grau', 'primeiro_grau'].includes(nivel)) return 'fundamental';
  if (nivel.includes('medio') || ['2_grau', 'segundo_grau'].includes(nivel)) return 'medio';
  if (nivel.includes('superior') || ['graduacao', '3_grau', 'terceiro_grau'].includes(nivel)) return 'superior';
  if (['tecnico', 'ensino_tecnico'].includes(nivel)) return 'tecnico';
  return nivel;
}
function lerJsonQuestoes(txt) {
  txt = String(txt || '').replace(/^\uFEFF/, '').trim().replace(/^```[a-zA-Z]*\s*|\s*```$/g, '');
  let d; try { d = JSON.parse(txt); } catch (e1) {
    try { d = JSON.parse(txt.replace(/[“”„]/g, '"').replace(/,\s*([\]}])/g, '$1')); } catch (e2) { return { erro: 'JSON inválido: ' + e2.message }; }
  }
  if (d === null || typeof d !== 'object') return { erro: 'O JSON precisa ser uma lista de questões.' };
  if (Array.isArray(d.questoes)) d = d.questoes; else if (!Array.isArray(d) && (d.enunciado || d.pergunta)) d = [d];
  return { itens: Array.isArray(d) ? d : Object.values(d) };
}
function normalizarQuestao(q, nivelPadrao = '') {
  if (!q || typeof q !== 'object') return { erro: 'item não é um objeto' };
  const enun = String(q.enunciado ?? q.pergunta ?? q.questao ?? '').trim(); if (!enun) return { erro: 'sem enunciado' };
  let ops = q.opcoes ?? q.alternativas ?? q.options;
  if (ops && typeof ops === 'object' && !Array.isArray(ops)) {
    const entradas = Object.entries(ops).sort(([a], [b]) => a.toUpperCase().localeCompare(b.toUpperCase()));
    if (!entradas.length || entradas.some(([letra, texto], i) => letra.toUpperCase() !== LETRAS[i] || typeof texto !== 'string' || !texto.trim())) return { erro: 'alternativas devem usar letras consecutivas de A a E e textos não vazios' };
    ops = entradas.map(([, texto]) => texto);
  }
  if (!Array.isArray(ops)) return { erro: 'sem "opcoes" (use uma lista ou um objeto com letras de A a E)' };
  let t = ops.map((o) => String(typeof o === 'object' && o ? (o.texto ?? o.text ?? '') : o).trim()).filter(Boolean);
  if (t.length && t.every((o, i) => new RegExp('^\\(?' + LETRAS[i % 5] + '[\\)\\.\\-:]\\s+', 'i').test(o))) t = t.map((o) => o.replace(/^\(?[A-Ea-e][\)\.\-:]\s+/, ''));
  const n = t.length; if (n < 2 || n > 5) return { erro: `precisa ter de 2 a 5 alternativas (veio ${n})` };
  const c = q.correta ?? q.gabarito ?? q.resposta_correta ?? q.resposta; let idx = null;
  if (typeof c === 'string' && /^\s*[A-Ea-e]\s*$/.test(c)) idx = c.trim().toUpperCase().charCodeAt(0) - 65;
  else if (typeof c === 'number' || (typeof c === 'string' && /^\d+$/.test(c.trim()))) idx = +c;
  else if (typeof c === 'string') { const k = t.map((x) => x.toLowerCase()).indexOf(c.trim().toLowerCase()); if (k >= 0) idx = k; }
  if (idx === null || idx < 0 || idx >= n) return { erro: 'resposta correta inválida (use "A" a "E")' };
  const nivel = normalizarNivel(q.nivel ?? q.ensino ?? q.escolaridade ?? q.nivel_ensino ?? nivelPadrao);
  return { q: { enunciado: enun, opcoes: t, correta: idx, nivel, explicacao: String(q.explicacao ?? q.comentario ?? q.justificativa ?? '').trim() }, cat: String(q.cat ?? q.disciplina ?? q.materia ?? '').trim() };
}
function adicionarQuestoes(itens, catForcada = '', nivelPadrao = '') {
  const r = { add: 0, dup: 0, erros: [], criadas: {} }, todas = ler('questoes'), vistos = new Set();
  todas.forEach((q) => vistos.add(normalizarCat(q.cat) + '|' + normalizarNivel(q.nivel) + '|' + String(q.enunciado || '').trim().toLowerCase()));
  itens.forEach((item, i) => {
    const n = normalizarQuestao(item, nivelPadrao); if (n.erro) return r.erros.push(`Questão ${i + 1}: ${n.erro}`);
    let cat = catForcada;
    if (!cat) {
      if (!n.cat) return r.erros.push(`Questão ${i + 1}: sem matéria ("cat") e nenhuma matéria escolhida`);
      const existia = !!getMaterias()[normalizarCat(n.cat)]; cat = salvarDisciplina(n.cat);
      if (cat === false) return r.erros.push(`Questão ${i + 1}: matéria inválida`);
      if (!existia) r.criadas[cat] = n.cat;
    }
    const chave = cat + '|' + n.q.nivel + '|' + n.q.enunciado.toLowerCase(); if (vistos.has(chave)) return r.dup++;
    vistos.add(chave); todas.push(Object.assign({ id: proximoId(todas, 'q'), cat }, n.q)); r.add++;
  });
  return r;
}

function viewAdmin(ancora) {
  if (online && falhaConexao) {
    pagina(`<h1>Conexão pendente</h1><p class="aviso">${e(falhaConexao)}</p><button class="btn" id="reconectar">Tentar novamente</button>`);
    document.getElementById('reconectar').onclick = iniciar; return;
  }
  if (!online || !admin) return viewLogin();
  const materias = getMaterias(), cont = contarPorCat(), apostilas = ler('apostilas'), simulados = ler('simulados');
  const parametros = new URLSearchParams((location.hash.split('?')[1]) || '');
  const filtro = normalizarCat(parametros.get('cat') || '');
  const filtroNivel = parametros.get('nivel') || '';
  const questoes = ler('questoes').filter((q) => (!filtro || normalizarCat(q.cat) === filtro) && doNivel(q, filtroNivel));
  const paginas = Math.max(1, Math.ceil(questoes.length / 30));
  const numeroPagina = Math.max(1, Math.min(paginas, parseInt(parametros.get('pagina'), 10) || 1));
  const ordemEnsino = niveisDisponiveis().map(([nivel]) => nivel);
  const questoesOrdenadas = questoes.slice().reverse().sort((a, b) => ordemEnsino.indexOf(normalizarNivel(a.nivel) || 'sem_nivel') - ordemEnsino.indexOf(normalizarNivel(b.nivel) || 'sem_nivel'));
  const questoesPagina = questoesOrdenadas.slice((numeroPagina - 1) * 30, numeroPagina * 30);
  const linkPagina = (numero) => '#/admin/lista?cat=' + encodeURIComponent(filtro) + '&nivel=' + encodeURIComponent(filtroNivel) + '&pagina=' + numero;
  const fl = pegarFlash();
  const exemplo = '[\n  {\n    "cat": "Informática",\n    "nivel": "medio",\n    "enunciado": "Texto da pergunta...",\n    "opcoes": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D", "Alternativa E"],\n    "correta": "C",\n    "explicacao": "Por que a C está certa..."\n  }\n]';
  const chk = (n) => Object.entries(materias).map(([k, v]) => `<label class="chip"><input type="checkbox" name="${n}" value="${e(k)}"> ${e(v)} <small>${cont[k] || 0}</small></label>`).join('');
  pagina(`<div class="topo-admin"><h1>Painel de Administração</h1><button class="btn sec peq" id="sair">Sair</button></div>
  ${fl ? `<p class="aviso ${fl[1] ? 'ok' : ''} relatorio">${e(fl[0])}</p>` : ''}
  <p class="sub" id="estado-nuvem" role="status">${online ? 'Conectado ao Supabase. As alterações salvas ficam disponíveis para todos os visitantes.' : 'Modo local: as alterações ficam salvas apenas neste navegador.'}</p>
  ${online && !publicado ? '<p class="aviso">O banco ainda está vazio. Publique o conteúdo inicial ou importe seu backup.</p><button class="btn" id="publicar">Publicar conteúdo inicial</button>' : ''}

  <details class="card secao" id="materias"><summary><h2>1. Matérias (disciplinas)</h2><span class="seta" aria-hidden="true"></span></summary>
    <form class="linha-op" data-f="nova_disciplina"><input type="text" name="nome" placeholder="Nova matéria. Ex.: Informática, Direitos Humanos" required><button class="btn" type="submit">Cadastrar</button></form>
    <div class="tabela"><table><tr><th>Matéria</th><th>Questões</th><th>Apostilas</th><th></th></tr>
    ${Object.entries(materias).map(([k, v]) => `<tr><td>${e(v)}</td><td><a href="#/admin?cat=${encodeURIComponent(k)}" data-lista="${e(k)}">${cont[k] || 0}</a></td>
      <td>${apostilas.filter((a) => normalizarCat(a.cat) === k).length}</td>
      <td style="text-align:right">${MATERIAS_PADRAO[k] ? '' : `<button class="btn sec peq" data-del="disciplina" data-id="${e(k)}">Excluir</button>`}</td></tr>`).join('')}</table></div></details>

  <details class="card secao" id="simulados"><summary><h2>2. Simulados prontos</h2><span class="seta" aria-hidden="true"></span></summary>
    <p class="sub">Cria um simulado com nome próprio, que aparece na página inicial com um botão "Iniciar".</p>
    <form data-f="novo_simulado"><label>Nome do simulado <input type="text" name="nome" placeholder="Ex.: Simulado Monitor de Creche, nível médio" required></label>
      <label>Descrição (opcional) <input type="text" name="descricao"></label>
      <fieldset><legend>Matérias incluídas <small>(nenhuma marcada = todas)</small></legend><div class="checks">${chk('cats')}</div></fieldset>
      <div class="duas"><label>Nível <select name="nivel">${opNiveis()}</select></label>
      <label>Nº de questões (0 = todas, máx. 100) <input type="number" name="qtd" value="20" min="0" max="100"></label></div>
      <button class="btn" type="submit">Criar simulado</button></form>
    ${simulados.length ? `<div class="tabela"><table><tr><th>Simulado</th><th>Matérias</th><th>Qtd</th><th></th></tr>
      ${simulados.map((s) => `<tr><td><b>${e(s.nome)}</b></td><td>${e((s.cats || []).map((c) => materias[c] || c).join(', ') || 'Todas')}</td><td>${+s.qtd || 'todas'}</td>
      <td class="acoes-td">${lapis('simulado', s.id)}<button class="btn sec peq" data-del="simulado" data-id="${e(s.id)}">Excluir</button></td></tr>`).join('')}</table></div>` : ''}</details>

  <details class="card secao" id="questao"><summary><h2>3. Adicionar uma questão</h2><span class="seta" aria-hidden="true"></span></summary>
    <form data-f="nova_questao"><div class="duas"><label>Matéria ${selMateria('cat', materias)}</label><label>Nível <select name="nivel">${opNiveis('medio', false)}</select></label></div>
      <label>Enunciado <textarea name="enunciado" rows="3" required placeholder="Use uma situação prática, no nível de concurso..."></textarea></label>
      ${LETRAS.map((L, i) => `<label class="linha-op"><input type="radio" name="correta" value="${i}" required title="Marcar como correta"><b>${L}</b><input type="text" name="op${i}" placeholder="Alternativa ${L}" ${i < 2 ? 'required' : ''}></label>`).join('')}
      <small>Marque o círculo da alternativa correta. As letras são embaralhadas a cada prova.</small>
      <label>Explicação do gabarito <textarea name="explicacao" rows="3"></textarea></label><button class="btn" type="submit">Cadastrar questão</button></form></details>

  <details class="card secao" id="lote"><summary><h2>4. Adicionar várias questões de uma vez (JSON)</h2><span class="seta" aria-hidden="true"></span></summary>
    <form data-f="questoes_lote"><label>Matéria de destino ${selMateria('cat_lote', materias, '-- Usar o campo "cat" de cada questão --', false)}</label>
      <small>Escolhendo uma matéria acima, <b>todas</b> as questões vão para ela. Sem escolher, cada questão usa o seu "cat" e a matéria é criada se ainda não existir.</small>
      <p class="sub">O ensino é identificado pelo campo <b>nivel</b> de cada questão e aparece automaticamente nos filtros. Sem esse campo, a questão fica como “Não informado”.</p>
      <label>Cole a lista JSON <textarea name="json" rows="4" style="font-family:monospace" placeholder="${e(exemplo)}"></textarea></label>
      <label>…ou envie um arquivo .json <input type="file" name="arquivo" accept=".json,application/json"></label>
      <small>Campos: <b>enunciado</b>, <b>opcoes</b> (2 a 5 textos), <b>correta</b> ("A" a "E"), explicacao, nivel, cat. Questões repetidas na mesma matéria e ensino são ignoradas.</small><br>
      <button class="btn" type="submit" style="margin-top:10px">Importar questões</button></form></details>

  <details class="card secao" id="apostilas"><summary><h2>5. Apostilas e resumos</h2><span class="seta" aria-hidden="true"></span></summary>
    <form data-f="nova_apostila"><label>Título <input type="text" name="titulo" required></label>
      <div class="duas"><label>Matéria ${selMateria('cat', materias)}</label><label>Nível <select name="nivel">${opNiveis()}</select></label></div>
      <label>Conteúdo do resumo <textarea name="conteudo" rows="6"></textarea></label>
      ${campoArquivoPdf()}
      <label>Link ou caminho do PDF (opcional) <input type="text" name="pdf" placeholder="pdfs/arquivo.pdf ou https://..."></label>
      <button class="btn" type="submit" style="margin-top:10px">Salvar apostila</button></form>
    ${apostilas.length ? `<div class="tabela"><table><tr><th>Título</th><th>Matéria</th><th>PDF</th><th></th></tr>
      ${apostilas.map((a) => `<tr><td><b>${e(a.titulo)}</b></td><td>${e(materias[normalizarCat(a.cat)] || a.cat)}</td><td>${a.pdf ? 'Sim' : 'Não'}</td>
      <td class="acoes-td">${lapis('apostila', a.id)}<button class="btn sec peq" data-del="apostila" data-id="${e(a.id)}">Excluir</button></td></tr>`).join('')}</table></div>` : ''}</details>

  <details class="card secao" id="lista" data-lembrar="lista">
    <summary><h2>6. Questões cadastradas (${questoes.length})</h2><span class="seta" aria-hidden="true"></span></summary>
    <div class="duas"><label>Filtrar por ensino <select id="filtro-nivel"><option value="">Todos os níveis</option>${niveisDisponiveis().map(([k,v,n]) => `<option value="${e(k)}" ${k === filtroNivel ? 'selected' : ''}>${e(v)} (${n})</option>`).join('')}</select></label>
      <label>Filtrar por matéria <select id="filtro-cat"><option value="">Todas as matérias</option>${Object.entries(materias).map(([k, v]) => `<option value="${e(k)}" ${k === filtro ? 'selected' : ''}>${e(v)} (${cont[k] || 0})</option>`).join('')}</select></label></div>
    <div class="tabela"><table>${questoesPagina.map((q) => `<tr><td>${e(materias[normalizarCat(q.cat)] || q.cat || '')}<br><small>${e(rotuloNivel(q.nivel))}</small></td>
      <td>${e((q.enunciado || '').length > 120 ? q.enunciado.slice(0, 120) + '…' : q.enunciado)}</td>
      <td class="acoes-td">${lapis('questao', q.id)}<button class="btn sec peq" data-del="questao" data-id="${e(q.id)}">Excluir</button></td></tr>`).join('')}</table></div>
    <nav class="paginacao" aria-label="Páginas de questões">${numeroPagina > 1 ? `<a class="btn sec peq" href="${e(linkPagina(numeroPagina - 1))}">Anterior</a>` : '<span></span>'}
      <span>Página ${numeroPagina} de ${paginas} · ${questoes.length} questões</span>
      ${numeroPagina < paginas ? `<a class="btn sec peq" href="${e(linkPagina(numeroPagina + 1))}">Próxima</a>` : '<span></span>'}</nav></details>

  <details class="card secao" id="backup"><summary><h2>7. Backup</h2><span class="seta" aria-hidden="true"></span></summary>
    <p class="sub">Exporte tudo (questões, resumos, matérias e simulados) em um arquivo, ou importe um backup anterior.</p>
    <button class="btn" id="exportar">Exportar backup (.json)</button>
    <label style="display:inline-block;margin-left:10px">Importar backup <input type="file" id="importar" accept=".json,application/json"></label>
    <p><button class="btn sec peq" id="restaurar">Restaurar dados originais</button></p></details>`);

  const secao = document.getElementById(ancora || (filtro || filtroNivel || parametros.has('pagina') ? 'lista' : ''));
  if (secao) { secao.open = true; secao.scrollIntoView(); }
  const volta = (a, msg, ok = true) => { if (msg) flash(msg, ok); const alvo = '#/admin/' + a; if (location.hash === alvo) rota(); else location.hash = alvo; };
  document.getElementById('sair').onclick = async () => {
    if (ocupado) return;
    admin = false; sessionStorage.removeItem('simulador_logado');
    try { if (online) await nuvem.signOut(); }
    catch (_) { /* A sessão local já foi encerrada. */ }
    location.hash = '#/';
  };
  const publicar = document.getElementById('publicar');
  if (publicar) publicar.onclick = async () => { await salvarDB(); volta('', 'Conteúdo publicado no Supabase.'); };
  const atualizarFiltros = () => { location.hash = '#/admin/lista?cat=' + encodeURIComponent(document.getElementById('filtro-cat').value) + '&nivel=' + encodeURIComponent(document.getElementById('filtro-nivel').value); };
  document.getElementById('filtro-cat').onchange = atualizarFiltros;
  document.getElementById('filtro-nivel').onchange = atualizarFiltros;
  const det = document.getElementById('lista'); try { if (!secao && localStorage.getItem('secao_lista') === 'fechada') det.open = false; } catch (er) {}
  det.addEventListener('toggle', () => { try { localStorage.setItem('secao_lista', det.open ? 'aberta' : 'fechada'); } catch (er) {} });

  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    const t = b.dataset.del, id = b.dataset.id;
    if (!confirm('Excluir ' + { disciplina: 'esta matéria', simulado: 'este simulado', apostila: 'esta apostila', questao: 'esta questão' }[t] + '?')) return;
    if (t === 'disciplina') { const r = excluirDisciplina(id); if (r === true) await salvarDB(); return volta('materias', r === true ? 'Matéria excluída.' : r, r === true); }
    const chave = { simulado: 'simulados', apostila: 'apostilas', questao: 'questoes' }[t], n = DB[chave].length;
    DB[chave] = DB[chave].filter((x) => x.id !== id); await salvarDB();
    volta({ simulado: 'simulados', apostila: 'apostilas', questao: 'lista' }[t], DB[chave].length < n ? 'Excluído.' : 'Não foi possível excluir.', DB[chave].length < n);
  });
  $app.querySelectorAll('form[data-f]').forEach((f) => f.onsubmit = async (ev) => {
    ev.preventDefault(); const a = f.dataset.f, v = (n) => (f.elements[n] ? f.elements[n].value : '');
    const cats = [...f.querySelectorAll('[name=cats]:checked')].map((i) => i.value);
    if (a === 'nova_disciplina') {
      const nome = v('nome').trim(); if (!slugify(nome)) return volta('materias', 'Informe o nome da matéria.', false);
      const ja = !!getMaterias()[normalizarCat(nome)]; salvarDisciplina(nome); if (!ja) await salvarDB();
      return volta('materias', ja ? `A matéria "${nome}" já existia.` : `Matéria "${nome}" cadastrada.`);
    }
    if (a === 'novo_simulado') {
      const nivel = getNiveis()[normalizarNivel(v('nivel'))] ? normalizarNivel(v('nivel')) : '', qtd = Math.max(0, Math.min(100, +v('qtd') || 0));
      if (!filtrarQuestoes(cats, nivel).length) return volta('simulados', 'Não há questões para essa combinação de matérias e nível. Cadastre questões antes.', false);
      ler('simulados').push({ id: proximoId(ler('simulados'), 's'), nome: v('nome').trim(), descricao: v('descricao').trim(), cats: cats.map(normalizarCat).filter(Boolean), nivel, qtd });
      await salvarDB(); return volta('simulados', `Simulado "${v('nome').trim()}" criado. Ele já aparece na página inicial.`);
    }
    if (a === 'nova_apostila') {
      const titulo = v('titulo').trim(), cat = v('cat'), conteudo = v('conteudo').trim();
      if (!(titulo && cat && (conteudo || v('pdf').trim() || f.elements.arquivo_pdf.files.length))) return volta('apostilas', 'Preencha título, matéria e conteúdo (ou selecione um PDF).', false);
      const pdf = await pdfDoFormulario(f);
      ler('apostilas').push({ id: proximoId(ler('apostilas'), 'a'), cat: normalizarCat(cat), nivel: v('nivel'), titulo, conteudo, pdf }); await salvarDB();
      return volta('apostilas', 'Apostila adicionada.');
    }
    if (a === 'nova_questao') {
      const cat = normalizarCat(v('cat')); if (!getMaterias()[cat]) return volta('questao', 'Selecione a matéria.', false);
      const idx = +v('correta'), lim = []; let novo = null;
      LETRAS.forEach((_, i) => { const o = v('op' + i).trim(); if (!o) return; if (i === idx) novo = lim.length; lim.push(o); });
      if (novo === null) return volta('questao', 'A alternativa marcada como correta está vazia.', false);
      const r = adicionarQuestoes([{ enunciado: v('enunciado'), opcoes: lim, correta: LETRAS[novo], explicacao: v('explicacao') }], cat, v('nivel') || 'medio');
      if (r.add) await salvarDB();
      return volta('questao', r.add ? `Questão cadastrada em "${getMaterias()[cat]}".` : r.dup ? 'Essa questão já existe nesta matéria.' : (r.erros.join('\n') || 'Questão inválida.'), !!r.add);
    }
    if (a === 'questoes_lote') {
      let texto = v('json'); const arq = f.elements.arquivo.files[0]; if (arq) texto = await arq.text();
      const L = lerJsonQuestoes(texto); if (L.erro) return volta('lote', L.erro + '\nDica: cole só o array [ ... ] e confira vírgulas e aspas.', false);
      if (!L.itens.length) return volta('lote', 'A lista está vazia.', false);
      const catF = v('cat_lote') ? normalizarCat(v('cat_lote')) : '', r = adicionarQuestoes(L.itens, catF);
      if (r.add || Object.keys(r.criadas).length) await salvarDB();
      let msg = `Lidas: ${L.itens.length} · Adicionadas: ${r.add} · Duplicadas ignoradas: ${r.dup} · Com erro: ${r.erros.length}`;
      if (catF) msg += '\nMatéria de destino: ' + (getMaterias()[catF] || catF);
      if (Object.keys(r.criadas).length) msg += '\nMatérias criadas automaticamente: ' + Object.values(r.criadas).join(', ');
      if (r.erros.length) msg += '\n' + r.erros.slice(0, 12).join('\n') + (r.erros.length > 12 ? `\n… e mais ${r.erros.length - 12} erros.` : '');
      return volta('lote', msg, r.add > 0);
    }
  });
  document.getElementById('exportar').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'simulador-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(url);
  };
  document.getElementById('importar').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.questoes)) throw new Error('arquivo sem a lista "questoes"');
      if (!confirm('Isto substitui TODOS os dados atuais pelos do backup. Continuar?')) return;
      const dados = { questoes: d.questoes, apostilas: d.apostilas || [], disciplinas: d.disciplinas || [], simulados: d.simulados || [] };
      if (!nuvem.validData(dados)) throw new Error('listas de conteúdo inválidas');
      DB = dados;
    } catch (er) { return volta('backup', 'Backup inválido: ' + er.message, false); }
    await salvarDB(); volta('backup', 'Backup importado.');
  };
  document.getElementById('restaurar').onclick = async () => {
    if (!confirm('Apagar todas as suas alterações e voltar aos dados originais?')) return;
    DB = await carregarBase(); await salvarDB(); volta('backup', 'Dados originais restaurados.');
  };
  protegerAcoes();
}

/* ---------- Editar ---------- */
function viewEditar(tipo, id) {
  if (online && falhaConexao) return viewAdmin('');
  if (!online || !admin) return viewLogin();
  const mapa = { questao: ['questoes', 'lista'], simulado: ['simulados', 'simulados'], apostila: ['apostilas', 'apostilas'] };
  if (!mapa[tipo]) return (location.hash = '#/admin');
  const [chave, ancora] = mapa[tipo], idx = ler(chave).findIndex((x) => x.id === id);
  if (idx < 0) { flash('Item não encontrado.', false); return (location.hash = '#/admin/' + ancora); }
  const item = ler(chave)[idx], materias = getMaterias(), fl = pegarFlash();
  let corpo = '';
  if (tipo === 'questao') corpo = `<div class="duas"><label>Matéria ${selMateria('cat', materias, '-- Selecione --', true, normalizarCat(item.cat))}</label><label>Nível <select name="nivel">${opNiveis(item.nivel, false)}</select></label></div>
    <label>Enunciado <textarea name="enunciado" rows="5" required>${e(item.enunciado)}</textarea></label>
    ${LETRAS.map((L, i) => `<label class="linha-op"><input type="radio" name="correta" value="${i}" required ${+item.correta === i ? 'checked' : ''} title="Marcar como correta"><b>${L}</b><input type="text" name="op${i}" value="${e(item.opcoes[i] || '')}" placeholder="Alternativa ${L}"></label>`).join('')}
    <label>Explicação do gabarito <textarea name="explicacao" rows="4">${e(item.explicacao)}</textarea></label>`;
  else if (tipo === 'simulado') corpo = `<label>Nome do simulado <input type="text" name="nome" value="${e(item.nome)}" required></label>
    <label>Descrição <input type="text" name="descricao" value="${e(item.descricao)}"></label>
    <fieldset><legend>Matérias incluídas <small>(nenhuma marcada = todas)</small></legend><div class="checks">${Object.entries(materias).map(([k, v]) => `<label class="chip"><input type="checkbox" name="cats" value="${e(k)}" ${(item.cats || []).includes(k) ? 'checked' : ''}> ${e(v)}</label>`).join('')}</div></fieldset>
    <div class="duas"><label>Nível <select name="nivel">${opNiveis(item.nivel)}</select></label><label>Nº de questões (0 = todas) <input type="number" name="qtd" min="0" max="100" value="${+item.qtd || 0}"></label></div>`;
  else corpo = `<label>Título <input type="text" name="titulo" value="${e(item.titulo)}" required></label>
    <div class="duas"><label>Matéria ${selMateria('cat', materias, '-- Selecione --', true, normalizarCat(item.cat))}</label><label>Nível <select name="nivel">${opNiveis(item.nivel)}</select></label></div>
    <label>Conteúdo do resumo <textarea name="conteudo" rows="12">${e(item.conteudo)}</textarea></label>
    ${campoArquivoPdf()}
    <label>Link ou caminho do PDF (vazio = sem PDF) <input type="text" name="pdf" value="${e(item.pdf || '')}"></label>`;
  pagina(`<div class="topo-admin"><h1>Editar ${tipo === 'questao' ? 'questão' : tipo}</h1><a class="btn sec peq" href="#/admin/${ancora}">← Voltar ao painel</a></div>
  ${fl ? `<p class="aviso ${fl[1] ? 'ok' : ''} relatorio">${e(fl[0])}</p>` : ''}
  <form class="card" id="f-edit">${corpo}<button class="btn" type="submit">Salvar alterações</button> <a class="btn sec" href="#/admin/${ancora}">Cancelar</a></form>`);
  document.getElementById('f-edit').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target, v = (n) => f.elements[n].value; let erro = null;
    if (tipo === 'questao') {
      const cat = normalizarCat(v('cat')), ci = +v('correta'), lim = []; let novo = null;
      LETRAS.forEach((_, i) => { const o = v('op' + i).trim(); if (!o) return; if (i === ci) novo = lim.length; lim.push(o); });
      if (novo === null) erro = 'A alternativa marcada como correta está vazia.';
      else if (lim.length < 2) erro = 'Preencha ao menos 2 alternativas.';
      else ler(chave)[idx] = { id, cat, nivel: v('nivel'), enunciado: v('enunciado').trim(), opcoes: lim, correta: novo, explicacao: v('explicacao').trim() };
    } else if (tipo === 'simulado') {
      const cats = [...f.querySelectorAll('[name=cats]:checked')].map((i) => i.value), nivel = getNiveis()[normalizarNivel(v('nivel'))] ? normalizarNivel(v('nivel')) : '';
      if (!v('nome').trim()) erro = 'Dê um nome ao simulado.';
      else if (!filtrarQuestoes(cats, nivel).length) erro = 'Não há questões para essa combinação de matérias e nível.';
      else ler(chave)[idx] = { id, nome: v('nome').trim(), descricao: v('descricao').trim(), cats: cats.map(normalizarCat).filter(Boolean), nivel, qtd: Math.max(0, Math.min(100, +v('qtd') || 0)) };
    } else {
      if (!v('titulo').trim() || (!v('conteudo').trim() && !v('pdf').trim() && !f.elements.arquivo_pdf.files.length)) erro = 'Preencha o título e o conteúdo (ou selecione um PDF).';
      else ler(chave)[idx] = { id, cat: normalizarCat(v('cat')), nivel: v('nivel'), titulo: v('titulo').trim(), conteudo: v('conteudo').trim(), pdf: await pdfDoFormulario(f) };
    }
    if (erro) { flash(erro, false); return viewEditar(tipo, id); }
    await salvarDB(); flash('Alterações salvas.', true); location.hash = '#/admin/' + ancora;
  };
  protegerAcoes();
}

async function iniciar() {
  pronto = !online; falhaConexao = ''; admin = false; rota();
  if (online) {
    try {
      const dados = await nuvem.load();
      publicado = !!dados; DB = dados || await carregarBase();
      try { admin = await nuvem.isAdmin(); } catch (_) { admin = false; }
    } catch (error) {
      falhaConexao = error.message;
      try { DB = await carregarBase(); } catch (_) { DB = clone(DADOS_VAZIOS); }
    }
    pronto = true;
  } else if (!lerStore(LS, localStorage)) {
    pronto = false;
    try { DB = await carregarBase(); } catch (error) { falhaConexao = error.message; }
    pronto = true;
  }
  rota();
}
iniciar();
})();
