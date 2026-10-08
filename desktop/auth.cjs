// Official OSS Sign in with ChatGPT. Tokens remain in Electron's main process.
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

function validateCallback(url, pending) {
  const state = url.searchParams.get('state') || '';
  if (Buffer.byteLength(state) !== Buffer.byteLength(pending.state) || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) throw new Error('授权校验失败，请重新登录。');
  if (url.searchParams.has('error')) throw new Error('授权未完成。请在浏览器允许访问后重试。');
  const clientId = url.searchParams.get('client_id') || pending.clientId;
  if (!clientId || clientId === 'dynamic_agent_client') throw new Error('OpenAI 未返回有效的应用注册，请重试。');
  if (pending.clientId && pending.clientId !== clientId) throw new Error('授权应用与原账户不一致。');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('授权码缺失，请重新登录。');
  return { clientId, code };
}

async function consumeResponse(body, onDelta = () => {}) {
  let buffer = '', text = '', completed = false, usage = null;
  const decoder = new TextDecoder();
  for await (const part of body) {
    buffer += decoder.decode(part, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop();
    for (const block of blocks) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data);
      if (event.type === 'response.output_text.delta') { text += event.delta; onDelta(event.delta); }
      if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) throw new Error('AI 请求未完成，请检查额度或稍后重试。');
      if (event.type === 'response.completed') {
        if (event.response?.status !== 'completed') throw new Error('AI 返回未完成状态。');
        completed = true; usage = event.response?.usage ?? null;
      }
    }
  }
  if (!completed || !text.trim()) throw new Error('AI 响应中断，未产生完整结果。');
  return { text, usage };
}

function createAuth({ dir, name, secure, openExternal, fetchImpl = fetch }) {
  fs.mkdirSync(dir, { recursive: true });
  const hostFile = path.join(dir, 'host.json');
  const credentialFile = path.join(dir, 'account.enc');
  let host;
  if (fs.existsSync(hostFile)) host = JSON.parse(fs.readFileSync(hostFile, 'utf8')).id;
  else { host = 'urn:uuid:' + crypto.randomUUID(); fs.writeFileSync(hostFile, JSON.stringify({ id: host }), { mode: 0o600 }); }
  let account = null, activeLogin = null, refreshing = null;
  function encryptionReady() {
    return secure.isEncryptionAvailable() && (!secure.getSelectedStorageBackend || secure.getSelectedStorageBackend() !== 'basic_text');
  }
  if (fs.existsSync(credentialFile) && encryptionReady()) {
    try { account = JSON.parse(secure.decryptString(fs.readFileSync(credentialFile))); } catch { /* Require fresh login. */ }
  }
  function persist(next) {
    if (!encryptionReady()) throw new Error('系统凭据保护尚不可用，请启用系统钥匙串后重试。');
    const tmp = credentialFile + '.tmp';
    fs.writeFileSync(tmp, secure.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.renameSync(tmp, credentialFile); account = next;
  }
  function session() {
    return { connected: Boolean(account?.access_token), sharing: Boolean(account?.access_token && account?.scopes?.includes('chatgpt.tokens.use.direct')),
      email: account?.email || '', expiresAt: account?.expiresAt || null };
  }
  async function tokenRequest(params) {
    const response = await fetchImpl(AUTH + '/api/accounts/oauth/token', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`OpenAI 授权失败 (${response.status})，请重新登录。`);
    return response.json();
  }
  async function signIn() {
    if (activeLogin) throw new Error('登录窗口已打开，请在浏览器中完成授权。');
    if (!encryptionReady()) throw new Error('系统凭据保护尚不可用。');
    const pending = { state: crypto.randomBytes(32).toString('base64url'), nonce: crypto.randomBytes(32).toString('base64url'),
      verifier: crypto.randomBytes(48).toString('base64url'), clientId: account?.client_id || null };
    const previous = account;
    let server, timer, cancel, settled = false;
    const result = new Promise((resolve, reject) => {
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); server.close(); activeLogin = null; error ? reject(error) : resolve(value); };
      cancel = () => finish(new Error('登录已取消。'));
      server = http.createServer(async (req, res) => {
        const url = new URL(req.url, pending.redirectUri);
        if (url.pathname !== '/auth/callback') { res.writeHead(404); res.end(); return; }
        let returned;
        try { returned = validateCallback(url, pending); }
        catch (error) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end(error.message); if (url.searchParams.get('state') === pending.state && url.searchParams.has('error')) finish(error); return; }
        if (pending.consumed) { res.writeHead(409); res.end(); return; }
        pending.consumed = true;
        try {
          // Preserve issued registration even if the one-time code expires.
          persist({ ...(previous || {}), client_id: returned.clientId });
          const data = await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: returned.clientId,
            code: returned.code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }));
          const { jwtVerify, createRemoteJWKSet } = await import('jose');
          const { payload } = await jwtVerify(data.id_token, createRemoteJWKSet(new URL(AUTH + '/.well-known/jwks.json')),
            { issuer: AUTH, audience: returned.clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
          if (payload.nonce !== pending.nonce || (previous?.subject && payload.sub !== previous.subject)) throw new Error('登录身份校验失败。');
          if (!data.access_token || data.token_type?.toLowerCase() !== 'bearer') throw new Error('缺少有效授权凭据。');
          persist({ client_id: returned.clientId, subject: payload.sub, email: payload.email || '', id_token: data.id_token,
            access_token: data.access_token, refresh_token: data.refresh_token, scopes: (data.scope || '').split(' '),
            expiresAt: Date.now() + Number(data.expires_in || 0) * 1000 });
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end('<h1>登录已完成</h1><p>请返回桌面应用。现在可以关闭本页。</p>');
          finish(null, session());
        } catch (error) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('登录未完成，请返回应用重试。'); finish(error); }
      });
      server.once('error', error => finish(error));
      server.listen(0, '127.0.0.1', async () => {
        pending.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
        const url = new URL(AUTH + '/api/accounts/authorize');
        const params = { client_id: pending.clientId || 'dynamic_agent_client', ext_agent_host_id: host,
          response_type: 'code', redirect_uri: pending.redirectUri, scope: SCOPES, resource: RESOURCE,
          state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256',
          code_challenge: crypto.createHash('sha256').update(pending.verifier).digest('base64url') };
        if (!pending.clientId) params.agent_name_hint = name;
        if (previous?.id_token) params.id_token_hint = previous.id_token;
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        try { await openExternal(url.href); } catch (error) { finish(error); }
      });
      timer = setTimeout(() => finish(new Error('登录超时，请重试。')), 180000);
    });
    activeLogin = cancel;
    return result;
  }
  async function accessToken() {
    if (!session().sharing) throw new Error('请先登录并允许使用 ChatGPT 套餐。');
    if (account.expiresAt <= Date.now() + 60000) {
      if (!account.refresh_token) throw new Error('登录已过期，请重新登录。');
      if (!refreshing) refreshing = (async () => {
        const data = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: account.client_id,
          refresh_token: account.refresh_token, resource: RESOURCE }));
        if (!data.access_token) throw new Error('登录已过期，请重新登录。');
        persist({ ...account, access_token: data.access_token, refresh_token: data.refresh_token || account.refresh_token,
          scopes: data.scope ? data.scope.split(' ') : account.scopes, expiresAt: Date.now() + Number(data.expires_in || 0) * 1000 });
      })().finally(() => { refreshing = null; });
      await refreshing;
    }
    if (!session().sharing) throw new Error('套餐授权已失效，请重新登录。');
    return account.access_token;
  }
  async function request(route, init = {}) {
    const token = await accessToken();
    const response = await fetchImpl(RESOURCE + route, { ...init, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(response.status === 429 ? '已达到使用额度，请打开「管理额度」。' : `OpenAI 请求失败 (${response.status})，请检查账户授权后重试。`);
    return response;
  }
  return { session, signIn, accessToken,
    cancelLogin() { activeLogin?.(); activeLogin = null; },
    logout() { if (activeLogin) throw new Error('请先完成或取消登录。'); if (account) persist({ client_id: account.client_id, subject: account.subject, email: account.email }); return session(); },
    async models() { const data = await (await request('/models')).json(); return (data.models || []).filter(m => m.visibility === 'list').map(m => ({ slug: m.slug, name: m.display_name })); },
    async generate({ model, input, instructions }, onDelta) {
      if (!model || typeof input !== 'string' || input.length > 50000) throw new Error('请选择模型并填写有效任务。');
      return consumeResponse((await request('/responses', { method: 'POST', body: JSON.stringify({ model, input, instructions, store: false, stream: true }) })).body, onDelta);
    },
  };
}
module.exports = { createAuth, validateCallback, consumeResponse };
