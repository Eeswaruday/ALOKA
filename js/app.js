(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { experiments: [], questionIndex: 0, search: '', savedOnly: false };
  const defaultSubjects = ['DL (Deep Learning Lab)', 'FLUTTER Lab', 'NLP Lab', 'FSD-2 Lab'];
  const apiSetting = (window.ALOKA_API_URL || '').trim();
  const localPhp = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '8000';
  const apiUrl = apiSetting || (localPhp ? new URL('/api/admin.php', location.origin).href : '');
  const bookmarks = () => { try { const value = JSON.parse(localStorage.getItem('aloka.saved') || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : []; } catch { return []; } };
  const text = (value) => String(value ?? '');
  const make = (tag, cls, value) => { const el = document.createElement(tag); if (cls) el.className = cls; if (value !== undefined) el.textContent = value; return el; };
  const toast = (message) => { const el = make('div', 'toast', message); el.setAttribute('role', 'status'); document.body.append(el); setTimeout(() => el.remove(), 2200); };
  function detailSection(parent, title, value, list = false) {
    if (!value || (Array.isArray(value) && !value.length)) return;
    const section = make('section', 'detail-section'); section.append(make('h3', '', title));
    if (Array.isArray(value)) { const items = document.createElement(list ? 'ol' : 'ul'); value.forEach(item => items.append(make('li', '', item))); section.append(items); }
    else section.append(make('p', '', value));
    parent.append(section);
  }
  function openExperiment(item) {
    const host = $('#experiment-detail-content'); host.replaceChildren();
    host.append(make('p', 'eyebrow', item.language || ''), make('h2', '', item.title));
    detailSection(host, 'Description', item.description); detailSection(host, 'Aim', item.aim); detailSection(host, 'Prerequisites', item.prerequisites); detailSection(host, 'Algorithm', item.algorithm); detailSection(host, 'Procedure', item.procedure, true); detailSection(host, 'Explanation', item.explanation);
    if (item.sourceCode) {
      const section = make('section', 'detail-section'); section.append(make('h3', '', `Source code · ${item.language || 'Code'}`));
      const pre = document.createElement('pre'); pre.append(make('code', '', item.sourceCode)); section.append(pre);
      const copy = make('button', 'copy-button', 'Copy code'); copy.type = 'button'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(item.sourceCode); toast('Code copied.'); } catch { toast('Clipboard unavailable. Select and copy the code.'); } }); section.append(copy); host.append(section);
    }
    detailSection(host, 'Sample input', item.sampleInput); detailSection(host, 'Sample output', item.sampleOutput || item.expectedOutput); detailSection(host, 'Time complexity', item.timeComplexity); detailSection(host, 'Space complexity', item.spaceComplexity); detailSection(host, 'Reference notes', item.referenceNotes);
    const related = state.experiments.filter(other => other.id !== item.id && (other.subject === item.subject || other.category === item.category)).slice(0, 4);
    if (related.length) { const section = make('section', 'detail-section'); section.append(make('h3', '', 'Related experiments')); related.forEach(other => { const link = make('button', 'related-experiment-link', other.title); link.type = 'button'; link.addEventListener('click', () => openExperiment(other)); section.append(link); }); host.append(section); }
    const viva = (item.vivaQuestions || []).filter(q => q && q.question && q.answer);
    if (viva.length) { const section = make('section', 'detail-section'); section.append(make('h3', '', 'Viva questions')); const list = document.createElement('ol'); viva.forEach(q => { const li = document.createElement('li'); li.append(make('strong', '', q.question), make('p', '', q.answer)); list.append(li); }); section.append(list); host.append(section); }
    $('#experiment-dialog').showModal();
    location.hash = `experiment/${encodeURIComponent(item.slug || item.id)}`;
  }
  function selectOptions(select, values, label) {
    const items = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const labelNode = document.querySelector(`label[for="${select.id}"]`);
    select.hidden = !items.length; if (labelNode) labelNode.hidden = !items.length;
    const selected = select.value || 'all'; select.replaceChildren(new Option(`All ${label}`, 'all'));
    items.forEach(value => select.add(new Option(value, value)));
    select.value = [...select.options].some(option => option.value === selected) ? selected : 'all';
  }
  function filtered() {
    const query = state.search.toLowerCase(); const subject = $('#subject-filter').value; const category = $('#category-filter').value; const saved = bookmarks();
    return state.experiments.filter(item => {
      const haystack = [item.title, item.subject, item.category, item.language, item.description, item.aim, item.sourceCode, ...(item.tags || [])].map(text).join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (subject === 'all' || item.subject === subject) && (category === 'all' || item.category === category) && (!state.savedOnly || saved.includes(item.id));
    });
  }
  function renderLibrary() {
    const items = filtered(), saved = bookmarks(), list = $('#experiment-list'); list.replaceChildren();
    $('#saved-count').textContent = saved.length; $('#library-count').textContent = `${String(items.length).padStart(2, '0')} AVAILABLE`;
    const groups = new Map();
    items.forEach(item => { const subject = item.subject || 'Other experiments'; if (!groups.has(subject)) groups.set(subject, []); groups.get(subject).push(item); });
    [...groups].sort(([a], [b]) => a.localeCompare(b)).forEach(([subject, experiments]) => {
      const group = make('section', 'experiment-group'); group.append(make('h3', 'experiment-group-title', subject));
      experiments.sort((a, b) => String(a.experimentNumber || '').localeCompare(String(b.experimentNumber || ''), undefined, { numeric: true, sensitivity: 'base' }) || a.title.localeCompare(b.title));
      experiments.forEach((item, index) => {
        const row = make('article', 'experiment-row');
        row.append(make('span', 'row-number', item.experimentNumber || String(index + 1).padStart(2, '0')));
        const title = make('button', 'row-title experiment-open', item.title); title.type = 'button'; title.dataset.open = item.id;
        const summary = document.createElement('div'); summary.append(title, make('div', 'row-subtitle', item.language || '')); row.append(summary);
        row.append(make('span', 'row-tags', (item.tags || []).join(' / ')));
        const save = make('button', 'save-button', saved.includes(item.id) ? '★' : '☆'); save.type = 'button'; save.dataset.save = item.id; save.setAttribute('aria-pressed', String(saved.includes(item.id))); save.setAttribute('aria-label', `Save ${item.title}`); row.append(save);
        row.querySelector('[data-open]').addEventListener('click', () => openExperiment(item)); group.append(row);
      });
      list.append(group);
    });
    $('#empty-state').hidden = items.length > 0;
    $('#library-status').textContent = state.experiments.length ? `${state.experiments.length} published ${state.experiments.length === 1 ? 'experiment' : 'experiments'}.` : 'No published experiments are available yet.';
    renderHero();
  }
  function renderHero() {
    const list = $('#hero-experiments'); list.replaceChildren();
    const query = state.search.toLowerCase();
    const items = state.experiments.filter(item => [item.title, item.subject, item.category, item.tags || []].flat().join(' ').toLowerCase().includes(query)).slice(0, 3);
    if (!items.length) list.append(make('p', 'hero-no-results', state.experiments.length ? 'No matching experiments. Try another search.' : 'Published experiments will appear here.'));
    items.forEach(item => { const button = make('button', 'hero-experiment', ''); button.type = 'button'; button.append(make('span', 'hero-experiment-copy', item.title), make('small', 'hero-experiment-language', item.language || ''), make('span', 'hero-experiment-arrow', '↗')); button.addEventListener('click', () => openExperiment(item)); list.append(button); });
  }
  function renderQuestion() {
    const questions = state.experiments.flatMap(item => (item.vivaQuestions || []).filter(q => q && q.question && q.answer).map(q => ({ ...q, subject: item.subject, title: item.title })));
    $('#question-card').hidden = !questions.length; $('#viva-empty').hidden = questions.length > 0; $('#next-question').disabled = questions.length < 2;
    if (!questions.length) return;
    state.questionIndex %= questions.length; const q = questions[state.questionIndex];
    $('#question-subject').textContent = `${q.subject || 'VIVA'} · ${q.title}`.toUpperCase(); $('#question-count').textContent = `${String(state.questionIndex + 1).padStart(2, '0')} / ${String(questions.length).padStart(2, '0')}`;
    $('#question-text').textContent = q.question; $('#answer-text').textContent = q.answer; $('#answer-text').hidden = true; $('#reveal-answer').setAttribute('aria-expanded', 'false'); $('#reveal-answer').textContent = 'Reveal answer ＋';
  }
  function setup() {
    $('.menu-toggle').addEventListener('click', e => { const button = e.currentTarget, open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); $('#site-nav').classList.toggle('is-open', open); });
    $('#site-nav').addEventListener('click', e => { if (e.target.closest('a')) { $('#site-nav').classList.remove('is-open'); $('.menu-toggle').setAttribute('aria-expanded', 'false'); $('.menu-toggle').setAttribute('aria-label', 'Open navigation'); } });
    $('#search').addEventListener('input', e => { state.search = e.target.value.trim(); renderLibrary(); });
    $('#subject-filter').addEventListener('change', renderLibrary); $('#category-filter').addEventListener('change', renderLibrary);
    $('#saved-filter').addEventListener('click', e => { state.savedOnly = !state.savedOnly; e.currentTarget.setAttribute('aria-pressed', String(state.savedOnly)); e.currentTarget.classList.toggle('is-active', state.savedOnly); renderLibrary(); });
    $('#experiment-list').addEventListener('click', e => { const button = e.target.closest('[data-save]'); if (!button) return; const current = bookmarks(), id = button.dataset.save; localStorage.setItem('aloka.saved', JSON.stringify(current.includes(id) ? current.filter(x => x !== id) : [...current, id])); renderLibrary(); toast('Bookmarks are saved on this device.'); });
    $('#close-experiment').addEventListener('click', () => { $('#experiment-dialog').close(); if (location.hash.startsWith('#experiment/')) history.replaceState(null, '', '#experiments'); });
    $('#experiment-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) $('#close-experiment').click(); });
    $('#reveal-answer').addEventListener('click', () => { const open = $('#reveal-answer').getAttribute('aria-expanded') !== 'true'; $('#reveal-answer').setAttribute('aria-expanded', String(open)); $('#answer-text').hidden = !open; $('#reveal-answer').textContent = open ? 'Hide answer −' : 'Reveal answer ＋'; });
    $('#next-question').addEventListener('click', () => { state.questionIndex++; renderQuestion(); });
    document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); } });
    $('#year').textContent = new Date().getFullYear();
  }
  async function init() {
    setup();
    try {
      let result;
      if (apiUrl) {
        const url = new URL(apiUrl); url.searchParams.set('action', 'public-experiments');
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`API request failed (${response.status}).`);
        result = await response.json();
      } else {
        const files = ['experiments', 'subjects', 'categories'];
        const responses = await Promise.all(files.map(file => fetch(new URL(`data/${file}.json`, document.baseURI), { cache: 'no-store' })));
        const failed = responses.find(response => !response.ok);
        if (failed) throw new Error(`Published catalogue request failed (${failed.status}).`);
        const [experiments, subjects, categories] = await Promise.all(responses.map(response => response.json()));
        result = { experiments, subjects, categories };
      }
      state.experiments = Array.isArray(result.experiments) ? result.experiments.filter(item => item && item.status === 'published') : [];
      selectOptions($('#subject-filter'), [...defaultSubjects, ...(result.subjects || []), ...state.experiments.map(item => item.subject)], 'subjects');
      selectOptions($('#category-filter'), result.categories || state.experiments.map(item => item.category), 'categories');
      renderLibrary(); renderQuestion();
      const target = decodeURIComponent(location.hash.replace(/^#experiment\//, ''));
      if (location.hash.startsWith('#experiment/')) { const item = state.experiments.find(record => (record.slug || record.id) === target); if (item) openExperiment(item); else location.hash = '#experiments'; }
    } catch (error) { $('#library-status').textContent = `The published library could not load. ${error.message}`; $('#library-status').classList.add('is-error'); $('#empty-state').hidden = false; $('#empty-state').querySelector('h3').textContent = 'Catalogue unavailable.'; $('#empty-state').querySelector('p').textContent = 'Try again later or contact the site administrator.'; renderHero(); }
  }
  init();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => {});
})();
