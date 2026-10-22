const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   CSV PARSER — simple, no external dependency
   ============================================================ */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

/* ============================================================
   LOAD CSV DATA — single source of truth, no hallucination
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const courses      = parseCSV(path.join(DATA_DIR, 'courses.csv'));
const prerequisites     = parseCSV(path.join(DATA_DIR, 'prerequisites.csv'));
const subclasses   = parseCSV(path.join(DATA_DIR, 'subclass.csv'));
const mutuallyExclusive = parseCSV(path.join(DATA_DIR, 'mutually_exclusive.csv'));

// Major name → course-code prefix mapping (derived from data)
const MAJOR_MAP = {
  'Computer Science': 'CS',
  'Business Administration': 'BBA',
  'Mechanical Engineering': 'ME',
  'Psychology': 'PSY'
};

function getYearLevel(courseCode) {
  const digits = courseCode.replace(/[^\d]/g, '');
  return Math.floor(parseInt(digits) / 100);
}

/* ============================================================
   API: GET /api/majors  — list available majors
   ============================================================ */
app.get('/api/majors', (req, res) => {
  res.json(Object.keys(MAJOR_MAP));
});

/* ============================================================
   API: GET /api/courses?type=m&major=Computer Science&year=2
   ============================================================ */
app.get('/api/courses', (req, res) => {
  const { type, major, year } = req.query;
  let filtered = [...courses];

  if (type)  filtered = filtered.filter(c => c.course_type === type);
  if (major) {
    const prefix = MAJOR_MAP[major];
    if (prefix) filtered = filtered.filter(c => c.course_code.startsWith(prefix));
  }
  if (year) {
    const yr = parseInt(year);
    filtered = filtered.filter(c => getYearLevel(c.course_code) <= yr);
  }

  res.json(filtered);
});

/* ============================================================
   .env LOADER — keep your API key in a local .env file
   (tiny hand-rolled loader, no external dependency)
   ============================================================ */
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

/* ============================================================
   AI CONFIG — natural-language course search
   Enable it by putting your API key in a .env file (copy
   .env.example to .env) or by exporting AI_API_KEY in your shell.
   Works with ANY OpenAI-compatible chat API (OpenAI, DeepSeek,
   Moonshot/Kimi, ...). If no key is set — or an API call fails —
   search automatically falls back to the classic keyword
   matcher, so the app keeps working either way.
   ============================================================ */
const AI_CONFIG = {
  apiKey:  (process.env.AI_API_KEY || '').trim(),
  baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, ''),
  model:   (process.env.AI_MODEL || 'gpt-4o-mini').trim(),
};
AI_CONFIG.enabled = AI_CONFIG.apiKey.length > 0 && AI_CONFIG.apiKey !== 'sk-your-key-here';

const TYPE_LABELS = { m: 'Major requirement', c: 'Common core', e: 'Free elective' };

if (AI_CONFIG.enabled) {
  console.log(`  AI natural-language search ENABLED (model: ${AI_CONFIG.model} via ${AI_CONFIG.baseUrl})`);
} else {
  console.log('  AI natural-language search disabled — keyword search active (set AI_API_KEY in .env to enable AI)');
}

/* ============================================================
   AI SEARCH — ask an LLM which courses match a natural-language
   request. The model may only pick from the course list we send
   it, and every code it returns is validated against the real
   catalog before use (anti-hallucination, same spirit as the
   CSV-only data source).
   ============================================================ */
const AI_SYSTEM_PROMPT = [
  'You are the search engine inside a university course planning app.',
  'A student describes, in natural language, what kind of course they want.',
  'You receive a FIXED list of available courses (code | title | category).',
  'Pick the courses that best match the student\'s intent, most relevant first,',
  'and give each pick a very short reason (max about 10 words).',
  'Rules:',
  '- Only choose course codes that appear in the provided list.',
  '- Never invent, translate, or alter course codes.',
  '- If nothing fits, return an empty matches list.',
  '- Reply with JSON only (no markdown, no extra text), exactly this shape:',
  '{"interpretation":"one short sentence describing what the student wants","matches":[{"course_code":"CC101","reason":"why it fits"}]}',
].join('\n');

function parseAiJson(text) {
  if (!text) return null;
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function aiNaturalLanguageSearch(candidateCourses, query) {
  const catalog = candidateCourses
    .map(c => `- ${c.course_code} | ${c.course_name} | ${TYPE_LABELS[c.course_type] || c.course_type}`)
    .join('\n');

  const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: AI_CONFIG.model,
      temperature: 0.2,
      max_tokens: 512,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: `Student request: "${query}"\n\nAvailable courses:\n${catalog}` },
      ],
    }),
    signal: AbortSignal.timeout(20000), // 20s safety timeout
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI API responded ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  const parsed = parseAiJson(content);
  if (!parsed || !Array.isArray(parsed.matches)) {
    throw new Error('AI returned an unparseable response');
  }

  return {
    interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : '',
    matches: parsed.matches
      .filter(m => m && typeof m.course_code === 'string')
      .slice(0, 10)
      .map(m => ({
        course_code: m.course_code.trim().toUpperCase(),
        reason: typeof m.reason === 'string' ? m.reason : '',
      })),
  };
}

/* ============================================================
   KEYWORD SEARCH — classic fallback (stop-word removal +
   relevance scoring). Used whenever AI is unavailable.
   ============================================================ */
const STOP_WORDS = new Set([
  'i','want','a','an','the','course','courses','related','to','about',
  'for','of','and','or','in','on','with','some','any','me','please',
  'find','show','get','need','looking','interested','like','would',
  'my','this','that','is','are','do','dont','do','not','no','yes',
  'take','taking','enroll','enrolling','register','sign','up','something'
]);

function keywordSearch(candidateCourses, query) {
  const keywords = query.toLowerCase()
    .split(/[\s,]+/)
    .filter(w => !STOP_WORDS.has(w) && w.length > 1);

  if (keywords.length === 0) return candidateCourses;

  const scored = candidateCourses.map(c => {
    const nameLower = c.course_name.toLowerCase();
    let score = 0;
    keywords.forEach(kw => {
      if (nameLower.includes(kw)) score += 2;
      // partial word match
      nameLower.split(' ').forEach(word => {
        if (word.startsWith(kw) || kw.startsWith(word)) score += 1;
      });
    });
    return { ...c, _score: score };
  });

  return scored
    .filter(c => c._score > 0)
    .sort((a, b) => b._score - a._score)
    .map(c => {
      const { _score, ...rest } = c;
      return rest;
    });
}

/* ============================================================
   API: GET /api/search-courses?type=c&query=economic globalization
   AI natural-language search (when AI_API_KEY is configured),
   with automatic keyword-search fallback.
   Response: { searchMode: 'ai'|'keyword', interpretation, results }
   ============================================================ */
app.get('/api/search-courses', async (req, res) => {
  const { type, query } = req.query;
  let filtered = [...courses];

  if (type) filtered = filtered.filter(c => c.course_type === type);

  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) {
    return res.json({
      searchMode: AI_CONFIG.enabled ? 'ai' : 'keyword',
      interpretation: '',
      results: filtered,
    });
  }

  // ---- 1. Try AI natural-language search ----
  if (AI_CONFIG.enabled) {
    try {
      const ai = await aiNaturalLanguageSearch(filtered, trimmedQuery);
      const byCode = new Map(filtered.map(c => [c.course_code, c]));
      const results = [];
      const seen = new Set();
      for (const match of ai.matches) {
        const course = byCode.get(match.course_code);
        if (!course || seen.has(course.course_code)) continue; // drop hallucinated/dup codes
        seen.add(course.course_code);
        results.push({ ...course, _reason: match.reason });
      }
      if (results.length > 0) {
        return res.json({ searchMode: 'ai', interpretation: ai.interpretation, results });
      }
      console.warn('[AI search] no valid course codes returned — falling back to keyword search');
    } catch (err) {
      console.warn(`[AI search failed — using keyword search] ${err.message}`);
    }
  }

  // ---- 2. Fallback: classic keyword search ----
  res.json({
    searchMode: 'keyword',
    interpretation: '',
    results: keywordSearch(filtered, trimmedQuery),
  });
});

/* ============================================================
   API: GET /api/prerequisites?codes=CS201,CS301
   ============================================================ */
app.get('/api/prerequisites', (req, res) => {
  const codes = req.query.codes ? req.query.codes.split(',') : [];
  const result = prerequisites.filter(p => codes.includes(p.course_code));
  res.json(result);
});

/* ============================================================
   API: GET /api/subclasses?codes=CS101,CS201
   ============================================================ */
app.get('/api/subclasses', (req, res) => {
  const codes = req.query.codes ? req.query.codes.split(',') : [];
  const result = subclasses.filter(s => codes.includes(s.course_code));
  res.json(result);
});

/* ============================================================
   API: GET /api/mutually-exclusive?codes=FE106,FE107
   ============================================================ */
app.get('/api/mutually-exclusive', (req, res) => {
  const codes = req.query.codes ? req.query.codes.split(',') : [];
  const result = mutuallyExclusive.filter(m =>
    codes.includes(m.course_code) || codes.includes(m.mutually_exclusive_course_code)
  );
  res.json(result);
});

/* ============================================================
   API: POST /api/generate-schedule
   Body: { courseCodes: [...], preferences: { holidays, minimizeGaps } }
   Uses backtracking to find a conflict-free timetable
   ============================================================ */

function timeToInt(timeStr) {
  return parseInt(timeStr.replace(':', ''));
}

function timesOverlap(s1, s2) {
  if (s1.day_of_week !== s2.day_of_week) return false;
  const s1Start = timeToInt(s1.start_time);
  const s1End   = timeToInt(s1.end_time);
  const s2Start = timeToInt(s2.start_time);
  const s2End   = timeToInt(s2.end_time);
  return s1Start < s2End && s2Start < s1End;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function calculateScore(schedule, prefs) {
  let score = 0;
  const dayMap = {};
  DAYS.forEach(d => { dayMap[d] = []; });
  schedule.forEach(s => { if (dayMap[s.day_of_week]) dayMap[s.day_of_week].push(s); });

  // sort each day by start time
  Object.keys(dayMap).forEach(d => {
    dayMap[d].sort((a, b) => timeToInt(a.start_time) - timeToInt(b.start_time));
  });

  const freeDays = DAYS.filter(d => dayMap[d].length === 0).length;

  // holiday preference
  if (prefs.holidays && prefs.holidays > 0) {
    if (freeDays >= prefs.holidays) {
      score += prefs.holidays * 20;
    } else {
      score += freeDays * 5; // partial credit
    }
  }
  score += freeDays * 3; // always prefer more free days slightly

  // minimize gaps
  if (prefs.minimizeGaps) {
    Object.keys(dayMap).forEach(d => {
      const classes = dayMap[d];
      for (let i = 0; i < classes.length - 1; i++) {
        const gap = timeToInt(classes[i + 1].start_time) - timeToInt(classes[i].end_time);
        if (gap > 30) score -= gap / 30; // penalty per 30-min gap
      }
    });
  }

  return score;
}

app.post('/api/generate-schedule', (req, res) => {
  const { courseCodes, preferences } = req.body;

  if (!courseCodes || courseCodes.length === 0) {
    return res.json({
      success: false,
      error: 'No courses selected. Please shortlist at least one course before generating a schedule.',
      conflictType: 'empty'
    });
  }

  // ---- check mutually exclusive ----
  const conflictPairs = [];
  const seen = new Set();
  for (const pair of mutuallyExclusive) {
    const key = [pair.course_code, pair.mutually_exclusive_course_code].sort().join('|');
    if (seen.has(key)) continue;
    if (courseCodes.includes(pair.course_code) &&
        courseCodes.includes(pair.mutually_exclusive_course_code)) {
      seen.add(key);
      const c1 = courses.find(c => c.course_code === pair.course_code);
      const c2 = courses.find(c => c.course_code === pair.mutually_exclusive_course_code);
      conflictPairs.push({ c1, c2 });
    }
  }

  if (conflictPairs.length > 0) {
    const pairStr = conflictPairs.map(p =>
      `"${p.c1.course_name} (${p.c1.course_code})" and "${p.c2.course_name} (${p.c2.course_code})"`
    ).join('; ');
    return res.json({
      success: false,
      error: `Schedule conflict detected — the following courses are mutually exclusive and cannot be taken in the same term: ${pairStr}. Please remove one from each pair and try again.`,
      conflictType: 'mutually_exclusive',
      conflicts: conflictPairs
    });
  }

  // ---- gather subclasses per course ----
  const courseSubs = courseCodes.map(code => subclasses.filter(s => s.course_code === code));

  // check for courses with no available slots
  const emptyIdx = courseSubs.findIndex(subs => subs.length === 0);
  if (emptyIdx !== -1) {
    const cInfo = courses.find(c => c.course_code === courseCodes[emptyIdx]);
    return res.json({
      success: false,
      error: `No class slots are available for "${cInfo ? cInfo.course_name : courseCodes[emptyIdx]}" (${courseCodes[emptyIdx]}). This course does not exist in the subclass database.`,
      conflictType: 'no_slots'
    });
  }

  // ---- backtracking search ----
  let bestSchedule = null;
  let bestScore = -Infinity;
  let triedCount = 0;
  const MAX_TRIES = 50000; // safety limit

  function backtrack(idx, current) {
    if (triedCount > MAX_TRIES) return;
    triedCount++;

    if (idx === courseSubs.length) {
      const sc = calculateScore(current, preferences || {});
      if (sc > bestScore) {
        bestScore = sc;
        bestSchedule = [...current];
      }
      return;
    }

    for (const sub of courseSubs[idx]) {
      let conflict = false;
      for (const ex of current) {
        if (timesOverlap(sub, ex)) { conflict = true; break; }
      }
      if (!conflict) {
        current.push(sub);
        backtrack(idx + 1, current);
        current.pop();
      }
    }
  }

  backtrack(0, []);

  if (!bestSchedule) {
    // Identify which courses have overlapping times
    const conflictingCourses = [];
    for (let i = 0; i < courseCodes.length; i++) {
      for (let j = i + 1; j < courseCodes.length; j++) {
        const subsA = courseSubs[i];
        const subsB = courseSubs[j];
        let anyNonConflict = false;
        outer: for (const a of subsA) {
          for (const b of subsB) {
            if (!timesOverlap(a, b)) { anyNonConflict = true; break outer; }
          }
        }
        if (!anyNonConflict) {
          const ci = courses.find(c => c.course_code === courseCodes[i]);
          const cj = courses.find(c => c.course_code === courseCodes[j]);
          conflictingCourses.push({ c1: ci, c2: cj });
        }
      }
    }

    let errorMsg = 'Unable to generate a schedule — the selected courses have unavoidable time conflicts.\n\n';
    if (conflictingCourses.length > 0) {
      errorMsg += 'The following course pairs always clash on the same day and time:\n';
      errorMsg += conflictingCourses.map(p =>
        `• "${p.c1.course_name} (${p.c1.course_code})" vs "${p.c2.course_name} (${p.c2.course_code})"`
      ).join('\n');
      errorMsg += '\n\nPlease remove or replace one course from each conflicting pair.';
    }

    return res.json({
      success: false,
      error: errorMsg,
      conflictType: 'time_conflict',
      conflicts: conflictingCourses
    });
  }

  // ---- build result ----
  const scheduleResult = bestSchedule.map(sub => {
    const cInfo = courses.find(c => c.course_code === sub.course_code);
    return {
      ...sub,
      course_name: cInfo ? cInfo.course_name : sub.course_code,
      course_type: cInfo ? cInfo.course_type : ''
    };
  });

  // compute stats for display
  const usedDays = new Set(bestSchedule.map(s => s.day_of_week));
  const freeDays = DAYS.filter(d => !usedDays.has(d));

  res.json({
    success: true,
    schedule: scheduleResult,
    freeDays,
    score: bestScore,
    totalCourses: bestSchedule.length
  });
});

/* ============================================================
   FALLBACK — serve index.html for any non-API route
   ============================================================ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  AILT Course Planner AI`);
  console.log(`  Server running on http://localhost:${PORT}\n`);
});
