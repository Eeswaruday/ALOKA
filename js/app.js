const state = { experiments: [], viva: [], filter: 'all', search: '', question: 0 };
const $ = (selector) => document.querySelector(selector);
function saved() { try { return JSON.parse(localStorage.getItem('aloka.saved') || '[]'); } catch { return []; } }
function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderExperiments() {
 const bookmarks = saved();
 const list = state.experiments.filter(item => {
  const text = `${item.title} ${item.subject} ${item.level} ${item.objective} ${item.code} ${item.tags.join(' ')}`.toLowerCase();
  return (state.filter === 'all' || item.subject === state.filter || (state.filter === 'saved' && bookmarks.includes(item.id))) && text.includes(state.search.toLowerCase());
 });
 $('#saved-count').textContent = bookmarks.length;
 $('#library-count').textContent = `${String(list.length).padStart(2,'0')} AVAILABLE`;
 $('#experiment-list').innerHTML = list.map((item,i) => `<article class="experiment-row"><span class="row-number">${String(i+1).padStart(2,'0')}</span><div><div class="row-title">${esc(item.title)}</div><div class="row-subtitle">${esc(item.level)} · ${esc(item.subject)}</div></div><span class="row-tags">${item.tags.map(esc).join(' / ')}</span><span class="row-duration">${esc(item.duration)}</span><button class="save-button" data-save="${esc(item.id)}" aria-label="Bookmark ${esc(item.title)}" aria-pressed="${bookmarks.includes(item.id)}">${bookmarks.includes(item.id) ? '★' : '☆'}</button><details class="experiment-detail"><summary>Open experiment</summary><div class="detail-body"><p><strong>Objective:</strong> ${esc(item.objective)}</p><h4>Procedure</h4><ol>${item.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol><h4>Example code</h4>${item.code ? `<pre><code>${esc(item.code)}</code></pre><button class="copy-button" data-copy="${esc(item.id)}">Copy code</button>` : '<p>No code added yet.</p>'}<label class="check-item"><input type="checkbox" data-check="${esc(item.id)}" ${localStorage.getItem(`aloka.done.${item.id}`)==='true'?'checked':''}> Mark revised on this device</label></div></details></article>`).join('');
 $('#empty-state').hidden = list.length > 0;
}
function renderHeroExperiments() {
 const items=state.experiments.filter(item=>`${item.title} ${item.subject} ${item.level} ${item.objective} ${item.code} ${item.tags.join(' ')}`.toLowerCase().includes(state.search.toLowerCase())).slice(0,4);
 $('#hero-experiments').innerHTML=items.map(item=>`<details class="hero-experiment"><summary><span><strong>${esc(item.title)}</strong><small>${esc(item.subject)} · ${esc(item.level)}</small></span><span aria-hidden="true">↗</span></summary><div class="hero-code"><p>${esc(item.objective)}</p>${item.code ? `<pre><code>${esc(item.code)}</code></pre><button class="copy-button" data-hero-copy="${esc(item.id)}">Copy code</button>` : '<p>No code added yet.</p>'}</div></details>`).join('')||'<p class="hero-no-results">No matching experiments. Try another search.</p>';
}
function showQuestion() { const q=state.viva[state.question]; if(!q)return; $('#question-subject').textContent=q.subject.toUpperCase(); $('#question-count').textContent=`${String(state.question+1).padStart(2,'0')} / ${String(state.viva.length).padStart(2,'0')}`; $('#question-text').textContent=q.question; $('#answer-text').textContent=q.answer; $('#answer-text').hidden=true; $('#reveal-answer').setAttribute('aria-expanded','false'); $('#reveal-answer').textContent='Reveal answer ＋'; }
function toast(message) { const node=document.createElement('div'); node.className='toast'; node.setAttribute('role','status'); node.textContent=message; document.body.append(node); setTimeout(()=>node.remove(),2200); }
async function init() {
 try { [state.experiments,state.viva]=await Promise.all(['data/experiments.json','data/viva.json'].map(path=>fetch(path).then(r=>{if(!r.ok)throw Error('Could not load library');return r.json();}))); renderExperiments(); renderHeroExperiments(); showQuestion(); }
 catch { $('#experiment-list').innerHTML='<p class="empty-state">The library could not load. Open this site through localhost to load the learning files.</p>'; }
}
$('.menu-toggle').addEventListener('click',e=>{const b=e.currentTarget,open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-label',open?'Close navigation':'Open navigation');$('#site-nav').classList.toggle('is-open',open);});
$('#site-nav').addEventListener('click',e=>{if(e.target.closest('a')){$('#site-nav').classList.remove('is-open');$('.menu-toggle').setAttribute('aria-expanded','false');}});
$('#search').addEventListener('input',e=>{state.search=e.target.value.trim();renderExperiments();renderHeroExperiments();});
document.querySelectorAll('.filter-chip').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;document.querySelectorAll('.filter-chip').forEach(x=>{x.classList.toggle('is-active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderExperiments();}));
$('#experiment-list').addEventListener('click',async e=>{const b=e.target.closest('[data-save]');if(b){const list=saved(),id=b.dataset.save;localStorage.setItem('aloka.saved',JSON.stringify(list.includes(id)?list.filter(x=>x!==id):[...list,id]));renderExperiments();toast('Bookmarks are saved on this device.');return;}const c=e.target.closest('[data-copy]');if(c){const item=state.experiments.find(x=>x.id===c.dataset.copy);try{await navigator.clipboard.writeText(item.code);toast('Code copied.');}catch{toast('Clipboard needs a secure page; select and copy the code instead.');}}});
$('#hero-experiments').addEventListener('click',async e=>{const b=e.target.closest('[data-hero-copy]');if(!b)return;const item=state.experiments.find(x=>x.id===b.dataset.heroCopy);try{await navigator.clipboard.writeText(item.code);toast('Code copied.');}catch{toast('Clipboard needs a secure page; select and copy the code instead.');}});
$('#experiment-list').addEventListener('change',e=>{if(e.target.dataset.check)localStorage.setItem(`aloka.done.${e.target.dataset.check}`,String(e.target.checked));});
$('#reveal-answer').addEventListener('click',()=>{const open=$('#reveal-answer').getAttribute('aria-expanded')!=='true';$('#reveal-answer').setAttribute('aria-expanded',String(open));$('#answer-text').hidden=!open;$('#reveal-answer').textContent=open?'Hide answer −':'Reveal answer ＋';});
$('#next-question').addEventListener('click',()=>{state.question=(state.question+1)%state.viva.length;showQuestion();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}if(e.key==='Enter'&&document.activeElement===$('#search')&&state.search){e.preventDefault();$('#experiments').scrollIntoView({behavior:'smooth'});}});
$('#year').textContent=new Date().getFullYear();
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('service-worker.js').catch(()=>{});
init();
