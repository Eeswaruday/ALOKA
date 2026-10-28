const { createHmac, timingSafeEqual, randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const COOKIE = 'aloka_admin';
const DRAFT_FILE = 'data/admin-drafts.json';
const attempts = new Map(); // shortcut: per-instance throttling, upgrade to shared storage if login traffic becomes material.

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function secret(name) { return (process.env[name] || '').trim(); }
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(JSON.stringify(body));
}
function cookieValue(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const i = part.indexOf('='); return i < 0 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }));
  return cookies[COOKIE] || '';
}
function sign(value) { return createHmac('sha256', secret('GITHUB_TOKEN')).update(value).digest('base64url'); }
function encodeSession(session) {
  const value = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${value}.${sign(value)}`;
}
function readSession(req) {
  const [value, signature, extra] = cookieValue(req).split('.');
  if (!value || !signature || extra) return null;
  const expected = Buffer.from(sign(value)); const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!session.csrf || Date.now() - session.created > 12 * 60 * 60 * 1000 || Date.now() - session.seen > 30 * 60 * 1000) return null;
    session.seen = Date.now();
    return session;
  } catch { return null; }
}
function setSession(res, session) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeSession(session)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
}
function clearSession(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 2_100_000) reject(Object.assign(new Error('Request body is too large.'), { status: 413 })); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || new URL(origin).host !== req.headers.host) fail(403, 'Request origin could not be verified.');
}
function requireSession(req, csrf = false, authenticated = true) {
  const session = readSession(req);
  if (!session || (authenticated && !session.email)) fail(401, 'Sign in again to continue.');
  if (csrf && (!req.headers['x-csrf-token'] || req.headers['x-csrf-token'] !== session.csrf)) fail(403, 'Session check failed. Refresh and try again.');
  return session;
}
function githubConfig() {
  const token = secret('GITHUB_TOKEN'), owner = secret('GITHUB_REPOSITORY_OWNER'), repo = secret('GITHUB_REPOSITORY_NAME');
  const production = secret('GITHUB_PRODUCTION_BRANCH') || 'main', drafts = secret('GITHUB_DRAFT_BRANCH') || 'aloka-drafts';
  if (!token || !owner || !repo) fail(503, 'GitHub is not connected. Set the server environment variables in Vercel.');
  return { token, owner, repo, production, drafts };
}
async function gh(method, path, body) {
  const { token, owner, repo } = githubConfig();
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
    method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ALOKA-Admin', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) fail(404, 'The requested GitHub file or branch was not found.');
    if (response.status === 409 || response.status === 422) fail(409, 'GitHub could not apply this change; refresh and retry.');
    fail(response.status === 401 || response.status === 403 ? 503 : 502, 'GitHub rejected the request. Check repository permissions and settings.');
  }
  return data;
}
const refQuery = branch => `?ref=${encodeURIComponent(branch)}`;
async function readGitFile(path, branch) {
  try {
    const file = await gh('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}${refQuery(branch)}`);
    const items = JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'));
    if (!Array.isArray(items)) fail(502, 'Published content is not a valid JSON list.');
    return { items, sha: file.sha };
  } catch (error) { if (error.status === 404) return { items: [], sha: null }; throw error; }
}
async function writeGitFile(path, items, branch, message, sha) {
  return gh('PUT', `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    message, branch, content: Buffer.from(`${JSON.stringify(items, null, 2)}\n`).toString('base64'), ...(sha ? { sha } : {}),
  });
}
async function ensureDraftBranch() {
  const { drafts, production } = githubConfig();
  try { await gh('GET', `/git/ref/heads/${drafts.split('/').map(encodeURIComponent).join('/')}`); }
  catch (error) {
    if (error.status !== 404) throw error;
    const mainRef = await gh('GET', `/git/ref/heads/${production.split('/').map(encodeURIComponent).join('/')}`);
    await gh('POST', '/git/refs', { ref: `refs/heads/${drafts}`, sha: mainRef.object.sha });
  }
  return drafts;
}
function labels(items) { return [...new Set(items.filter(item => typeof item === 'string').map(item => item.trim()).filter(item => item && item.length <= 100))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })); }
function validExperiment(input) {
  const title = String(input.title || '').trim(), id = String(input.id || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || title.length < 2 || title.length > 180) fail(400, 'Enter a valid experiment title and identifier.');
  const language = String(input.language || '').trim(), sourceCode = String(input.sourceCode || '');
  if (!language || language.length > 60 || !sourceCode.trim() || sourceCode.length > 1_000_000) fail(400, 'Programming language and source code are required.');
  return { ...input, id, slug: id, title, language, sourceCode, subject: String(input.subject || '').trim(), experimentNumber: String(input.experimentNumber || '').trim() };
}
async function catalog(name, branch) { return readGitFile(`data/${name}.json`, branch); }
async function content() {
  const { production, drafts: draftBranch } = githubConfig();
  const [experiments, draftFile, subjects, categories] = await Promise.all([
    catalog('experiments', production), readGitFile(DRAFT_FILE, await ensureDraftBranch()), catalog('subjects', production), catalog('categories', production),
  ]);
  const published = experiments.items.filter(item => item && item.status === 'published');
  const drafts = draftFile.items;
  const subjectLabels = labels([...subjects.items, ...published.concat(drafts).map(item => item.subject || '')]);
  const categoryLabels = labels([...categories.items, ...published.concat(drafts).map(item => item.category || '')]);
  return { published: published.sort((a, b) => String(a.title).localeCompare(String(b.title))), drafts: drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), subjects: subjectLabels, categories: categoryLabels, stats: { published: published.length, drafts: drafts.length, subjects: subjectLabels.length, categories: categoryLabels.length } };
}
function uniqueId() { return randomBytes(24).toString('base64url'); }

async function handler(req, res) {
  const action = new URL(req.url, `https://${req.headers.host}`).searchParams.get('action') || '';
  try {
    if (req.method === 'GET' && action === 'csrf') {
      const session = readSession(req) || { csrf: uniqueId(), created: Date.now(), seen: Date.now() };
      session.csrf ||= uniqueId(); session.seen = Date.now(); setSession(res, session);
      return json(res, 200, { csrf: session.csrf });
    }
    if (req.method === 'GET' && action === 'public-experiments') {
      const read = async name => JSON.parse(await readFile(join(process.cwd(), 'data', `${name}.json`), 'utf8').catch(() => '[]'));
      const [all, subjects, categories] = await Promise.all([read('experiments'), read('subjects'), read('categories')]);
      const published = all.filter(item => item && item.status === 'published');
      return json(res, 200, { experiments: published, subjects: labels([...subjects, ...published.map(item => item.subject || '')]), categories: labels([...categories, ...published.map(item => item.category || '')]) });
    }
    if (req.method !== 'GET' && req.method !== 'POST') fail(405, 'Method not allowed.');
    if (req.method === 'POST') {
      checkOrigin(req);
      const input = await readBody(req);
      if (action === 'login') {
        requireSession(req, true, false);
        if (secret('ADMIN_ENABLED') !== '1') fail(503, 'Admin access is disabled on this server.');
        const email = secret('ADMIN_EMAIL').toLowerCase(), password = secret('ADMIN_PASSWORD');
        if (!email || !password) fail(503, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in Vercel environment variables.');
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown', recent = (attempts.get(ip) || []).filter(time => time > Date.now() - 900000);
        if (recent.length >= 5) fail(429, 'Too many attempts. Wait 15 minutes before trying again.');
        const submittedEmail = String(input.email || '').trim().toLowerCase(), submittedPassword = String(input.password || '');
        const a = Buffer.from(submittedEmail), b = Buffer.from(email), p = Buffer.from(submittedPassword), q = Buffer.from(password);
        if (p.length > 1024 || a.length !== b.length || p.length !== q.length || !timingSafeEqual(a, b) || !timingSafeEqual(p, q)) {
          attempts.set(ip, [...recent, Date.now()]); fail(401, 'Email or password is incorrect.');
        }
        attempts.delete(ip);
        const session = { email, csrf: uniqueId(), created: Date.now(), seen: Date.now() };
        setSession(res, session);
        return json(res, 200, { ok: true, must_change: false, csrf: session.csrf });
      }
      const session = requireSession(req, true, action !== 'login');
      setSession(res, session);
      if (action === 'logout') { clearSession(res); return json(res, 200, { ok: true }); }
      if (action === 'save-experiment') {
        const branch = await ensureDraftBranch();
        const file = await readGitFile(DRAFT_FILE, branch); const record = validExperiment(input.experiment || {});
        const existing = file.items.find(item => item.id === record.id);
        if (existing && existing.updatedAt !== (input.draftUpdatedAt || '')) fail(409, 'This draft changed elsewhere. Reload it before saving.');
        const now = new Date().toISOString();
        Object.assign(record, { status: 'draft', createdAt: existing?.createdAt || now, updatedAt: now, baseUpdatedAt: input.baseUpdatedAt || existing?.baseUpdatedAt || '' });
        const next = existing ? file.items.map(item => item.id === record.id ? record : item) : [...file.items, record];
        await writeGitFile(DRAFT_FILE, next, branch, `Save experiment draft: ${record.title}`, file.sha);
        return json(res, 200, { ok: true, experiment: record });
      }
      if (action === 'publish-experiment') {
        const state = await content(); const draft = state.drafts.find(item => item.id === input.id);
        if (!draft || draft.updatedAt !== input.draftUpdatedAt) fail(409, 'This draft changed or no longer exists. Refresh and retry.');
        const { production } = githubConfig(); const live = await catalog('experiments', production);
        const at = live.items.findIndex(item => item.id === draft.id && item.status === 'published');
        if (draft.baseUpdatedAt && (at < 0 || live.items[at].updatedAt !== draft.baseUpdatedAt)) fail(409, 'The published experiment changed. Reload before publishing.');
        if (!draft.baseUpdatedAt && at >= 0) fail(409, 'An experiment with this identifier is already published.');
        const record = { ...draft, status: 'published', updatedAt: new Date().toISOString(), publishedAt: at >= 0 ? live.items[at].publishedAt : new Date().toISOString() };
        delete record.baseUpdatedAt;
        const next = at >= 0 ? live.items.map(item => item.id === record.id ? record : item) : [...live.items, record];
        const saved = await writeGitFile('data/experiments.json', next, production, `Publish experiment: ${record.title}`, live.sha);
        try {
          const branch = await ensureDraftBranch(), file = await readGitFile(DRAFT_FILE, branch);
          await writeGitFile(DRAFT_FILE, file.items.filter(item => item.id !== record.id), branch, `Clear published draft: ${record.title}`, file.sha);
        } catch { return json(res, 200, { ok: true, commit: saved.commit?.sha || '', draft_cleared: false }); }
        return json(res, 200, { ok: true, commit: saved.commit?.sha || '', draft_cleared: true });
      }
      if (action === 'delete-experiment') {
        const { production } = githubConfig();
        if (input.source === 'published') {
          const live = await catalog('experiments', production), record = live.items.find(item => item.id === input.id && item.status === 'published');
          if (!record || record.title !== input.confirmTitle) fail(400, 'Confirm the experiment title before deleting it.');
          const saved = await writeGitFile('data/experiments.json', live.items.filter(item => item.id !== input.id), production, `Delete experiment: ${record.title}`, live.sha);
          return json(res, 200, { ok: true, commit: saved.commit?.sha || '' });
        }
        const branch = await ensureDraftBranch(), file = await readGitFile(DRAFT_FILE, branch), record = file.items.find(item => item.id === input.id);
        if (!record || record.title !== input.confirmTitle) fail(400, 'Confirm the experiment title before deleting it.');
        await writeGitFile(DRAFT_FILE, file.items.filter(item => item.id !== input.id), branch, `Delete experiment draft: ${record.title}`, file.sha);
        return json(res, 200, { ok: true, commit: '' });
      }
      if (action === 'migrate-samples') return json(res, 200, { ok: true, removed: 0 });
      if (action === 'change-password') fail(409, 'Change ADMIN_PASSWORD in Vercel project settings, then redeploy.');
      fail(404, 'Unknown admin action.');
    }
    if (action === 'status') {
      const session = readSession(req);
      if (!session?.email) return json(res, 200, { authenticated: false });
      setSession(res, session);
      return json(res, 200, { authenticated: true, email: session.email, must_change: false, github_connected: Boolean(secret('GITHUB_TOKEN') && secret('GITHUB_REPOSITORY_OWNER') && secret('GITHUB_REPOSITORY_NAME')), csrf: session.csrf });
    }
    if (action === 'content') { const session = requireSession(req); setSession(res, session); return json(res, 200, await content()); }
    if (action === 'history') {
      const session = requireSession(req); setSession(res, session); const { production } = githubConfig();
      const commits = await gh('GET', `/commits?sha=${encodeURIComponent(production)}&path=data/experiments.json&per_page=30`);
      return json(res, 200, { commits: commits.map(item => ({ sha: item.sha, message: item.commit?.message || '', date: item.commit?.author?.date || '', author: item.commit?.author?.name || '' })) });
    }
    if (action === 'csrf') return json(res, 200, { csrf: '' });
    fail(404, 'Unknown admin action.');
  } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'The admin request could not be completed. Check Vercel and GitHub configuration.' }); }
}

module.exports = handler;
