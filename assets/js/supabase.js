/* Cliente REST sem dependências. A autorização de escrita é feita pelo RLS. */
(function () {
  'use strict';
  const config = window.SUPABASE_CONFIG || {};
  const url = String(config.url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = config.publicKey || '';
  const configured = Boolean(url || key);
  const sessionKey = 'simulador_supabase_session:' + url;
  let session = null, version = 0, refreshPromise = null;
  try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch (_) {}

  function keepSession(value) {
    session = value;
    try {
      if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
      else sessionStorage.removeItem(sessionKey);
    } catch (_) { /* A sessão continua em memória quando o armazenamento é bloqueado. */ }
  }
  function validate() {
    if (!/^https:\/\/[^/]+$/.test(url) || !key) throw new Error('Preencha a URL e a chave pública em assets/js/config.js.');
    let role = '';
    try { role = JSON.parse(atob(key.split('.')[1])).role; } catch (_) {}
    if (key.startsWith('sb_secret_') || role === 'service_role') throw new Error('Use somente a chave pública publishable/anon.');
    if (!key.startsWith('sb_publishable_') && role !== 'anon') throw new Error('Chave pública Supabase inválida.');
  }
  async function request(path, { method = 'GET', body, authenticated = false } = {}) {
    validate();
    if (authenticated) {
      if (!session) throw new Error('Entre novamente no painel.');
      if (session.expires_at * 1000 < Date.now() + 60000) await refresh();
    }
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    // Publishable keys vão apenas no apikey. Bearer recebe somente o JWT do usuário.
    if (authenticated) headers.Authorization = 'Bearer ' + session.access_token;
    let response;
    try {
      response = await fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (_) { throw new Error('Não foi possível conectar ao Supabase. Verifique a conexão e tente novamente.'); }
    const raw = await response.text();
    let data; try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
    if (!response.ok) {
      if (data?.code === 'P0001' && data.message === 'version_conflict') throw new Error('Outra sessão alterou os dados. Recarregue a página antes de editar novamente.');
      if (data?.code === 'PGRST205' || data?.code === 'PGRST202') throw new Error('Execute a migração supabase/migrations/001_simulador.sql no SQL Editor do Supabase.');
      if (response.status === 401 || response.status === 403) throw new Error('Acesso negado. Confira a chave pública, o login e a permissão de administrador.');
      if (data?.error_code === 'invalid_credentials') throw new Error('E-mail ou senha incorretos.');
      throw new Error('Supabase: ' + (data?.message || data?.msg || data?.error_description || 'falha na operação (' + response.status + ')'));
    }
    return data;
  }
  async function token(grant, body) {
    const value = await request('/auth/v1/token?grant_type=' + grant, { method: 'POST', body });
    keepSession({ ...value, expires_at: value.expires_at || Math.floor(Date.now() / 1000) + value.expires_in });
  }
  async function refresh() {
    if (!refreshPromise) refreshPromise = token('refresh_token', { refresh_token: session.refresh_token }).catch((error) => { keepSession(null); throw error; }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function isAdmin() {
    if (!session?.user?.id) return false;
    const rows = await request('/rest/v1/simulador_admins?select=user_id&user_id=eq.' + encodeURIComponent(session.user.id), { authenticated: true });
    return rows.length === 1;
  }
  function validData(data) {
    return data && ['questoes', 'apostilas', 'disciplinas', 'simulados'].every((name) => Array.isArray(data[name]));
  }
  window.SimuladorNuvem = {
    configured,
    validData,
    async load() {
      const rows = await request('/rest/v1/simulador_conteudo?id=eq.1&select=dados,versao');
      if (!rows.length) { version = 0; return null; }
      if (!validData(rows[0].dados)) throw new Error('Os dados no Supabase estão em formato inválido.');
      version = rows[0].versao;
      return rows[0].dados;
    },
    async save(data) {
      if (!validData(data)) throw new Error('Dados inválidos para publicação.');
      const result = await request('/rest/v1/rpc/salvar_simulador', { method: 'POST', authenticated: true, body: { novos_dados: data, versao_esperada: version } });
      version = result;
    },
    async signIn(email, password) {
      await token('password', { email, password });
      try {
        if (!await isAdmin()) throw new Error('Este usuário não tem permissão de administrador.');
      } catch (error) { try { await this.signOut(); } catch (_) {} throw error; }
    },
    isAdmin,
    async signOut() {
      try { if (session) await request('/auth/v1/logout?scope=local', { method: 'POST', authenticated: true }); }
      finally { keepSession(null); }
    }
  };
})();
