(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const apiUrlSetting = (window.ALOKA_ADMIN_API_URL || '').trim();
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname) && ['8000', ''].includes(location.port);
  const apiUrl = apiUrlSetting || (isLocal ? new URL('/api/admin.php', location.origin).href : '');
  const state = { csrf: '', content: { published: [], drafts: [], subjects: [], categories: [], stats: {} }, sessionExpired: false, editingRecord: false, saving: false, publishing: false };

  function notice(message, error = false) {
    const node = $('#admin-notice') || $('#login-notice');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', error);
    node.hidden = !message;
  }
  async function request(action, { method = 'GET', body } = {}) {
    if (!apiUrl) throw Error('Admin API is not configured. Set its HTTPS URL in js/api-config.js.');
    const url = new URL(apiUrl, location.origin);
    url.searchParams.set('action', action);
    const headers = {};
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = state.csrf;
    }
    const response = await fetch(url, { method, credentials: 'include', headers, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
    if (response.status === 401 && $('#admin-nav') && result.error === 'Sign in again to continue.') {
      location.href = state.sessionExpired ? '/admin/login/?expired=1' : '/admin/login/';
      throw Error('Your admin session expired. Sign in again.');
    }
    if (!response.ok) throw Error(result.error || `Request failed (${response.status}).`);
    return result;
  }
  async function bootstrap() {
    const result = await request('csrf');
    state.csrf = result.csrf || '';
    state.sessionExpired = Boolean(result.expired);
  }
  function setBusy(button, busy) {
    if (button) button.disabled = busy;
    if (button) button.classList.toggle('is-loading', busy);
  }
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function actionButton(label, action, id, source) {
    const button = node('button', 'admin-secondary', label);
    button.type = 'button';
    button.dataset.action = action;
    if (id) button.dataset.id = id;
    if (source) button.dataset.source = source;
    if (action === 'publish') button.disabled = state.publishing;
    return button;
  }
  function activatePanel(name) {
    document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.toggle('is-active', panel.id === `panel-${name}`));
    document.querySelectorAll('.admin-nav-item').forEach(button => button.classList.toggle('is-active', button.dataset.panel === name));
    const titles = { overview: 'Dashboard overview', experiments: 'Manage experiments', add: 'Add new experiment', drafts: 'Experiment drafts', published: 'Published experiments', history: 'Content history', settings: 'Account settings' };
    $('#panel-title').textContent = titles[name] || 'Admin workspace';
    if (name === 'history') loadHistory().catch(error => notice(error.message, true));
  }
  function slugify(value) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100); }
  function byId(items, id) { return items.find(item => item.id === id); }
  function newExperimentSlug() {
    const subject = $('#experiment-subject').value === '__other__' ? $('#experiment-subject-other').value : $('#experiment-subject').value;
    const base = slugify([subject, $('#experiment-number').value, $('#experiment-title').value].filter(Boolean).join(' ')) || `experiment-${crypto.randomUUID()}`;
    const used = new Set([...state.content.published, ...state.content.drafts].map(item => item.id));
    let candidate = base, suffix = 2;
    while (used.has(candidate)) candidate = `${base.slice(0, 94)}-${suffix++}`;
    return candidate;
  }
  function refreshNewSlug() { if (!state.editingRecord) $('#experiment-slug').value = newExperimentSlug(); }

  function renderContent() {
    const { published, drafts } = state.content;
    $('#stat-published').textContent = String(published.length);
    $('#stat-drafts').textContent = String(drafts.length);
    renderExperimentList($('#experiment-manager-list'), published, 'published', true);
    renderExperimentList($('#draft-manager-list'), drafts, 'draft', true);
    renderExperimentList($('#published-manager-list'), published, 'published', true);
    renderRecent();
  }
  function emptyRow(list, message) {
    const item = node('li', 'list-empty', message);
    list.append(item);
  }
  function renderExperimentList(list, records, source, actions) {
    if (!list) return;
    list.replaceChildren();
    let rows = records;
    if (list.id === 'experiment-manager-list') {
      const query = ($('#manage-search').value || '').trim().toLowerCase();
      rows = records.filter(item => `${item.title} ${item.language}`.toLowerCase().includes(query));
    }
    if (!rows.length) {
      emptyRow(list, list.id === 'draft-manager-list' ? 'No drafts yet. Create an experiment and save it as a draft.' : list.id === 'published-manager-list' ? 'No experiments published yet.' : 'No experiments match this search.');
      return;
    }
    rows.forEach(record => {
      const row = node('li', 'content-row');
      const copy = node('div', 'content-row-copy');
      copy.append(node('strong', '', record.title), node('small', '', record.language || ''));
      if (record.updatedAt) copy.append(node('small', 'content-date', `${source === 'draft' ? 'Draft updated' : 'Updated'} ${new Date(record.updatedAt).toLocaleDateString()}`));
      const actionsWrap = node('div', 'content-row-actions');
      if (actions) {
        if (source === 'draft') {
          actionsWrap.append(actionButton('Edit draft', 'edit', record.id, 'draft'), actionButton('Preview', 'preview', record.id, 'draft'), actionButton('Publish', 'publish', record.id, 'draft'), actionButton('Delete', 'delete', record.id, 'draft'));
        } else {
          actionsWrap.append(actionButton('Edit', 'edit', record.id, 'published'), actionButton('Delete', 'delete', record.id, 'published'));
          if (byId(state.content.drafts, record.id)) actionsWrap.append(node('span', 'state-badge', 'Draft pending'));
        }
      }
      row.append(copy, actionsWrap);
      list.append(row);
    });
  }
  function renderRecent() {
    const list = $('#recent-list');
    list.replaceChildren();
    const rows = [...state.content.published, ...state.content.drafts].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 5);
    if (!rows.length) return emptyRow(list, 'No experiments yet. Published and draft activity will appear here.');
    rows.forEach(record => {
      const row = node('li', 'content-row');
      const copy = node('div', 'content-row-copy');
      copy.append(node('strong', '', record.title), node('small', '', `${record.status === 'draft' ? 'Draft' : 'Published'} · ${record.language || ''}`));
      row.append(copy, actionButton(record.status === 'draft' ? 'Edit draft' : 'Edit', 'edit', record.id, record.status));
      list.append(row);
    });
  }
  async function loadContent() {
    const result = await request('content');
    state.content = result;
    const subjects = $('#experiment-subject');
    (result.subjects || []).forEach(subject => { if (![...subjects.options].some(option => option.value === subject)) subjects.add(new Option(subject, subject), subjects.options.length - 1); });
    renderContent();
  }
  function collectExperiment() {
    const title = $('#experiment-title').value.trim();
    const subject = $('#experiment-subject').value === '__other__' ? $('#experiment-subject-other').value.trim() : $('#experiment-subject').value;
    const slug = state.editingRecord ? $('#experiment-slug').value : newExperimentSlug();
    $('#experiment-slug').value = slug;
    $('#experiment-id').value = state.editingRecord ? $('#experiment-id').value : slug;
    return { id: $('#experiment-id').value, slug, title, subject, experimentNumber: $('#experiment-number').value.trim(), language: $('#experiment-language').value, sourceCode: $('#experiment-code').value };
  }
  function fillExperiment(record) {
    const form = $('#experiment-form');
    form.reset();
    $('#experiment-id').value = record.id || '';
    state.editingRecord = Boolean(record.id);
    $('#base-updated-at').value = record.status === 'draft' ? record.baseUpdatedAt || '' : record.updatedAt || '';
    $('#draft-updated-at').value = record.status === 'draft' ? record.updatedAt || '' : '';
    $('#experiment-slug').value = record.slug || record.id || '';
    $('#experiment-title').value = record.title || '';
    const subjectSelect = $('#experiment-subject');
    const subject = record.subject || '';
    if (subject && ![...subjectSelect.options].some(option => option.value === subject)) subjectSelect.add(new Option(subject, subject));
    subjectSelect.value = subject || '';
    if (subjectSelect.value !== subject && subject) { subjectSelect.value = '__other__'; $('#experiment-subject-other').value = subject; }
    else $('#experiment-subject-other').value = '';
    $('#experiment-subject-other').hidden = subjectSelect.value !== '__other__';
    $('#experiment-subject-other').required = subjectSelect.value === '__other__';
    $('#experiment-number').value = record.experimentNumber || '';
    $('#experiment-language').value = record.language || '';
    $('#experiment-code').value = record.sourceCode || '';
    $('#form-kicker').textContent = record.id ? 'EXPERIMENT CONTENT' : 'NEW CONTENT';
    $('#form-title').textContent = record.id ? `Edit ${record.title}` : 'Add new experiment';
    activatePanel('add');
    $('#experiment-title').focus();
  }
  function confirmAction(title, message, confirmLabel) {
    const dialog = $('#confirmation-dialog');
    $('#confirmation-title').textContent = title;
    $('#confirmation-message').textContent = message;
    $('#confirmation-submit').textContent = confirmLabel;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  }
  function newExperiment() { fillExperiment({}); }
  async function saveDraft(showMessage = true) {
    if (state.saving || state.publishing) return null;
    const form = $('#experiment-form');
    if (!form.reportValidity()) return null;
    const button = $('#save-experiment');
    state.saving = true; setBusy(button, true); setBusy($('#publish-experiment'), true);
    try {
      const result = await request('save-experiment', { method: 'POST', body: { experiment: collectExperiment(), baseUpdatedAt: $('#base-updated-at').value, draftUpdatedAt: $('#draft-updated-at').value } });
      const draft = result.experiment;
      $('#experiment-id').value = draft.id;
      state.editingRecord = true;
      $('#experiment-slug').value = draft.slug;
      $('#experiment-slug').readOnly = true;
      $('#base-updated-at').value = draft.baseUpdatedAt || '';
      $('#draft-updated-at').value = draft.updatedAt || '';
      await loadContent();
      if (showMessage) notice('Draft saved to the GitHub drafts branch.');
      return draft;
    } catch (error) { notice(error.message, true); return null; }
    finally { state.saving = false; setBusy(button, false); setBusy($('#publish-experiment'), false); }
  }
  async function publishDraft(id, draftUpdatedAt) {
    if (state.publishing || state.saving) return;
    const draft = byId(state.content.drafts, id);
    if (!draft) return notice('Draft not found. Refresh the list and try again.', true);
    state.publishing = true; setBusy($('#publish-experiment'), true); setBusy($('#save-experiment'), true);
    try {
      if (!await confirmAction('Publish experiment?', `Publish “${draft.title}” to the student catalogue? This creates a GitHub commit.`, 'Publish')) return;
      const result = await request('publish-experiment', { method: 'POST', body: { id, experiment: draft, baseUpdatedAt: draft.baseUpdatedAt || '', draftUpdatedAt: draftUpdatedAt || draft.updatedAt } });
      await loadContent();
      notice(result.draft_cleared ? `Published “${draft.title}” to the student catalogue.` : `Published “${draft.title}”, but its GitHub draft record could not be cleared.`, !result.draft_cleared);
    } catch (error) { notice(error.message, true); }
    finally { state.publishing = false; setBusy($('#publish-experiment'), false); setBusy($('#save-experiment'), false); }
  }
  async function publishFromForm() {
    if (state.publishing || state.saving) return;
    if (!$('#experiment-form').reportValidity()) return;
    const record = collectExperiment();
    const existingDraft = byId(state.content.drafts, record.id);
    const published = byId(state.content.published, record.id);
    const sameAsPublished = published && record.title === published.title && record.language === published.language && record.sourceCode === published.sourceCode;
    if (!existingDraft && published && sameAsPublished && record.subject === published.subject && record.experimentNumber === (published.experimentNumber || '')) return notice(`“${published.title}” is already published.`);
    if (existingDraft && existingDraft.updatedAt !== $('#draft-updated-at').value) return notice('This draft changed after you opened it. Reopen the latest draft before publishing.', true);
    if (existingDraft && (existingDraft.baseUpdatedAt || '') !== (published?.updatedAt || '')) return notice('The published experiment changed. Reopen the latest version before publishing.', true);
    if (!existingDraft && published && $('#base-updated-at').value !== published.updatedAt) return notice('The published experiment changed. Reopen the latest version before publishing.', true);
    if (!existingDraft && !published && $('#base-updated-at').value) return notice('The published experiment was removed. Refresh the experiment list before continuing.', true);
    const title = record.title;
    state.publishing = true; setBusy($('#publish-experiment'), true); setBusy($('#save-experiment'), true);
    try {
      if (!await confirmAction('Publish experiment?', `Publish “${title}” to the student catalogue now? This commits directly to GitHub.`, 'Publish')) return;
      const result = await request('publish-experiment', { method: 'POST', body: { experiment: record, baseUpdatedAt: $('#base-updated-at').value, draftUpdatedAt: $('#draft-updated-at').value } });
      await loadContent();
      fillExperiment({}); activatePanel('experiments');
      notice(`Published “${title}” to the student catalogue.`);
    } catch (error) { notice(error.message, true); }
    finally { state.publishing = false; setBusy($('#publish-experiment'), false); setBusy($('#save-experiment'), false); }
  }
  function previewFromForm() {
    if (!$('#experiment-form').reportValidity()) return;
    const record = collectExperiment();
    $('#preview-title').textContent = record.title;
    const content = $('#preview-content');
    content.replaceChildren(node('p', 'preview-meta', record.language));
    const section = node('section', 'preview-section');
    section.append(node('h3', '', 'Source code'));
    const pre = node('pre', 'preview-code'); pre.append(node('code', '', record.sourceCode));
    section.append(pre); content.append(section);
    $('#experiment-preview-dialog').showModal();
  }
  async function deleteExperiment(id, source) {
    const record = source === 'draft' ? byId(state.content.drafts, id) : byId(state.content.published, id);
    if (!record || !await confirmAction('Delete experiment?', `Delete “${record.title}”? ${source === 'published' ? 'This removes it from the student catalogue and creates a recoverable GitHub history commit.' : 'This removes its GitHub draft record.'}`, 'Delete')) return;
    try {
      await request('delete-experiment', { method: 'POST', body: { id, source, confirmTitle: record.title } });
      await loadContent();
      notice(source === 'published' ? 'Experiment removed from the published catalogue.' : 'Draft deleted.');
    } catch (error) { notice(error.message, true); }
  }
  async function loadHistory() {
    const result = await request('history');
    const list = $('#commit-list');
    list.replaceChildren();
    if (!result.commits.length) return emptyRow(list, 'No published experiment commits yet.');
    result.commits.forEach(commit => {
      const row = node('li', 'history-row');
      row.append(node('strong', '', String(commit.message || '').split('\n')[0]), node('small', '', `${new Date(commit.date).toLocaleString()} · ${commit.author || 'GitHub'}`), node('code', '', String(commit.sha || '').slice(0, 7)));
      list.append(row);
    });
  }
  async function changePassword(event, currentId, nextId, confirmId, first = false) {
    event.preventDefault();
    const current = $(`#${currentId}`).value;
    const next = $(`#${nextId}`).value;
    if (next !== $(`#${confirmId}`).value) { notice('The new passwords do not match.', true); $(`#${confirmId}`).focus(); return; }
    const button = event.submitter;
    setBusy(button, true);
    try {
      await request('change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      $('#password-form')?.reset(); $('#first-password-form')?.reset();
      if (first) {
        document.querySelector('.admin-layout').classList.remove('is-force-change');
        activatePanel('overview');
        await loadContent();
      }
      notice('Password updated.');
    } catch (error) { notice(error.message, true); }
    finally { setBusy(button, false); }
  }
  async function logout() {
    try { await request('logout', { method: 'POST', body: {} }); }
    finally { location.href = '/admin/login/'; }
  }
  function wireDashboard() {
    document.querySelectorAll('.admin-nav-item').forEach(button => button.addEventListener('click', () => activatePanel(button.dataset.panel)));
    document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => button.dataset.go === 'add' ? newExperiment() : activatePanel(button.dataset.go)));
    $('#logout-button').addEventListener('click', logout);
    $('#settings-logout').addEventListener('click', logout);
    $('#password-form').addEventListener('submit', event => changePassword(event, 'current-password', 'new-password', 'confirm-password'));
    $('#first-password-form').addEventListener('submit', event => changePassword(event, 'first-current-password', 'first-new-password', 'first-confirm-password', true));
    ['experiment-title', 'experiment-number', 'experiment-subject-other'].forEach(id => $(`#${id}`).addEventListener('input', refreshNewSlug));
    $('#experiment-subject').addEventListener('change', () => { const other = $('#experiment-subject-other'); other.hidden = $('#experiment-subject').value !== '__other__'; other.required = !other.hidden; if (!other.hidden) other.focus(); else other.value = ''; refreshNewSlug(); });
    $('#save-experiment').addEventListener('click', () => saveDraft());
    $('#publish-experiment').addEventListener('click', publishFromForm);
    $('#preview-experiment').addEventListener('click', previewFromForm);
    $('#cancel-experiment').addEventListener('click', () => activatePanel('experiments'));
    $('#close-preview').addEventListener('click', () => $('#experiment-preview-dialog').close());
    $('#experiment-manager-list').addEventListener('input', event => { if (event.target.id === 'manage-search') renderExperimentList($('#experiment-manager-list'), state.content.published, 'published', true); });
    ['experiment-manager-list', 'draft-manager-list', 'published-manager-list', 'recent-list'].forEach(id => $(`#${id}`).addEventListener('click', event => {
      const button = event.target.closest('[data-action]'); if (!button) return;
      const { action, id: recordId, source } = button.dataset;
      if (action === 'edit') {
        const record = source === 'draft' ? byId(state.content.drafts, recordId) : byId(state.content.drafts, recordId) || byId(state.content.published, recordId);
        if (record) fillExperiment(record);
      }
      if (action === 'preview') { const record = byId(state.content.drafts, recordId); if (record) { fillExperiment(record); previewFromForm(); } }
      if (action === 'publish') publishDraft(recordId);
      if (action === 'delete') deleteExperiment(recordId, source);
    }));
    $('#refresh-history').addEventListener('click', () => loadHistory().catch(error => notice(error.message, true)));
  }
  async function startDashboard() {
    try {
      await bootstrap();
      const status = await request('status');
      if (!status.authenticated) { location.href = '/admin/login/'; return; }
      $('#admin-email-label').textContent = status.email;
      $('#settings-email').textContent = status.email;
      wireDashboard();
      if (status.must_change) {
        document.querySelector('.admin-layout').classList.add('is-force-change');
        activatePanel('force-change');
        return;
      }
      try {
        const cleanup = await request('migrate-samples', { method: 'POST', body: {} });
        if (cleanup.removed) notice(`Removed ${cleanup.removed} legacy demo records from the active content source.`);
      } catch (error) { notice(`Legacy sample cleanup could not finish: ${error.message}`, true); }
      await loadContent();
      if (location.search.includes('expired=1')) notice('Your admin session expired. Sign in again.', true);
    } catch (error) { notice(error.message, true); }
  }

  $('#toggle-password')?.addEventListener('click', () => {
    const input = $('#admin-password'), button = $('#toggle-password'), visible = input.type === 'password';
    input.type = visible ? 'text' : 'password'; button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password'); button.setAttribute('aria-pressed', String(visible));
  });
  $('#login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#login-submit'); notice(''); setBusy(button, true);
    try {
      await bootstrap();
      const result = await request('login', { method: 'POST', body: { email: $('#admin-email').value, password: $('#admin-password').value } });
      state.csrf = result.csrf || state.csrf;
      location.href = result.must_change ? '/admin/dashboard/?password=required' : '/admin/dashboard/';
    } catch (error) { notice(error.message, true); }
    finally { setBusy(button, false); }
  });
  if ($('#admin-nav')) startDashboard();
  else if ($('#login-form')) (async () => {
    try { await bootstrap(); const status = await request('status'); if (status.authenticated) location.href = '/admin/dashboard/'; }
    catch (error) { notice(error.message, true); }
  })();
})();
