const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/supabase.js'), 'utf8');
const dados = { questoes: [], apostilas: [], disciplinas: [], simulados: [] };
const goodSession = { access_token: 'jwt-usuario', refresh_token: 'refresh', expires_at: 9999999999, user: { id: 'admin-id' } };

function client(replies, options = {}) {
  const calls = [], storage = new Map();
  if (options.session) storage.set('simulador_supabase_session:https://teste.supabase.co', JSON.stringify(options.session));
  const context = {
    window: { SUPABASE_CONFIG: { url: 'https://teste.supabase.co/rest/v1/', publicKey: options.key || 'sb_publishable_teste' } },
    sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    atob, AbortSignal, Date,
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      const reply = replies.shift();
      assert.ok(reply, 'requisição inesperada: ' + url);
      if (reply instanceof Error) throw reply;
      return { ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(reply.data) };
    }
  };
  vm.runInNewContext(source, context);
  return { api: context.window.SimuladorNuvem, calls, storage };
}
const ok = data => ({ status: 200, data });

test('leitura pública normaliza URL e não envia publishable como Bearer', async () => {
  const { api, calls } = client([ok([{ dados, versao: 3 }])]);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.load())), dados);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers.apikey, 'sb_publishable_teste');
  assert.match(calls[0].url, /^https:\/\/teste.supabase.co\/rest\/v1\/simulador_conteudo/);
});
test('banco vazio não causa publicação automática', async () => {
  const { api, calls } = client([ok([])]);
  assert.equal(await api.load(), null);
  assert.equal(calls.length, 1);
});
test('tabela ausente mostra a migração necessária', async () => {
  const { api } = client([{ status: 404, data: { code: 'PGRST205' } }]);
  await assert.rejects(api.load(), /001_simulador.sql/);
});
test('falha de rede é comunicada e não vira sucesso', async () => {
  const { api } = client([new Error('offline')]);
  await assert.rejects(api.load(), /conectar ao Supabase/);
});
test('conteúdo remoto malformado é rejeitado', async () => {
  const { api } = client([ok([{ dados: { questoes: [] }, versao: 1 }])]);
  await assert.rejects(api.load(), /formato inválido/);
});
test('chave secreta e service_role são bloqueadas antes da rede', async () => {
  for (const key of ['sb_secret_teste', 'header.' + btoa(JSON.stringify({ role: 'service_role' })) + '.sig']) {
    const { api, calls } = client([], { key });
    await assert.rejects(api.load(), /somente a chave pública/);
    assert.equal(calls.length, 0);
  }
});
test('salvamento sem sessão é recusado', async () => {
  const { api, calls } = client([]);
  await assert.rejects(api.save(dados), /Entre novamente/);
  assert.equal(calls.length, 0);
});
test('login exige usuário na lista de administradores e limpa sessão recusada', async () => {
  const { api, calls, storage } = client([ok(goodSession), ok([]), ok(null)]);
  await assert.rejects(api.signIn('aluno@example.test', 'teste'), /não tem permissão/);
  assert.equal(storage.size, 0);
  assert.match(calls[2].url, /logout/);
});
test('login autorizado envia JWT e salva usando a versão lida', async () => {
  const { api, calls } = client([ok([{ dados, versao: 7 }]), ok(goodSession), ok([{ user_id: 'admin-id' }]), ok(8), ok(9)]);
  await api.load(); await api.signIn('admin@example.test', 'teste');
  await api.save(dados); await api.save(dados);
  assert.equal(calls[3].headers.Authorization, 'Bearer jwt-usuario');
  assert.equal(JSON.parse(calls[3].body).versao_esperada, 7);
  assert.equal(JSON.parse(calls[4].body).versao_esperada, 8);
});
test('conflito não avança versão nem tenta sobrescrever silenciosamente', async () => {
  const { api, calls } = client([ok([{ dados, versao: 4 }]), { status: 400, data: { code: 'P0001', message: 'version_conflict' } }, ok(5)], { session: goodSession });
  await api.load();
  await assert.rejects(api.save(dados), /Outra sessão/);
  await api.save(dados);
  assert.equal(JSON.parse(calls[2].body).versao_esperada, 4);
});
test('sessão expirada é renovada antes de gravar', async () => {
  const { api, calls } = client([ok({ ...goodSession, access_token: 'jwt-renovado' }), ok(1)], { session: { ...goodSession, expires_at: 1 } });
  await api.save(dados);
  assert.match(calls[0].url, /grant_type=refresh_token/);
  assert.equal(calls[1].headers.Authorization, 'Bearer jwt-renovado');
});
test('logout limpa sessão mesmo se a rede falhar', async () => {
  const { api, storage } = client([new Error('offline')], { session: goodSession });
  await assert.rejects(api.signOut());
  assert.equal(storage.size, 0);
  await assert.rejects(api.save(dados), /Entre novamente/);
});

async function appStart(cloud) {
  const appSource = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/app.js'), 'utf8');
  const storage = new Map([
    ['simulador_logado', '1'],
    ['simulador_dados_v1', JSON.stringify({ ...dados, apostilas: [{ titulo: 'Backup local antigo', conteudo: 'local' }] })]
  ]);
  const store = { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  const app = { innerHTML: '' }, login = {};
  const context = {
    window: { DADOS_BASE: dados, SimuladorNuvem: { configured: true, ...cloud }, addEventListener() {}, scrollTo() {} },
    document: { getElementById: id => id === 'app' ? app : login },
    location: { hash: '#/resumo' }, localStorage: store, sessionStorage: store,
    clearInterval() {}, URLSearchParams
  };
  vm.runInNewContext(appSource.replace(/iniciar\(\);\s*\}\)\(\);\s*$/, 'window.ready = iniciar(); window.route = rota; })();'), context);
  await context.window.ready;
  return { context, app, storage, login };
}
test('inicialização usa conteúdo remoto e preserva o backup local antigo', async () => {
  const remote = { ...dados, apostilas: [{ titulo: 'Resumo compartilhado', conteudo: 'nuvem' }] };
  const { app, storage } = await appStart({ load: async () => remote, isAdmin: async () => false });
  assert.match(app.innerHTML, /Resumo compartilhado/);
  assert.doesNotMatch(app.innerHTML, /Backup local antigo/);
  assert.match(storage.get('simulador_dados_v1'), /Backup local antigo/);
});
test('indisponibilidade mantém leitura original e bloqueia painel e edição direta', async () => {
  const { context, app } = await appStart({ load: async () => { throw new Error('Banco indisponível'); } });
  assert.match(app.innerHTML, /sem sincronização/);
  for (const hash of ['#/admin', '#/admin/editar/questao/q1']) {
    context.location.hash = hash; context.window.route();
    assert.match(app.innerHTML, /Conexão pendente/);
    assert.doesNotMatch(app.innerHTML, /Painel de Administração/);
  }
});
test('flag de login local não abre administração conectada ao Supabase', async () => {
  const { context, app } = await appStart({ load: async () => dados, isAdmin: async () => false });
  context.location.hash = '#/admin'; context.window.route();
  assert.match(app.innerHTML, /name="email"/);
  assert.doesNotMatch(app.innerHTML, /Painel de Administração/);
});
