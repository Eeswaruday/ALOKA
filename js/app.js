(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { experiments: [], subjects: [], questionIndex: 0, vivaExperimentId: '', search: '', savedOnly: false, selectedSubject: '', heroSubject: '' };
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
  function vivaQuestions(item) {
    const supplied = (item.vivaQuestions || []).filter(q => q && q.question && q.answer), code = text(item.sourceCode), generated = [];
    const add = (question, answer) => generated.push({ question, answer });
    if (item.title) add('What is the main objective of this experiment?', item.aim || item.description || `The experiment is titled “${item.title}”.`);
    const imports = code.split('\n').filter(line => /^\s*(import\s|from\s.+\simport\s)/.test(line));
    if (imports.length) add('Which libraries or modules does the program import?', imports.join('\n'));
    const dataset = code.match(/(?:from\s+([\w.]+\s+import\s+)?|\b)([\w.]+)\.load_data\s*\(/);
    if (dataset) add('Which dataset does the code actually load?', `${dataset[2]} is loaded in the source code.${/mnist|digit classification/i.test(item.title || '') && /boston_housing/.test(code) ? ' Note: the title mentions digit classification, but this code uses Boston Housing data.' : ''}`);
    if (/x_train\s*=.*mean|\.std\s*\(/i.test(code) && /x_test/.test(code)) add('Why does the program standardize its input data?', 'It scales features using the training data mean and standard deviation so inputs are on comparable scales. The same training statistics are applied to the test data to avoid using test data to fit the preprocessing.');
    if (/sequential\s*\(/i.test(code)) add('What does the Sequential model represent here?', 'It applies the listed neural-network layers in order, passing each layer’s output to the next.');
    const dense = [...code.matchAll(/Dense\s*\(([^)]*)\)/gi)].map(match => match[1]);
    if (dense.length) add('What do the Dense layers specify?', dense.map((layer, index) => `Layer ${index + 1}: Dense(${layer.trim()})`).join('; ') + '.');
    const loss = code.match(/loss\s*=\s*['"]([^'"]+)/i), optimizer = code.match(/optimizer\s*=\s*['"]([^'"]+)/i);
    if (loss || optimizer) add('How is the model compiled?', `The optimizer is ${optimizer?.[1] || 'not specified'} and the loss is ${loss?.[1] || 'not specified'}.`);
    const epochs = code.match(/epochs\s*=\s*(\d+)/i);
    if (/\.fit\s*\(/i.test(code)) add('How does this program train its model?', `It calls fit() with the training data${epochs ? ` for ${epochs[1]} epochs` : ''}.`);
    if (/\.predict\s*\(/i.test(code)) add('What is the purpose of the prediction step?', 'The trained model uses predict() to produce outputs for the supplied input data.');
    if (/plt\.scatter|\.scatter\s*\(/i.test(code)) add('What does the scatter plot help you inspect?', 'It compares pairs of values visually; in this source the axes are labeled actual and predicted price, so it helps inspect how close predictions are to actual values.');
    if (/\bfor\s+\w+\s+in\s+/.test(code)) add('Where does the program repeat work?', 'A for loop iterates over a sequence, applying its indented block to each item.');
    if (/\bdef\s+\w+\s*\(/.test(code)) add('Why are functions useful in this program?', 'A function groups reusable steps behind a name, making the program easier to organize and call.');
    const unique = new Set(supplied.map(q => q.question.trim().toLowerCase()));
    return [...supplied, ...generated.filter(q => !unique.has(q.question.toLowerCase()))];
  }
  function openExperiment(item) {
    state.vivaExperimentId = item.id; state.questionIndex = 0; renderQuestion();
    const host = $('#experiment-detail-content'); host.replaceChildren();
    host.append(make('p', 'eyebrow', item.language || ''), make('h2', '', item.title));
    const practice = make('button', 'copy-button', 'Practice this experiment’s Viva ↓'); practice.type = 'button'; practice.addEventListener('click', () => { $('#experiment-dialog').close(); $('#viva').scrollIntoView({ behavior: 'smooth' }); $('#next-question').focus({ preventScroll: true }); }); host.append(practice);
    detailSection(host, 'Description', item.description); detailSection(host, 'Aim', item.aim); detailSection(host, 'Prerequisites', item.prerequisites); detailSection(host, 'Algorithm', item.algorithm); detailSection(host, 'Procedure', item.procedure, true); detailSection(host, 'Explanation', item.explanation);
    if (item.sourceCode) {
      const section = make('section', 'detail-section'); section.append(make('h3', '', `Source code · ${item.language || 'Code'}`));
      const pre = document.createElement('pre'); pre.append(make('code', '', item.sourceCode)); section.append(pre);
      const copy = make('button', 'copy-button', 'Copy code'); copy.type = 'button'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(item.sourceCode); toast('Code copied.'); } catch { toast('Clipboard unavailable. Select and copy the code.'); } }); section.append(copy); host.append(section);
    }
    detailSection(host, 'Sample input', item.sampleInput); detailSection(host, 'Sample output', item.sampleOutput || item.expectedOutput); detailSection(host, 'Time complexity', item.timeComplexity); detailSection(host, 'Space complexity', item.spaceComplexity); detailSection(host, 'Reference notes', item.referenceNotes);
    const related = state.experiments.filter(other => other.id !== item.id && (other.subject === item.subject || other.category === item.category)).slice(0, 4);
    if (related.length) { const section = make('section', 'detail-section'); section.append(make('h3', '', 'Related experiments')); related.forEach(other => { const link = make('button', 'related-experiment-link', other.title); link.type = 'button'; link.addEventListener('click', () => openExperiment(other)); section.append(link); }); host.append(section); }
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
  function filtered(subject = state.selectedSubject) {
    const query = state.search.toLowerCase(); const category = $('#category-filter').value; const saved = bookmarks();
    return state.experiments.filter(item => {
      const haystack = [item.title, item.subject, item.category, item.language, item.description, item.aim, item.sourceCode, ...(item.tags || [])].map(text).join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (subject === 'all' || item.subject === subject) && (category === 'all' || item.category === category) && (!state.savedOnly || saved.includes(item.id));
    });
  }
  function renderLibrary() {
    const items = filtered(), allItems = filtered('all'), saved = bookmarks(), list = $('#experiment-list'), subjects = $('#subject-list'); list.replaceChildren(); subjects.replaceChildren();
    $('#saved-count').textContent = saved.length; $('#library-count').textContent = `${String(allItems.length).padStart(2, '0')} AVAILABLE`;
    subjects.hidden = Boolean(state.selectedSubject); list.hidden = !state.selectedSubject;
    if (!state.selectedSubject) {
      const counts = new Map(); allItems.forEach(item => counts.set(item.subject || 'Other experiments', (counts.get(item.subject || 'Other experiments') || 0) + 1));
      const names = [...new Set([...defaultSubjects, ...state.subjects, ...state.experiments.map(item => item.subject).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
      names.forEach((subject, index) => {
        const count = counts.get(subject) || 0, button = make('button', 'subject-card'); button.type = 'button'; button.setAttribute('aria-label', `${subject}, ${count} ${count === 1 ? 'experiment' : 'experiments'}`);
        button.append(make('span', 'subject-card-number', String(index + 1).padStart(2, '0')), make('strong', 'subject-card-title', subject), make('span', 'subject-card-count', `${count} ${count === 1 ? 'experiment' : 'experiments'}`), make('span', 'subject-card-arrow', '↗'));
        button.addEventListener('click', () => { state.selectedSubject = subject; renderLibrary(); }); subjects.append(button);
      });
    } else {
      const heading = make('div', 'subject-list-heading'), back = make('button', 'subject-back', '← All subjects'); back.type = 'button'; back.addEventListener('click', () => { state.selectedSubject = ''; renderLibrary(); });
      heading.append(back, make('h3', '', state.selectedSubject), make('span', '', `${items.length} ${items.length === 1 ? 'experiment' : 'experiments'}`)); list.append(heading);
    }
    const groups = new Map();
    items.forEach(item => { const subject = item.subject || 'Other experiments'; if (!groups.has(subject)) groups.set(subject, []); groups.get(subject).push(item); });
    [...groups].sort(([a], [b]) => a.localeCompare(b)).forEach(([, experiments]) => {
      const group = make('section', 'experiment-group');
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
    $('#empty-state').hidden = state.selectedSubject ? items.length > 0 : state.experiments.length > 0;
    $('#empty-state h3').textContent = state.selectedSubject ? `No experiments in ${state.selectedSubject} yet.` : 'No experiments published yet.';
    $('#empty-state p').textContent = state.selectedSubject ? 'Choose another subject to browse its published experiments.' : 'New laboratory experiments will appear here once the administrator publishes them.';
    $('#library-status').textContent = state.selectedSubject ? '' : `${allItems.length} matching ${allItems.length === 1 ? 'experiment' : 'experiments'} across ${new Set(allItems.map(item => item.subject).filter(Boolean)).size} subjects.`;
    renderHero();
  }
  function renderHero() {
    const list = $('#hero-experiments'); list.replaceChildren();
    const query = state.search.toLowerCase();
    if (!query) {
      if (state.heroSubject) {
        const back = make('button', 'hero-subject-back', '← All subjects'); back.type = 'button'; back.addEventListener('click', () => { state.heroSubject = ''; renderHero(); }); list.append(back);
        const items = state.experiments.filter(item => item.subject === state.heroSubject).sort((a, b) => String(a.experimentNumber || '').localeCompare(String(b.experimentNumber || ''), undefined, { numeric: true, sensitivity: 'base' }) || a.title.localeCompare(b.title));
        if (!items.length) list.append(make('p', 'hero-no-results', 'No published experiments in this subject yet.'));
        items.forEach(item => { const button = make('button', 'hero-experiment', ''); button.type = 'button'; button.append(make('span', 'hero-experiment-copy', item.title), make('small', 'hero-experiment-language', item.language || ''), make('span', 'hero-experiment-arrow', '↗')); button.addEventListener('click', () => openExperiment(item)); list.append(button); });
        return;
      }
      const subjects = [...new Set([...defaultSubjects, ...state.subjects, ...state.experiments.map(item => item.subject).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
      subjects.forEach(subject => {
        const count = state.experiments.filter(item => item.subject === subject).length;
        const button = make('button', 'hero-experiment hero-subject', ''); button.type = 'button'; button.append(make('span', 'hero-experiment-copy', subject), make('small', 'hero-experiment-language', `${count} ${count === 1 ? 'experiment' : 'experiments'}`), make('span', 'hero-experiment-arrow', '↗'));
        button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', () => { state.heroSubject = subject; renderHero(); }); list.append(button);
      });
      return;
    }
    const items = state.experiments.filter(item => [item.title, item.subject, item.category, item.language, item.description, item.aim, item.sourceCode, item.tags || []].flat().join(' ').toLowerCase().includes(query)).slice(0, 3);
    if (!items.length) list.append(make('p', 'hero-no-results', 'No matching experiments. Try another search.'));
    items.forEach(item => { const button = make('button', 'hero-experiment', ''); button.type = 'button'; button.append(make('span', 'hero-experiment-copy', item.title), make('small', 'hero-experiment-language', `${item.subject || 'Experiment'} · ${item.language || ''}`), make('span', 'hero-experiment-arrow', '↗')); button.addEventListener('click', () => openExperiment(item)); list.append(button); });
  }
  function renderQuestion() {
    const experiments = state.experiments.filter(item => !state.vivaExperimentId || item.id === state.vivaExperimentId);
    const questions = experiments.flatMap(item => vivaQuestions(item).map(q => ({ ...q, subject: item.subject, title: item.title })));
    $('#question-card').hidden = !questions.length; $('#viva-empty').hidden = questions.length > 0; $('#next-question').disabled = questions.length < 2; $('#all-viva').hidden = !state.vivaExperimentId;
    $('#viva-empty').textContent = state.experiments.length ? 'Choose an experiment to start a focused Viva practice session.' : 'Viva questions will appear here when an experiment is published.';
    if (!questions.length) return;
    state.questionIndex %= questions.length; const q = questions[state.questionIndex];
    $('#question-subject').textContent = `${q.subject || 'VIVA'} · ${q.title}`.toUpperCase(); $('#question-count').textContent = `${String(state.questionIndex + 1).padStart(2, '0')} / ${String(questions.length).padStart(2, '0')}`;
    $('#question-text').textContent = q.question; $('#answer-text').textContent = q.answer; $('#answer-text').hidden = true; $('#reveal-answer').setAttribute('aria-expanded', 'false'); $('#reveal-answer').textContent = 'Reveal answer ＋';
  }
  function setup() {
    $('.menu-toggle').addEventListener('click', e => { const button = e.currentTarget, open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); $('#site-nav').classList.toggle('is-open', open); });
    $('#site-nav').addEventListener('click', e => { if (e.target.closest('a')) { $('#site-nav').classList.remove('is-open'); $('.menu-toggle').setAttribute('aria-expanded', 'false'); $('.menu-toggle').setAttribute('aria-label', 'Open navigation'); } });
    $('#search').addEventListener('input', e => { state.search = e.target.value.trim(); renderLibrary(); });
    $('#category-filter').addEventListener('change', renderLibrary);
    $('#saved-filter').addEventListener('click', e => { state.savedOnly = !state.savedOnly; e.currentTarget.setAttribute('aria-pressed', String(state.savedOnly)); e.currentTarget.classList.toggle('is-active', state.savedOnly); renderLibrary(); });
    $('#experiment-list').addEventListener('click', e => { const button = e.target.closest('[data-save]'); if (!button) return; const current = bookmarks(), id = button.dataset.save; localStorage.setItem('aloka.saved', JSON.stringify(current.includes(id) ? current.filter(x => x !== id) : [...current, id])); renderLibrary(); toast('Bookmarks are saved on this device.'); });
    $('#close-experiment').addEventListener('click', () => { $('#experiment-dialog').close(); if (location.hash.startsWith('#experiment/')) history.replaceState(null, '', '#experiments'); });
    $('#experiment-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) $('#close-experiment').click(); });
    $('#reveal-answer').addEventListener('click', () => { const open = $('#reveal-answer').getAttribute('aria-expanded') !== 'true'; $('#reveal-answer').setAttribute('aria-expanded', String(open)); $('#answer-text').hidden = !open; $('#reveal-answer').textContent = open ? 'Hide answer −' : 'Reveal answer ＋'; });
    $('#next-question').addEventListener('click', () => { state.questionIndex++; renderQuestion(); });
    $('#all-viva').addEventListener('click', () => { state.vivaExperimentId = ''; state.questionIndex = 0; renderQuestion(); });
    document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); } });
    $('#year').textContent = new Date().getFullYear();
  }
  async function init() {
    setup();
    renderHero();
    try {
      let result;
      if (apiUrl) {
        const url = new URL(apiUrl, location.origin); url.searchParams.set('action', 'public-experiments');
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
      state.subjects = Array.isArray(result.subjects) ? result.subjects.filter(subject => typeof subject === 'string') : [];
      selectOptions($('#category-filter'), result.categories || state.experiments.map(item => item.category), 'categories');
      renderLibrary(); renderQuestion();
      const target = decodeURIComponent(location.hash.replace(/^#experiment\//, ''));
      if (location.hash.startsWith('#experiment/')) { const item = state.experiments.find(record => (record.slug || record.id) === target); if (item) openExperiment(item); else location.hash = '#experiments'; }
    } catch (error) { $('#library-status').textContent = `The published library could not load. ${error.message}`; $('#library-status').classList.add('is-error'); $('#empty-state').hidden = false; $('#empty-state').querySelector('h3').textContent = 'Catalogue unavailable.'; $('#empty-state').querySelector('p').textContent = 'Try again later or contact the site administrator.'; renderHero(); }
  }
  init();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => {});
})();
