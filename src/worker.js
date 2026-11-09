const CSV_KEY = 'words.csv';
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// --- CSV helpers ---
// Column order used when writing. Unknown extra columns are kept at the end.
const COLUMNS = ['id', 'en', 'de', 'streak_en_de', 'streak_de_en', 'attempts_en_de', 'attempts_de_en', 'last_seen', 'notes'];

// RFC 4180 parser: handles quoted fields with commas, "" escapes and line breaks (needed for notes).
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }

  const nonEmpty = rows.filter(r => r.some(v => v.trim() !== ''));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(vals => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = (vals[i] || '').replace(/\r\n?/g, '\n').trim();
    });
    return obj;
  });
}

function toCsv(rows) {
  if (rows.length === 0) return COLUMNS.join(',') + '\n';
  const extra = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!COLUMNS.includes(k)) extra.add(k);
  const headers = [...COLUMNS, ...extra];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = String(row[h] ?? '');
      return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

// --- Auth helpers ---
async function makeToken(password, env) {
  const exp = Date.now() + TOKEN_TTL;
  const data = `${password}:${exp}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.AUTH_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${exp}.${hex}`;
}

async function verifyToken(token, env) {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = parseInt(expStr);
  if (Date.now() > exp) return false;
  const data = `${env.AUTH_PASSWORD}:${exp}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.AUTH_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const expectedHex = [...new Uint8Array(expected)].map(b => b.toString(16).padStart(2, '0')).join('');
  return sig === expectedHex;
}

function getToken(request) {
  return request.headers.get('Authorization')?.replace('Bearer ', '') || null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// --- Word loading ---
async function loadWords(env) {
  const obj = await env.VOCAB_BUCKET.get(CSV_KEY);
  if (!obj) return [];
  const text = await obj.text();
  return parseCsv(text);
}

async function saveWords(env, words) {
  await env.VOCAB_BUCKET.put(CSV_KEY, toCsv(words));
}

// --- Normalize answer for comparison ---
function normalize(s) {
  return s.trim().toLowerCase()
    .replace(/\s+/g, ' ')
    // normalize German umlauts: accept both forms
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    // strip articles for comparison
    .replace(/^(der|die|das|ein|eine|the|a|an)\s+/i, '');
}

function checkAnswer(input, accepted) {
  // accepted can be semicolon-separated
  const normInput = normalize(input);
  if (normInput.length < 3) return false; // too short to match partially
  const options = accepted.split(';').map(s => normalize(s));
  return options.some(opt => opt === normInput || opt.includes(normInput) || normInput.includes(opt));
}

function cleanField(s) {
  return String(s || '').split(';').map(x => x.trim()).filter(Boolean).join(';');
}

function cleanNotes(s) {
  return String(s || '').replace(/\r\n?/g, '\n').trim();
}

// --- API routes ---
async function handleApi(request, env, path) {
  // Login
  if (path === '/api/login' && request.method === 'POST') {
    const { password } = await request.json();
    if (password !== env.AUTH_PASSWORD) {
      return json({ error: 'Wrong password' }, 401);
    }
    const token = await makeToken(password, env);
    return json({ token });
  }

  // Everything else needs auth
  const token = getToken(request);
  if (!await verifyToken(token, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Get words
  if (path === '/api/words' && request.method === 'GET') {
    const words = await loadWords(env);
    return json({ words });
  }

  // Get quiz session
  if (path === '/api/quiz' && request.method === 'GET') {
    const url = new URL(request.url);
    const direction = url.searchParams.get('direction') || 'en_de'; // en_de, de_en, mixed
    const limit = parseInt(url.searchParams.get('limit') || env.WORDS_PER_SESSION);
    const bucketSize = parseInt(env.BUCKET_SIZE || '50');
    const correctToLearn = parseInt(env.CORRECT_TO_LEARN);
    const words = await loadWords(env);

    // A word is learned when combined correct answers across both directions
    // reaches the threshold (e.g. 7 total — direction doesn't matter).
    const isLearned = (w) =>
      parseInt(w.streak_en_de || '0') + parseInt(w.streak_de_en || '0') >= correctToLearn;

    // Unlearned words in stable order (by position in CSV) — the full remaining pool
    const unlearned = words.filter(w => !isLearned(w));

    // Active bucket: the first BUCKET_SIZE unlearned words (stable, deterministic).
    // When a word is learned it naturally falls out and the next unlearned word
    // slides into the bucket on the next quiz request.
    const bucket = unlearned.slice(0, bucketSize);

    // Build quiz candidates from the active bucket
    let pool = [];
    if (direction === 'mixed') {
      for (const w of bucket) {
        pool.push({ ...w, quiz_direction: 'en_de' });
        pool.push({ ...w, quiz_direction: 'de_en' });
      }
    } else {
      pool = bucket.map(w => ({ ...w, quiz_direction: direction }));
    }

    // Shuffle randomly — each lesson is a fresh random sample from the bucket
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const session = pool.slice(0, limit);
    return json({ words: session, total_remaining: unlearned.length });
  }

  // Submit answer
  if (path === '/api/answer' && request.method === 'POST') {
    const { id, direction, answer } = await request.json();
    const words = await loadWords(env);
    const idx = words.findIndex(w => w.id === String(id));
    if (idx === -1) return json({ error: 'Word not found' }, 404);

    const word = words[idx];
    const acceptedKey = direction === 'en_de' ? 'de' : 'en';
    const correct = checkAnswer(answer, word[acceptedKey]);

    const streakKey = `streak_${direction}`;
    const attemptsKey = `attempts_${direction}`;

    if (correct) {
      word[streakKey] = String(parseInt(word[streakKey] || '0') + 1);
    } else {
      word[streakKey] = '0';
    }
    word[attemptsKey] = String(parseInt(word[attemptsKey] || '0') + 1);
    word.last_seen = new Date().toISOString();

    words[idx] = word;
    await saveWords(env, words);

    // A word is learned when combined correct answers across both directions
    // reaches the threshold (e.g. 7 total — direction doesn't matter).
    const totalCorrect = parseInt(word.streak_en_de || '0') + parseInt(word.streak_de_en || '0');
    const learned = totalCorrect >= parseInt(env.CORRECT_TO_LEARN);

    return json({
      correct,
      expected: word[acceptedKey],
      notes: word.notes || '',
      streak: parseInt(word[streakKey]),
      total_correct: totalCorrect,
      learned
    });
  }

  // Stats
  if (path === '/api/stats' && request.method === 'GET') {
    const words = await loadWords(env);
    const threshold = parseInt(env.CORRECT_TO_LEARN);
    const bucketSize = parseInt(env.BUCKET_SIZE || '50');
    const total = words.length;
    let total_attempts = 0;

    // learned = combined streak across both directions >= threshold
    const learnedWords = words.filter(w =>
      parseInt(w.streak_en_de || '0') + parseInt(w.streak_de_en || '0') >= threshold
    );
    const unlearnedCount = total - learnedWords.length;

    for (const w of words) {
      total_attempts += parseInt(w.attempts_en_de || '0') + parseInt(w.attempts_de_en || '0');
    }

    return json({
      total_words: total,
      learned: learnedWords.length,
      unlearned: unlearnedCount,
      active_bucket: Math.min(unlearnedCount, bucketSize),
      total_attempts,
      threshold
    });
  }

  // Add word — or update it if the same German word already exists (progress is kept)
  if (path === '/api/words' && request.method === 'POST') {
    const body = await request.json();
    const en = cleanField(body.en), de = cleanField(body.de), notes = cleanNotes(body.notes);
    if (!en || !de) return json({ error: 'en and de required' }, 400);
    const words = await loadWords(env);
    const key = normalize(de.split(';')[0]);
    const existing = words.find(w => normalize((w.de || '').split(';')[0]) === key);
    if (existing) {
      existing.en = en;
      existing.de = de;
      existing.notes = notes;
      await saveWords(env, words);
      return json({ word: existing, updated: true });
    }
    const maxId = words.reduce((m, w) => Math.max(m, parseInt(w.id || '0')), 0);
    const newWord = {
      id: String(maxId + 1),
      en,
      de,
      streak_en_de: '0',
      streak_de_en: '0',
      attempts_en_de: '0',
      attempts_de_en: '0',
      last_seen: '',
      notes
    };
    words.push(newWord);
    await saveWords(env, words);
    return json({ word: newWord, updated: false }, 201);
  }

  // Edit word
  if (path.startsWith('/api/words/') && request.method === 'PUT') {
    const id = path.split('/').pop();
    const body = await request.json();
    const words = await loadWords(env);
    const word = words.find(w => w.id === id);
    if (!word) return json({ error: 'Not found' }, 404);
    if (body.en !== undefined) word.en = cleanField(body.en);
    if (body.de !== undefined) word.de = cleanField(body.de);
    if (body.notes !== undefined) word.notes = cleanNotes(body.notes);
    if (!word.en || !word.de) return json({ error: 'en and de required' }, 400);
    await saveWords(env, words);
    return json({ word, updated: true });
  }

  // Delete word
  if (path.startsWith('/api/words/') && request.method === 'DELETE') {
    const id = path.split('/').pop();
    const words = await loadWords(env);
    const filtered = words.filter(w => w.id !== id);
    if (filtered.length === words.length) return json({ error: 'Not found' }, 404);
    await saveWords(env, filtered);
    return json({ ok: true });
  }

  // Reset progress
  if (path === '/api/reset' && request.method === 'POST') {
    const words = await loadWords(env);
    for (const w of words) {
      w.streak_en_de = '0';
      w.streak_de_en = '0';
      w.attempts_en_de = '0';
      w.attempts_de_en = '0';
      w.last_seen = '';
    }
    await saveWords(env, words);
    return json({ ok: true });
  }

  // Export CSV
  if (path === '/api/export' && request.method === 'GET') {
    const obj = await env.VOCAB_BUCKET.get(CSV_KEY);
    if (!obj) return new Response('', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="words.csv"'
      }
    });
  }

  // Import CSV
  if (path === '/api/import' && request.method === 'POST') {
    const text = await request.text();
    const newWords = parseCsv(text);
    if (newWords.length === 0) return json({ error: 'No valid rows' }, 400);
    const existing = await loadWords(env);
    const maxId = existing.reduce((m, w) => Math.max(m, parseInt(w.id || '0')), 0);
    let nextId = maxId + 1;
    for (const w of newWords) {
      if (!w.id) w.id = String(nextId++);
      if (!w.streak_en_de) w.streak_en_de = '0';
      if (!w.streak_de_en) w.streak_de_en = '0';
      if (!w.attempts_en_de) w.attempts_en_de = '0';
      if (!w.attempts_de_en) w.attempts_de_en = '0';
      if (!w.last_seen) w.last_seen = '';
      if (!w.notes) w.notes = '';
      existing.push(w);
    }
    await saveWords(env, existing);
    return json({ added: newWords.length, total: existing.length });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url.pathname);
    }
    // Static assets are served automatically by the [assets] binding
    return env.ASSETS.fetch(request);
  }
};
