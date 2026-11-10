// === State ===
let token = localStorage.getItem('lingvo_token');
let quizWords = [];
let quizIndex = 0;
let quizCorrect = 0;
let quizResults = []; // {word, direction, answer, correct, expected}
let lastDirection = 'en_de';

// === API ===
const api = {
  base: '',
  async call(path, opts = {}) {
    const headers = { ...opts.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(this.base + path, { ...opts, headers });
    if (res.status === 401) {
      token = null;
      localStorage.removeItem('lingvo_token');
      showScreen('login');
      throw new Error('Unauthorized');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }
    return res;
  },
  login: (password) => api.call('/api/login', { method: 'POST', body: { password } }),
  getQuiz: (direction, limit = 10) => api.call(`/api/quiz?direction=${direction}&limit=${limit}`),
  submitAnswer: (id, direction, answer) => api.call('/api/answer', { method: 'POST', body: { id, direction, answer } }),
  getStats: () => api.call('/api/stats'),
  getWords: () => api.call('/api/words'),
  addWord: (en, de, notes) => api.call('/api/words', { method: 'POST', body: { en, de, notes } }),
  updateWord: (id, en, de, notes) => api.call(`/api/words/${id}`, { method: 'PUT', body: { en, de, notes } }),
  deleteWord: (id) => api.call(`/api/words/${id}`, { method: 'DELETE' }),
  importCsv: (text) => api.call('/api/import', { method: 'POST', body: text, headers: { 'Content-Type': 'text/plain' } }),
};

// === Navigation ===
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  if (id === 'menu') loadStats();
  if (id === 'browse') loadBrowseList();
  if (id === 'manage') {
    document.getElementById('manage-search').value = '';
    loadWordList();
  }
}

// === Login ===
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('login-password');
  const err = document.getElementById('login-error');
  err.hidden = true;
  try {
    const data = await api.login(pw.value);
    token = data.token;
    localStorage.setItem('lingvo_token', token);
    pw.value = '';
    showScreen('menu');
  } catch (e) {
    err.textContent = 'Wrong password';
    err.hidden = false;
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  token = null;
  localStorage.removeItem('lingvo_token');
  showScreen('login');
});

// === Stats ===
async function loadStats() {
  try {
    const s = await api.getStats();
    document.getElementById('menu-stats').innerHTML = `
      <div class="stat"><div class="stat-value">${s.total_words}</div><div class="stat-label">Words</div></div>
      <div class="stat"><div class="stat-value">${s.active_bucket}</div><div class="stat-label">Active</div></div>
      <div class="stat"><div class="stat-value">${s.learned}</div><div class="stat-label">Learned</div></div>
      <div class="stat"><div class="stat-value">${s.unlearned}</div><div class="stat-label">Remaining</div></div>
    `;
  } catch (e) {
    document.getElementById('menu-stats').innerHTML = '<div class="empty-state">Could not load stats</div>';
  }
}

// === Menu actions ===
document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'quiz-en-de') startQuiz('en_de');
    else if (action === 'quiz-de-en') startQuiz('de_en');
    else if (action === 'quiz-mixed') startQuiz('mixed');
    else if (action === 'browse') showScreen('browse');
    else if (action === 'manage') showScreen('manage');
    else if (action === 'menu') showScreen('menu');
  });
});

// === Quiz ===
async function startQuiz(direction) {
  lastDirection = direction;
  try {
    const data = await api.getQuiz(direction);
    if (data.words.length === 0) {
      alert(data.total_remaining === 0
        ? 'All words learned in this direction! Add more or reset progress.'
        : 'No words available. Add some words first.');
      return;
    }
    quizWords = data.words;
    quizIndex = 0;
    quizCorrect = 0;
    quizResults = [];
    showScreen('quiz');
    showQuestion();
  } catch (e) {
    alert('Failed to load quiz: ' + e.message);
  }
}

function showQuestion() {
  const w = quizWords[quizIndex];
  const dir = w.quiz_direction;
  const total = quizWords.length;

  document.getElementById('quiz-counter').textContent = `${quizIndex + 1} / ${total}`;
  document.getElementById('quiz-bar').style.width = `${((quizIndex) / total) * 100}%`;
  document.getElementById('quiz-score').textContent = quizCorrect;

  document.getElementById('quiz-direction').textContent = dir === 'en_de' ? 'English → Deutsch' : 'Deutsch → English';
  document.getElementById('quiz-word').textContent = dir === 'en_de' ? alts(w.en) : alts(w.de);

  const input = document.getElementById('quiz-input');
  const form = document.getElementById('quiz-form');
  const feedback = document.getElementById('quiz-feedback');
  const hint = document.getElementById('quiz-hint');

  // Disable autocorrect/spellcheck for German answers; enable for English
  const expectingGerman = dir === 'en_de';
  input.setAttribute('autocorrect', expectingGerman ? 'off' : 'on');
  input.setAttribute('autocapitalize', expectingGerman ? 'off' : 'sentences');
  input.setAttribute('spellcheck', String(!expectingGerman));
  input.setAttribute('lang', expectingGerman ? 'de' : 'en');

  input.value = '';
  input.disabled = false;
  form.hidden = false;
  feedback.hidden = true;
  hint.hidden = true;
  document.getElementById('btn-clear-input').hidden = true;
  document.getElementById('quiz-notes').hidden = true;
  document.getElementById('screen-quiz').classList.remove('revealed');
  document.getElementById('screen-quiz').scrollTop = 0;
  document.getElementById('btn-check').hidden = false;
  document.getElementById('btn-skip').hidden = false;

  setTimeout(() => input.focus(), 100);
}

async function doSubmitAnswer(answer) {
  const input = document.getElementById('quiz-input');
  const w = quizWords[quizIndex];
  const dir = w.quiz_direction;

  input.disabled = true;
  document.getElementById('btn-check').hidden = true;
  document.getElementById('btn-skip').hidden = true;

  try {
    const result = await api.submitAnswer(w.id, dir, answer);
    const feedback = document.getElementById('quiz-feedback');
    feedback.hidden = false;
    feedback.className = 'quiz-feedback ' + (result.correct ? 'correct' : 'wrong');
    document.getElementById('feedback-icon').textContent = result.correct ? '✓' : '✗';
    document.getElementById('feedback-label').textContent = result.correct ? 'Correct' : 'Not quite';
    document.getElementById('feedback-streak').textContent = result.correct
      ? (result.learned ? 'Learned!' : `${result.total_correct}/7`)
      : '';
    const yours = document.getElementById('feedback-yours');
    yours.hidden = result.correct;
    yours.innerHTML = result.correct ? '' : `Your answer: <s>${esc(answer)}</s>`;
    document.getElementById('feedback-answers').innerHTML = splitAlts(result.expected)
      .map(a => `<span class="answer-chip">${esc(a)}</span>`).join('');

    if (result.correct) {
      quizCorrect++;
      document.getElementById('quiz-score').textContent = quizCorrect;
    }

    // Extra context — shown whether the answer was right or wrong
    const notes = result.notes ?? w.notes ?? '';
    const notesCard = document.getElementById('quiz-notes');
    if (notes.trim()) {
      document.getElementById('quiz-notes-word').textContent = '· ' + firstAlt(w.de);
      document.getElementById('quiz-notes-body').innerHTML = renderNotes(notes);
      notesCard.hidden = false;
      document.getElementById('screen-quiz').classList.add('revealed');
    } else {
      notesCard.hidden = true;
    }

    quizResults.push({
      word: dir === 'en_de' ? w.en : w.de,
      direction: dir,
      answer,
      correct: result.correct,
      expected: result.expected
    });

    document.getElementById('quiz-form').hidden = true;
  } catch (e) {
    input.disabled = false;
    document.getElementById('btn-check').hidden = false;
    document.getElementById('btn-skip').hidden = false;
    alert('Error: ' + e.message);
  }
}

document.getElementById('quiz-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const answer = document.getElementById('quiz-input').value.trim();
  if (!answer) return;
  doSubmitAnswer(answer);
});

// Clear button: show when input has text, clear on click
(function () {
  const quizInput = document.getElementById('quiz-input');
  const clearBtn  = document.getElementById('btn-clear-input');
  quizInput.addEventListener('input', () => {
    clearBtn.hidden = quizInput.value.length === 0;
  });
  clearBtn.addEventListener('click', () => {
    quizInput.value = '';
    clearBtn.hidden = true;
    quizInput.focus();
  });
}());

document.getElementById('btn-skip').addEventListener('click', () => {
  doSubmitAnswer('');
});

function advanceQuiz() {
  quizIndex++;
  if (quizIndex >= quizWords.length) {
    showResults();
  } else {
    showQuestion();
  }
}

document.getElementById('btn-next').addEventListener('click', advanceQuiz);

// Enter key advances to next word when feedback is showing
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !document.getElementById('quiz-feedback').hidden
      && document.getElementById('screen-quiz').classList.contains('active')) {
    e.preventDefault();
    advanceQuiz();
  }
});

document.getElementById('btn-quit-quiz').addEventListener('click', () => {
  showScreen('menu');
});

// === Results ===
function showResults() {
  const total = quizWords.length;
  const pct = Math.round((quizCorrect / total) * 100);
  document.getElementById('results-score').textContent = `${quizCorrect} / ${total}`;

  let detail = `${pct}% correct\n`;
  const wrong = quizResults.filter(r => !r.correct);
  if (wrong.length > 0) {
    detail += '\nMissed:\n' + wrong.map(r => `  ${r.word} → ${alts(r.expected)}`).join('\n');
  }
  document.getElementById('results-detail').textContent = detail;

  document.getElementById('quiz-bar').style.width = '100%';
  showScreen('results');
}

document.getElementById('btn-again').addEventListener('click', () => startQuiz(lastDirection));
document.getElementById('btn-back-menu').addEventListener('click', () => showScreen('menu'));

// === Word management ===
let manageWords = [];
let editingId = null;

const addEls = {
  panel: () => document.getElementById('add-word-form'),
  title: () => document.getElementById('add-panel-title'),
  paste: () => document.getElementById('add-paste'),
  de: () => document.getElementById('add-de'),
  en: () => document.getElementById('add-en'),
  notes: () => document.getElementById('add-notes'),
  save: () => document.getElementById('btn-save-word'),
  status: () => document.getElementById('add-status'),
};

function openAddPanel(word = null) {
  editingId = word ? word.id : null;
  addEls.panel().hidden = false;
  addEls.title().textContent = word ? 'Edit word' : 'Add a word';
  addEls.paste().value = '';
  addEls.de().value = word ? word.de : '';
  addEls.en().value = word ? splitAlts(word.en).join('; ') : '';
  addEls.notes().value = word ? (word.notes || '') : '';
  setAddStatus('');
  updateAddPreview();
  (word ? addEls.de() : addEls.paste()).focus();
  addEls.panel().scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function closeAddPanel() {
  addEls.panel().hidden = true;
  editingId = null;
}

function setAddStatus(msg, kind = 'info') {
  const el = addEls.status();
  el.textContent = msg;
  el.className = 'add-status ' + kind;
  el.hidden = !msg;
}

function findExistingByDe(de) {
  const key = normalizeDe(firstAlt(de));
  if (!key) return null;
  return manageWords.find(w => normalizeDe(firstAlt(w.de)) === key) || null;
}

function updateAddPreview() {
  const notes = addEls.notes().value;
  const wrap = document.getElementById('add-preview-wrap');
  wrap.hidden = !notes.trim();
  if (notes.trim()) {
    document.getElementById('add-preview-word').textContent = addEls.de().value ? '· ' + firstAlt(addEls.de().value) : '';
    document.getElementById('add-preview').innerHTML = renderNotes(notes);
  }
  const existing = editingId ? null : findExistingByDe(addEls.de().value);
  addEls.save().textContent = editingId ? 'Save changes' : existing ? 'Update word' : 'Add word';
  if (existing) setAddStatus(`“${firstAlt(existing.de)}” is already in your list — saving updates it and keeps your progress.`, 'info');
  else if (addEls.status().classList.contains('info')) setAddStatus('');
}

document.getElementById('btn-add-word').addEventListener('click', () => {
  if (addEls.panel().hidden || editingId) openAddPanel();
  else closeAddPanel();
});
document.getElementById('btn-cancel-word').addEventListener('click', closeAddPanel);

addEls.paste().addEventListener('input', () => {
  const text = addEls.paste().value;
  if (!text.trim()) return;
  const parsed = parseClaudeText(text);
  if (parsed.de) addEls.de().value = parsed.de;
  if (parsed.en.length) addEls.en().value = parsed.en.join('; ');
  addEls.notes().value = parsed.notes;
  updateAddPreview();
  if (parsed.error) setAddStatus(parsed.error + ' — fill in the English field yourself.', 'warn');
});
['add-de', 'add-notes'].forEach(id => document.getElementById(id).addEventListener('input', updateAddPreview));

addEls.save().addEventListener('click', async () => {
  const de = addEls.de().value.trim();
  const en = addEls.en().value.trim();
  const notes = addEls.notes().value.trim();
  if (!en || !de) { setAddStatus('Both Deutsch and English are needed.', 'warn'); return; }
  const btn = addEls.save();
  btn.disabled = true;
  try {
    const res = editingId
      ? await api.updateWord(editingId, en, de, notes)
      : await api.addWord(en, de, notes);
    const name = firstAlt(res.word.de);
    await loadWordList();
    if (editingId) {
      closeAddPanel();
    } else {
      addEls.paste().value = '';
      addEls.de().value = '';
      addEls.en().value = '';
      addEls.notes().value = '';
      updateAddPreview();
      setAddStatus(res.updated ? `Updated “${name}”.` : `Added “${name}”.`, 'ok');
      addEls.paste().focus();
    }
  } catch (e) {
    setAddStatus('Failed to save: ' + e.message, 'warn');
  } finally {
    btn.disabled = false;
  }
});

// Enter in the single-line fields saves
['add-de', 'add-en'].forEach(id => document.getElementById(id).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addEls.save().click();
  }
}));

function renderWordList() {
  const query = document.getElementById('manage-search').value.trim();
  const list = document.getElementById('word-list');
  const empty = document.getElementById('word-list-empty');

  if (manageWords.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const LEARNED_AT = 7;
  const BUCKET_SIZE = 50;

  // Classify each word (preserving CSV order for bucket logic)
  const learned = [], bucket = [], remaining = [];
  for (const w of manageWords) {
    const combined = parseInt(w.streak_en_de || '0') + parseInt(w.streak_de_en || '0');
    if (combined >= LEARNED_AT) learned.push(w);
    else remaining.push(w);
  }
  bucket.push(...remaining.splice(0, BUCKET_SIZE));

  // Apply search filter after classification (so bucket logic is stable)
  const filterFn = (w) => matchesSearch(w, query);
  const visibleBucket    = bucket.filter(filterFn);
  const visibleRemaining = remaining.filter(filterFn);
  const visibleLearned   = learned.filter(filterFn);

  const renderWord = (w, cls = '') => {
      const s1 = parseInt(w.streak_en_de || '0');
      const s2 = parseInt(w.streak_de_en || '0');
      const combined = s1 + s2;
      const dots = Array.from({ length: 7 }, (_, i) =>
        `<span class="streak-dot${i < combined ? ' filled' : ''}"></span>`
      ).join('');
      return `
        <div class="word-item ${cls}" data-id="${w.id}" title="Tap to edit">
          <span class="word-en">${esc(alts(w.en))}</span>
          <span class="word-de">${esc(alts(w.de))}${(w.notes || '').trim() ? ' <span class="has-notes" title="Has notes">ⓘ</span>' : ''}</span>
          <span class="word-streak" title="Combined progress">${dots}</span>
          <button class="word-delete" data-id="${w.id}" title="Delete">×</button>
        </div>
      `;
    };

  const section = (label, count) =>
    `<div class="word-section-label">${label} <span class="word-section-count">${count}</span></div>`;

  const hasAny = visibleBucket.length || visibleRemaining.length || visibleLearned.length;
  if (!hasAny) {
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No words match your search.';
    return;
  }

  list.innerHTML =
    (visibleBucket.length    ? section('Active bucket', visibleBucket.length)    + visibleBucket.map(w => renderWord(w, 'word-in-bucket')).join('') : '') +
    (visibleRemaining.length ? section('Queued',        visibleRemaining.length) + visibleRemaining.map(w => renderWord(w, '')).join('') : '') +
    (visibleLearned.length   ? section('Learned',       visibleLearned.length)   + visibleLearned.map(w => renderWord(w, 'word-learned')).join('') : '');

    list.querySelectorAll('.word-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.word-delete')) return;
      const word = manageWords.find(w => w.id === item.dataset.id);
      if (word) openAddPanel(word);
    });
  });

  list.querySelectorAll('.word-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this word?')) return;
      try {
        await api.deleteWord(btn.dataset.id);
        await loadWordList();
      } catch (e) { alert('Failed: ' + e.message); }
    });
  });
}

async function loadWordList() {
  try {
    const data = await api.getWords();
    manageWords = data.words;
    renderWordList();
  } catch (e) {
    document.getElementById('word-list').innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

// === Export / Import ===
document.getElementById('btn-export').addEventListener('click', async () => {
  try {
    const res = await api.call('/api/export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'words.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export failed: ' + e.message); }
});

document.getElementById('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const result = await api.importCsv(text);
    alert(`Imported ${result.added} words (total: ${result.total})`);
    loadWordList();
  } catch (e) { alert('Import failed: ' + e.message); }
  e.target.value = '';
});

// === Browse words ===
let browseWords = [];

async function loadBrowseList() {
  try {
    const data = await api.getWords();
    browseWords = data.words;
    // Reset filter and search each time the browse screen opens
    document.getElementById('browse-filter').value = 'all';
    document.getElementById('browse-search').value = '';
    renderBrowseList();
  } catch (e) {
    document.getElementById('browse-list').innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

function matchesSearch(w, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (w.en || '').toLowerCase().includes(q) || (w.de || '').toLowerCase().includes(q);
}

function renderBrowseList() {
  const filter = document.getElementById('browse-filter').value;
  const query = document.getElementById('browse-search').value.trim();
  const list = document.getElementById('browse-list');
  const empty = document.getElementById('browse-empty');
  const threshold = 7;
  const BUCKET_SIZE = 50;

  // Identify the active bucket: first BUCKET_SIZE unlearned words in CSV order
  const unlearnedInOrder = browseWords.filter(w =>
    parseInt(w.streak_en_de || '0') + parseInt(w.streak_de_en || '0') < threshold
  );
  const bucketIds = new Set(unlearnedInOrder.slice(0, BUCKET_SIZE).map(w => w.id));

  let words = [...browseWords];
  if (filter === 'learning') {
    words = words.filter(w => bucketIds.has(w.id));
  } else if (filter === 'mastered') {
    words = words.filter(w =>
      parseInt(w.streak_en_de || '0') + parseInt(w.streak_de_en || '0') >= threshold
    );
  }
  // Apply search (LIKE %query%)
  words = words.filter(w => matchesSearch(w, query));

  if (words.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = `
    <div class="browse-header">
      <span>English</span>
      <span>Deutsch</span>
      <span title="Progress (EN+DE combined out of 7)">Progress</span>
    </div>
  ` + words.map(w => {
    const s1 = parseInt(w.streak_en_de || '0');
    const s2 = parseInt(w.streak_de_en || '0');
    const combined = s1 + s2;
    const status = combined >= threshold ? '✅' : `${combined}/7`;
    return `
      <div class="browse-row">
        <span class="browse-en">${esc(alts(w.en))}</span>
        <span class="browse-de">${esc(alts(w.de))}</span>
        <span class="browse-streak">${status}</span>
      </div>
    `;
  }).join('');
}

document.getElementById('browse-filter').addEventListener('change', renderBrowseList);
document.getElementById('browse-search').addEventListener('input', renderBrowseList);
document.getElementById('manage-search').addEventListener('input', renderWordList);

// === Helpers ===
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function splitAlts(s) { return String(s || '').split(';').map(x => x.trim()).filter(Boolean); }
function alts(s) { return splitAlts(s).join(' / '); }
function firstAlt(s) { return splitAlts(s)[0] || ''; }
function normalizeDe(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/^(der|die|das|ein|eine|the|a|an)\s+/i, '');
}

// === Paste parser: Claude's answer → { de, en[], notes } ===
// Expected shape (markdown or plain text both work):
//   Aussteigen
//   English Translation: "To get out" / "To exit" / "To alight"
//   …everything after this line becomes notes…
const TRANSLATION_RE = /^(?:english\s+)?(?:translations?|meaning|übersetzung)\s*[:：]\s*(.*)$/i;
const stripMd = (line) => line.replace(/\*\*|__/g, '').replace(/^#{1,6}\s+/, '').trim();

function parseClaudeText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  let de = '';
  if (i < lines.length && !TRANSLATION_RE.test(stripMd(lines[i]))) {
    de = stripMd(lines[i])
      .replace(/^(?:german|deutsch|word|wort)\s*[:：]\s*/i, '')
      .replace(/^["“„](.*)["”“]$/, '$1')
      .trim();
    i++;
  }

  let t = -1;
  for (let j = i; j < Math.min(lines.length, i + 5); j++) {
    if (TRANSLATION_RE.test(stripMd(lines[j]))) { t = j; break; }
  }
  if (t === -1) {
    return { de, en: [], notes: lines.slice(i).join('\n').trim(), error: 'No “English Translation:” line found' };
  }

  let value = stripMd(lines[t]).match(TRANSLATION_RE)[1].trim();
  i = t + 1;
  if (!value) {                       // translation on the following line
    while (i < lines.length && !lines[i].trim()) i++;
    value = stripMd(lines[i] || '');
    i++;
  }
  return { de, en: splitTranslations(value), notes: lines.slice(i).join('\n').trim() };
}

function splitTranslations(value) {
  const quoted = [...value.matchAll(/["“„]([^"“”„]+)["”“]/g)].map(m => m[1]);
  const parts = quoted.length ? quoted : value.split(/\s*[\/;]\s*/);
  return [...new Set(parts.map(s => s.replace(/[*_]/g, '').trim()).filter(Boolean))];
}

// === Notes renderer: plain text / light markdown → safe HTML ===
const SECTION_RE = /^(explanation|meaning|common uses|uses|usage|examples?|example sentences|grammar(?: notes?)?|notes?|synonyms?|antonyms?|related(?: words)?|conjugation|declension|word family|pronunciation|etymology|tips?|collocations|idioms?|false friends?|plural|gender|summary)$/i;
const PUNCT_RE = /[.,!?:;"“”„=→()…–—\-\[\]]/;

function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function isQuotedLine(s) {
  return /^["“„]/.test(s) && /["”“][^"”“]*$/.test(s) && s.length > 2;
}

function renderNotes(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
  const out = [];
  let list = null, table = null;
  const flush = () => {
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (table) {
      const [head, ...body] = table;
      out.push(`<div class="notes-table"><table><thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      table = null;
    }
  };

  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    const next = lines[k + 1] || '';
    if (!raw || /^(-{3,}|\*{3,}|_{3,})$/.test(raw)) { flush(); continue; }

    // Markdown table
    if (raw.startsWith('|')) {
      if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
      if (/^\|?[\s:|-]+\|?$/.test(raw)) continue;      // separator row
      (table ||= []).push(raw.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      continue;
    }

    // Section heading
    const plain = raw.replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+?)\*\*:?$/, '$1').replace(/:$/, '').trim();
    const boldNum = plain.match(/^(\d+)[.)]\s+(.*)$/);
    if (boldNum && plain !== raw) { flush(); out.push(`<h5><span class="num">${boldNum[1]}</span>${inlineMd(boldNum[2])}</h5>`); continue; }
    const looksHeading = /^#{1,6}\s/.test(raw) || /^\*\*[^*]+\*\*:?$/.test(raw) || SECTION_RE.test(plain) ||
      (plain.split(/\s+/).length <= 3 && /^[A-ZÄÖÜ]/.test(plain) && !PUNCT_RE.test(plain) && !isQuotedLine(next));
    if (looksHeading) { flush(); out.push(`<h4>${inlineMd(plain)}</h4>`); continue; }

    // Bullet
    const bullet = raw.match(/^[*\-•]\s+(.*)$/);
    if (bullet) {
      if (table) flush();
      const eq = bullet[1].match(/^(.+?)\s+=\s+(.+)$/);
      (list ||= []).push(`<li>${eq ? `<strong>${inlineMd(eq[1].replace(/\*\*/g, ''))}</strong> = ${inlineMd(eq[2])}` : inlineMd(bullet[1])}</li>`);
      continue;
    }
    flush();

    // Numbered sub-heading: "1. Literal – public transport"
    const num = raw.match(/^(\d+)[.)]\s+(.*)$/);
    if (num) { out.push(`<h5><span class="num">${num[1]}</span>${inlineMd(num[2])}</h5>`); continue; }

    // "Ich steige hier aus. → "I'm getting off here.""
    const arrow = raw.split(/\s+(?:→|->|=>)\s+/);
    if (arrow.length === 2) {
      out.push(`<div class="ex"><div class="ex-de">${inlineMd(arrow[0])}</div><div class="ex-en">${inlineMd(arrow[1])}</div></div>`);
      continue;
    }

    // German example followed by a quoted English translation on the next line
    if (!isQuotedLine(raw) && isQuotedLine(next)) {
      out.push(`<div class="ex"><div class="ex-de">${inlineMd(raw)}</div><div class="ex-en">${inlineMd(next)}</div></div>`);
      k++;
      continue;
    }
    if (isQuotedLine(raw)) { out.push(`<div class="ex"><div class="ex-en">${inlineMd(raw)}</div></div>`); continue; }

    out.push(`<p>${inlineMd(raw)}</p>`);
  }
  flush();
  return out.join('');
}

// === Init ===
if (token) {
  // Validate token by loading stats
  api.getStats().then(() => showScreen('menu')).catch(() => showScreen('login'));
} else {
  showScreen('login');
}

// === Service Worker ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
