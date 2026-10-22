/* ============================================================
   AILT Course Planner AI — Frontend Application Logic
   10-Step State Machine | Anti-Hallucination CSV Data Source
   ============================================================ */

/* ============================================================
   STATE
   ============================================================ */
const state = {
  step: 1,
  academicYear: null,
  major: null,
  shortlistedMajor: [],
  prerequisites: {},          // { prereq_code: { passed: bool } }
  shortlistedCommonCore: [],
  shortlistedFreeElective: [],
  schedulingPreferences: {},
  schedule: null,
  allMajorCourses: [],
};

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const el = {
  messages:        document.getElementById('messages'),
  messagesWrapper: document.getElementById('messages-wrapper'),
  input:           document.getElementById('chat-input'),
  sendBtn:         document.getElementById('send-btn'),
  stepIndicator:   document.getElementById('step-indicator'),
  chatView:        document.getElementById('chat-view'),
  timetableView:   document.getElementById('timetable-view'),
  backBtn:         document.getElementById('back-btn'),
  timetableContent:document.getElementById('timetable-content'),
  timetableStats:  document.getElementById('timetable-stats'),
};

/* ============================================================
   API HELPERS
   ============================================================ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/* ============================================================
   MESSAGE RENDERING
   ============================================================ */
function addBotMessage(html, opts = {}) {
  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (opts.raw) {
    bubble.textContent = html;
  } else {
    bubble.innerHTML = html;
  }
  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
  return bubble;
}

function addUserMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'message user';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

function scrollToBottom() {
  el.messagesWrapper.scrollTop = el.messagesWrapper.scrollHeight;
}

/* ============================================================
   INPUT HELPERS
   ============================================================ */
function setInputEnabled(enabled, placeholder) {
  el.input.disabled = !enabled;
  el.sendBtn.disabled = !enabled;
  if (placeholder) el.input.placeholder = placeholder;
  if (enabled) el.input.focus();
}

function updateStepIndicator() {
  const stepMap = {
    1: 'Step 1 / 9',
    2: 'Step 2 / 9',
    3: 'Step 3 / 9',
    4: 'Step 4 / 9',
    5: 'Step 5 / 9',
    6: 'Step 6 / 9',
    7: 'Step 7 / 9',
    8: 'Step 8 / 9',
    9: 'Step 9 / 9',
    10: 'Modify & Regenerate',
  };
  el.stepIndicator.textContent = stepMap[state.step] || '';
}

/* ============================================================
   COURSE TABLE RENDERER
   ============================================================ */
function createCourseTable(courses, shortlistKey, opts = {}) {
  const container = document.createElement('div');
  container.className = 'course-table-container';

  if (courses.length === 0) {
    container.innerHTML = '<p style="color:var(--muted-olive);font-style:italic;padding:12px;">No matching courses found. Try different keywords or type "skip".</p>';
    return container;
  }

  const table = document.createElement('table');
  table.className = 'course-table';

  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th style="width:40px;"></th>
      <th>Course Name</th>
      <th>Code</th>
      <th>Type</th>
    </tr>
  `;
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  courses.forEach(course => {
    const tr = document.createElement('tr');

    // Heart cell
    const heartCell = document.createElement('td');
    heartCell.style.textAlign = 'center';
    const heartBtn = createHeartButton(course.course_code, shortlistKey);
    heartCell.appendChild(heartBtn);
    tr.appendChild(heartCell);

    // Name (escaped; optional AI match reason rendered underneath)
    const nameCell = document.createElement('td');
    nameCell.innerHTML = escapeHtml(course.course_name) +
      (course._reason ? `<span class="match-reason">↳ ${escapeHtml(course._reason)}</span>` : '');
    tr.appendChild(nameCell);

    // Code
    const codeCell = document.createElement('td');
    codeCell.innerHTML = `<strong style="color:var(--sage-green);">${course.course_code}</strong>`;
    tr.appendChild(codeCell);

    // Type badge
    const typeCell = document.createElement('td');
    const typeMap = { m: { label: 'Major', cls: 'major' }, c: { label: 'Core', cls: 'core' }, e: { label: 'Elective', cls: 'elective' } };
    const t = typeMap[course.course_type] || { label: course.course_type, cls: 'elective' };
    typeCell.innerHTML = `<span class="type-badge ${t.cls}">${t.label}</span>`;
    tr.appendChild(typeCell);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // Confirm button
  const actionRow = document.createElement('div');
  actionRow.className = 'action-row';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'confirm-btn';
  confirmBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    Confirm Choice
  `;
  confirmBtn.onclick = () => opts.onConfirm && opts.onConfirm();
  actionRow.appendChild(confirmBtn);
  container.appendChild(actionRow);

  return container;
}

/* ============================================================
   HEART BUTTON
   ============================================================ */
function createHeartButton(courseCode, shortlistKey) {
  const btn = document.createElement('button');
  btn.className = 'heart-btn';
  btn.innerHTML = `
    <svg class="heart-icon" viewBox="0 0 24 24">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  `;

  // Check if already shortlisted
  if (state[shortlistKey].includes(courseCode)) {
    btn.classList.add('active');
  }

  btn.onclick = () => {
    const idx = state[shortlistKey].indexOf(courseCode);
    if (idx === -1) {
      state[shortlistKey].push(courseCode);
      btn.classList.add('active');
    } else {
      state[shortlistKey].splice(idx, 1);
      btn.classList.remove('active');
    }
  };

  return btn;
}

/* ============================================================
   PREREQUISITE TABLE
   ============================================================ */
function createPrerequisiteTable(prereqs, courseMap) {
  const container = document.createElement('div');
  container.className = 'course-table-container';

  if (prereqs.length === 0) {
    container.innerHTML = '<p style="color:var(--muted-olive);font-style:italic;padding:12px;">None of your shortlisted courses have prerequisites. You are good to go!</p>';

    const actionRow = document.createElement('div');
    actionRow.className = 'action-row';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'confirm-btn';
    confirmBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Confirm Choice
    `;
    confirmBtn.onclick = () => transitionToStep4();
    actionRow.appendChild(confirmBtn);
    container.appendChild(actionRow);
    return container;
  }

  const table = document.createElement('table');
  table.className = 'course-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Course</th>
      <th>Prerequisite</th>
      <th style="text-align:center;">Status</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  // Group prerequisites by course
  const grouped = {};
  prereqs.forEach(p => {
    if (!grouped[p.course_code]) grouped[p.course_code] = [];
    grouped[p.course_code].push(p.prerequisite_code);
  });

  Object.keys(grouped).forEach(courseCode => {
    const courseName = courseMap[courseCode] || courseCode;
    grouped[courseCode].forEach(prereqCode => {
      const tr = document.createElement('tr');

      const courseCell = document.createElement('td');
      courseCell.innerHTML = `<strong>${courseName}</strong><br><span style="font-size:0.75rem;color:var(--muted-olive);">${courseCode}</span>`;
      tr.appendChild(courseCell);

      const prereqCell = document.createElement('td');
      const prereqName = courseMap[prereqCode] || prereqCode;
      prereqCell.innerHTML = `${prereqName}<br><span style="font-size:0.75rem;color:var(--muted-olive);">${prereqCode}</span>`;
      tr.appendChild(prereqCell);

      // Status toggle
      const statusCell = document.createElement('td');
      statusCell.style.textAlign = 'center';

      const toggle = document.createElement('div');
      toggle.className = 'prereq-toggle';

      const passBtn = document.createElement('button');
      passBtn.textContent = 'Passed';
      passBtn.className = 'passed active';

      const failBtn = document.createElement('button');
      failBtn.textContent = 'Failed';

      // Initialize state
      if (!state.prerequisites[prereqCode]) {
        state.prerequisites[prereqCode] = { passed: true };
      }

      passBtn.onclick = () => {
        state.prerequisites[prereqCode].passed = true;
        passBtn.classList.add('active');
        failBtn.classList.remove('active');
      };

      failBtn.onclick = () => {
        state.prerequisites[prereqCode].passed = false;
        failBtn.classList.add('active');
        passBtn.classList.remove('active');
      };

      toggle.appendChild(passBtn);
      toggle.appendChild(failBtn);
      statusCell.appendChild(toggle);
      tr.appendChild(statusCell);

      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);
  container.appendChild(table);

  // Confirm button
  const actionRow = document.createElement('div');
  actionRow.className = 'action-row';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'confirm-btn';
  confirmBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    Confirm Choice
  `;
  confirmBtn.onclick = () => transitionToStep4();
  actionRow.appendChild(confirmBtn);
  container.appendChild(actionRow);

  return container;
}

/* ============================================================
   TIMETABLE RENDERER
   ============================================================ */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const START_HOUR = 8;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = 20; // 8:00 to 18:00

function timeToGridRow(time) {
  const [h, m] = time.split(':').map(Number);
  return Math.floor(((h - START_HOUR) * 60 + m) / SLOT_MINUTES) + 2; // +2: row 1 = header
}

function dayToGridColumn(day) {
  const map = { Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6 };
  return map[day] || 2;
}

function renderTimetable(scheduleData, freeDays, totalCourses) {
  const container = document.createElement('div');

  // Stats
  if (el.timetableStats) {
    el.timetableStats.textContent = `${totalCourses} courses | ${freeDays.length} free day(s): ${freeDays.join(', ') || 'None'}`;
  }

  // Grid
  const grid = document.createElement('div');
  grid.className = 'timetable-grid';
  grid.style.gridTemplateColumns = '90px repeat(5, 1fr)';
  grid.style.gridTemplateRows = `48px repeat(${TOTAL_SLOTS}, 42px)`;

  // Corner cell
  const corner = document.createElement('div');
  corner.className = 'tt-corner';
  grid.appendChild(corner);

  // Day headers
  DAYS.forEach(day => {
  const dh = document.createElement('div');
    dh.className = 'tt-day-header';
    dh.textContent = day.substring(0, 3).toUpperCase();
    grid.appendChild(dh);
  });

  // Time labels + empty cells
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const hour = START_HOUR + Math.floor(i * SLOT_MINUTES / 60);
    const minute = (i * SLOT_MINUTES) % 60;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    // Time label (show only on the hour)
    const tl = document.createElement('div');
    tl.className = 'tt-time-label';
    tl.textContent = minute === 0 ? timeStr : '';
    tl.style.gridColumn = '1';
    tl.style.gridRow = `${i + 2}`;
    grid.appendChild(tl);

    // Empty cells for each day
    DAYS.forEach((day, dayIdx) => {
      const cell = document.createElement('div');
      cell.className = 'tt-cell';
      cell.style.gridColumn = `${dayIdx + 2}`;
      cell.style.gridRow = `${i + 2}`;
      grid.appendChild(cell);
    });
  }

  // Course blocks
  scheduleData.forEach(entry => {
    const block = document.createElement('div');
    const typeClass = entry.course_type === 'm' ? 'major' : entry.course_type === 'c' ? 'core' : 'elective';
    block.className = `tt-course-block ${typeClass}`;

    block.style.gridColumn = `${dayToGridColumn(entry.day_of_week)}`;
    const startRow = timeToGridRow(entry.start_time);
    const endRow = timeToGridRow(entry.end_time);
    block.style.gridRow = `${startRow} / ${endRow}`;

    block.innerHTML = `
      <div class="tt-course-name">${entry.course_name}</div>
      <div class="tt-course-code">${entry.course_code} · ${entry.subclass_id}</div>
      <div class="tt-course-time">${entry.start_time} – ${entry.end_time}</div>
    `;
    grid.appendChild(block);
  });

  container.appendChild(grid);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'timetable-legend';
  legend.innerHTML = `
    <div class="legend-item"><div class="legend-swatch major"></div>Major Requirement</div>
    <div class="legend-item"><div class="legend-swatch core"></div>Common Core</div>
    <div class="legend-item"><div class="legend-swatch elective"></div>Free Elective</div>
  `;
  container.appendChild(legend);

  return container;
}

/* ============================================================
   STEP TRANSITIONS — THE STATE MACHINE
   ============================================================ */

/* --- Step 1: Greeting & Input --- */
function initStep1() {
  state.step = 1;
  updateStepIndicator();
  setInputEnabled(true, 'Type your academic year and major...');

  addBotMessage(
    `<strong>Welcome to AILT Course Planner AI!</strong> 🌱<br><br>` +
    `I'll help you build your term schedule step by step, using only verified course data — no guessing, ever.<br><br>` +
    `To get started, please tell me your <strong>academic year</strong> and <strong>major</strong>.<br><br>` +
    `<em>Available majors: Computer Science, Business Administration, Mechanical Engineering, Psychology</em><br>` +
    `<em>Example: "Year 2, Computer Science"</em>`
  );
}

/* --- Step 2: Major Curriculums --- */
async function transitionToStep2() {
  state.step = 2;
  updateStepIndicator();
  setInputEnabled(false);

  addBotMessage(
    `Here are the <strong>${state.major}</strong> major curriculum courses available to a Year ${state.academicYear} student. ` +
    `Click the <strong>♡ heart</strong> to shortlist courses, then press <strong>Confirm Choice</strong>.`
  );

  try {
    const courses = await apiGet(
      `/api/courses?type=m&major=${encodeURIComponent(state.major)}&year=${state.academicYear}`
    );
    state.allMajorCourses = courses;

    if (courses.length === 0) {
      addBotMessage('No major courses found matching your criteria. Please check your input and try again.');
      setInputEnabled(true, 'Type your academic year and major again...');
      state.step = 1;
      updateStepIndicator();
      return;
    }

    const courseMap = {};
    courses.forEach(c => courseMap[c.course_code] = c.course_name);
    state._majorCourseMap = courseMap;

    const tableContainer = createCourseTable(courses, 'shortlistedMajor', {
      onConfirm: () => {
        if (state.shortlistedMajor.length === 0) {
          addBotMessage('<em>Please select at least one course by clicking the heart icon ♡ before confirming.</em>');
          return;
        }
        transitionToStep3();
      }
    });

    const msg = document.createElement('div');
    msg.className = 'message bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.appendChild(tableContainer);
    msg.appendChild(bubble);
    el.messages.appendChild(msg);
    scrollToBottom();
  } catch (err) {
    addBotMessage('<em>Sorry, I could not fetch course data. Please try again.</em>');
    setInputEnabled(true, 'Type your academic year and major...');
    state.step = 1;
    updateStepIndicator();
  }
}

/* --- Step 3: Prerequisite Check --- */
async function transitionToStep3() {
  state.step = 3;
  updateStepIndicator();
  setInputEnabled(false);

  addBotMessage('Checking prerequisites for your shortlisted courses...');

  try {
    const prereqs = await apiGet(`/api/prerequisites?codes=${state.shortlistedMajor.join(',')}`);
    const tableContainer = createPrerequisiteTable(prereqs, state._majorCourseMap || {});

    const msg = document.createElement('div');
    msg.className = 'message bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.appendChild(tableContainer);
    msg.appendChild(bubble);
    el.messages.appendChild(msg);
    scrollToBottom();
  } catch (err) {
    addBotMessage('<em>Could not fetch prerequisite data. Proceeding to next step.</em>');
    transitionToStep4();
  }
}

/* --- Step 4: Common Core Selection --- */
function transitionToStep4() {
  state.step = 4;
  updateStepIndicator();
  setInputEnabled(true, 'Describe your common core interest (or type "skip")...');

  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML =
    `Now, would you like to take a <strong>common core</strong> course this term?<br><br>` +
    `Describe what you are interested in, in your own words — the AI will understand your request and find close matches.<br><br>` +
    `<em>Example: "I want a common core course related to economic globalization"</em><br>` +
    `<em>Or type "skip" if you don't want a common core this term.</em>`;

  // Quick replies
  const quick = document.createElement('div');
  quick.className = 'quick-replies';
  ['Skip — no common core', 'Economic globalization', 'Environmental sustainability', 'Philosophy and ethics'].forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply';
    btn.textContent = text;
    btn.onclick = () => { el.input.value = text; handleSend(); };
    quick.appendChild(btn);
  });
  bubble.appendChild(quick);

  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

/* --- Step 5: Common Core Shortlisting --- */
async function transitionToStep5(query) {
  state.step = 5;
  updateStepIndicator();
  setInputEnabled(false);

  addBotMessage(`AI is understanding your request and searching the database for the best common core matches...`);

  try {
    const data = await apiGet(`/api/search-courses?type=c&query=${encodeURIComponent(query)}`);
    const results = data.results || [];
    state._commonCoreMap = {};
    results.forEach(c => state._commonCoreMap[c.course_code] = c.course_name);

    if (data.searchMode === 'ai') {
      addBotMessage(
        `🧠 <strong>AI natural-language search</strong>` +
        (data.interpretation ? ` — I understood your request as: <em>"${escapeHtml(data.interpretation)}"</em>` : '') +
        `<br>Here are the closest matches from the course database:`
      );
    } else {
      addBotMessage('🔎 <em>No AI API key configured — showing keyword-search results. Add your key to a <code>.env</code> file to enable natural-language search.</em>');
    }

    if (results.length === 0) {
      addBotMessage(
        '<em>No common core courses found matching your query.</em><br><br>' +
        'Try different keywords, or type "skip" to continue without a common core.'
      );
      state.step = 4;
      updateStepIndicator();
      setInputEnabled(true, 'Describe your common core interest (or type "skip")...');
      return;
    }

    const tableContainer = createCourseTable(results, 'shortlistedCommonCore', {
      onConfirm: () => {
        if (state.shortlistedCommonCore.length === 0) {
          addBotMessage('<em>Please select at least one common core course ♡ before confirming, or go back and type "skip".</em>');
          return;
        }
        transitionToStep6();
      }
    });

    const msg = document.createElement('div');
    msg.className = 'message bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.appendChild(tableContainer);
    msg.appendChild(bubble);
    el.messages.appendChild(msg);
    scrollToBottom();
  } catch (err) {
    addBotMessage('<em>Search failed. Please try again or type "skip".</em>');
    state.step = 4;
    updateStepIndicator();
    setInputEnabled(true, 'Describe your common core interest (or type "skip")...');
  }
}

/* --- Step 6: Free Elective Selection --- */
function transitionToStep6() {
  state.step = 6;
  updateStepIndicator();
  setInputEnabled(true, 'Describe your free elective interest (or type "skip")...');

  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML =
    `Would you like to take a <strong>free elective</strong> this term?<br><br>` +
    `Describe what you're interested in, in your own words — the AI will understand your request and find close matches.<br><br>` +
    `<em>Example: "I want a free elective related to physics"</em><br>` +
    `<em>Or type "skip" to continue without a free elective.</em>`;

  const quick = document.createElement('div');
  quick.className = 'quick-replies';
  ['Skip — no free elective', 'Physics', 'Creative writing', 'Photography', 'Astronomy'].forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply';
    btn.textContent = text;
    btn.onclick = () => { el.input.value = text; handleSend(); };
    quick.appendChild(btn);
  });
  bubble.appendChild(quick);

  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

/* --- Step 7: Free Elective Shortlisting --- */
async function transitionToStep7(query) {
  state.step = 7;
  updateStepIndicator();
  setInputEnabled(false);

  addBotMessage(`AI is understanding your request and searching the database for the best free elective matches...`);

  try {
    const data = await apiGet(`/api/search-courses?type=e&query=${encodeURIComponent(query)}`);
    const results = data.results || [];

    if (data.searchMode === 'ai') {
      addBotMessage(
        `🧠 <strong>AI natural-language search</strong>` +
        (data.interpretation ? ` — I understood your request as: <em>"${escapeHtml(data.interpretation)}"</em>` : '') +
        `<br>Here are the closest matches from the course database:`
      );
    } else {
      addBotMessage('🔎 <em>No AI API key configured — showing keyword-search results. Add your key to a <code>.env</code> file to enable natural-language search.</em>');
    }

    if (results.length === 0) {
      addBotMessage(
        '<em>No free elective courses found matching your query.</em><br><br>' +
        'Try different keywords, or type "skip" to continue without a free elective.'
      );
      state.step = 6;
      updateStepIndicator();
      setInputEnabled(true, 'Describe your free elective interest (or type "skip")...');
      return;
    }

    const tableContainer = createCourseTable(results, 'shortlistedFreeElective', {
      onConfirm: () => {
        if (state.shortlistedFreeElective.length === 0) {
          addBotMessage('<em>Please select at least one free elective course ♡ before confirming, or go back and type "skip".</em>');
          return;
        }
        transitionToStep8();
      }
    });

    const msg = document.createElement('div');
    msg.className = 'message bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.appendChild(tableContainer);
    msg.appendChild(bubble);
    el.messages.appendChild(msg);
    scrollToBottom();
  } catch (err) {
    addBotMessage('<em>Search failed. Please try again or type "skip".</em>');
    state.step = 6;
    updateStepIndicator();
    setInputEnabled(true, 'Describe your free elective interest (or type "skip")...');
  }
}

/* --- Step 8: Scheduling Preferences --- */
function transitionToStep8() {
  state.step = 8;
  updateStepIndicator();
  setInputEnabled(true, 'Type your scheduling preferences...');

  const allCourses = getAllShortlisted();
  const summary = allCourses.map(code => {
    const c = [...state.allMajorCourses].find(x => x.course_code === code) ||
              Object.entries(state._commonCoreMap || {}).find(([k]) => k === code)?.[1] ||
              code;
    return typeof c === 'string' ? c : c.course_name || code;
  });

  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML =
    `<strong>Course Summary</strong> — You have shortlisted ${allCourses.length} course(s).<br><br>` +
    `Now, do you have any <strong>scheduling preferences</strong>?<br><br>` +
    `<em>Examples:</em><br>` +
    `• "I want 1 day of holiday"<br>` +
    `• "Minimize gaps between classes"<br>` +
    `• "I want 2 free days and minimize gaps"<br>` +
    `• Type "none" for no specific preferences`;

  const quick = document.createElement('div');
  quick.className = 'quick-replies';
  ['1 day of holiday', '2 days of holiday', 'Minimize gaps', '1 day off + minimize gaps', 'No preference'].forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply';
    btn.textContent = text;
    btn.onclick = () => { el.input.value = text; handleSend(); };
    quick.appendChild(btn);
  });
  bubble.appendChild(quick);

  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

/* --- Step 9: Schedule Generation --- */
function transitionToStep9() {
  state.step = 9;
  updateStepIndicator();
  setInputEnabled(false);

  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = 'Everything looks ready! Click below to generate your weekly timetable.';

  const genBtn = document.createElement('button');
  genBtn.className = 'generate-btn';
  genBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
    Generate Schedule
  `;
  genBtn.onclick = () => generateSchedule();
  bubble.appendChild(genBtn);

  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

/* --- Generate Schedule (calls API) --- */
async function generateSchedule() {
  // Show loading
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'message bot';
  const loadingBubble = document.createElement('div');
  loadingBubble.className = 'message-bubble';
  loadingBubble.innerHTML = `
    <div class="loading-container">
      <div class="spinner"></div>
      <div class="loading-text">Generating your optimal schedule...</div>
    </div>
  `;
  loadingMsg.appendChild(loadingBubble);
  el.messages.appendChild(loadingMsg);
  scrollToBottom();

  const allCourses = getAllShortlisted();

  try {
    const result = await apiPost('/api/generate-schedule', {
      courseCodes: allCourses,
      preferences: state.schedulingPreferences
    });

    // Remove loading
    loadingMsg.remove();

    if (!result.success) {
      // Show error
      const errMsg = document.createElement('div');
      errMsg.className = 'message bot';
      const errBubble = document.createElement('div');
      errBubble.className = 'message-bubble';
      errBubble.innerHTML = `
        <div class="error-box">
          <div class="error-box-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            Schedule Conflict Detected
          </div>
          ${result.error}
        </div>
        <div style="margin-top:12px;">Please modify your course selection and try again.</div>
      `;
      errBubble.appendChild(errBubble);
      errMsg.appendChild(errBubble);
      el.messages.appendChild(errMsg);
      scrollToBottom();

      // Offer modification options
      transitionToStep10();
      return;
    }

    // Success — render timetable
    state.schedule = result;

    const successMsg = document.createElement('div');
    successMsg.className = 'message bot';
    const successBubble = document.createElement('div');
    successBubble.className = 'message-bubble';
    successBubble.innerHTML = `<strong>Success!</strong> 🎉 Your schedule has been generated with ${result.totalCourses} courses and ${result.freeDays.length} free day(s). Opening the timetable view...`;
    successMsg.appendChild(successBubble);
    el.messages.appendChild(successMsg);
    scrollToBottom();

    // Show timetable view after a short delay
    setTimeout(() => {
      const timetableEl = renderTimetable(result.schedule, result.freeDays, result.totalCourses);
      el.timetableContent.innerHTML = '';
      el.timetableContent.appendChild(timetableEl);
      el.chatView.classList.add('hidden');
      el.timetableView.classList.remove('hidden');
    }, 600);

    // Transition to step 10 (iterative modification)
    state.step = 10;
    updateStepIndicator();
    setInputEnabled(true, 'Type "modify" to change your selections, or "regenerate" to try again...');

  } catch (err) {
    loadingMsg.remove();
    addBotMessage('<em>Something went wrong while generating the schedule. Please try again.</em>');
    setInputEnabled(true, 'Type to continue...');
  }
}

/* --- Step 10: Iterative Modification --- */
function transitionToStep10() {
  state.step = 10;
  updateStepIndicator();
  setInputEnabled(true, 'Type "modify" to change selections, or "regenerate" to try again...');

  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = 'You can modify your selections at any time. What would you like to change?';

  const quick = document.createElement('div');
  quick.className = 'quick-replies';
  const options = [
    { label: 'Modify Major Courses', action: () => redoStep2() },
    { label: 'Change Common Core', action: () => redoStep4() },
    { label: 'Change Free Elective', action: () => redoStep6() },
    { label: 'Change Preferences', action: () => redoStep8() },
    { label: 'Regenerate Schedule', action: () => { state.step = 9; updateStepIndicator(); generateSchedule(); } },
  ];
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply';
    btn.textContent = opt.label;
    btn.onclick = opt.action;
    quick.appendChild(btn);
  });
  bubble.appendChild(quick);

  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

/* --- Redo functions for iterative modification --- */
function redoStep2() {
  state.step = 2;
  updateStepIndicator();
  setInputEnabled(false);
  addBotMessage(`Let's modify your <strong>major courses</strong>. Here is the full list again — your current selections are highlighted:`);

  const tableContainer = createCourseTable(state.allMajorCourses, 'shortlistedMajor', {
    onConfirm: () => {
      if (state.shortlistedMajor.length === 0) {
        addBotMessage('<em>Please select at least one course ♡ before confirming.</em>');
        return;
      }
      addBotMessage('Major courses updated! You can now regenerate your schedule or make other changes.');
      transitionToStep10();
    }
  });

  const msg = document.createElement('div');
  msg.className = 'message bot';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(tableContainer);
  msg.appendChild(bubble);
  el.messages.appendChild(msg);
  scrollToBottom();
}

function redoStep4() {
  state.shortlistedCommonCore = [];
  transitionToStep4();
}

function redoStep6() {
  state.shortlistedFreeElective = [];
  transitionToStep6();
}

function redoStep8() {
  state.schedulingPreferences = {};
  transitionToStep8();
}

/* ============================================================
   INPUT PARSING
   ============================================================ */
function getAllShortlisted() {
  return [...state.shortlistedMajor, ...state.shortlistedCommonCore, ...state.shortlistedFreeElective];
}

function isSkipRequest(text) {
  const lower = text.toLowerCase().trim();
  return /^(skip|none|no|not|dont want|don't want|not interested|nothing|n\/a|na|skip — no common core|skip — no free elective|no preference)$/i.test(lower) ||
         /\b(skip|dont want|don't want|not interested|no preference|nothing)\b/i.test(lower);
}

function parseYearAndMajor(text) {
  // Parse year
  let year = null;
  const yearMatch1 = text.match(/year\s*(\d)/i);
  const yearMatch2 = text.match(/(\d)(?:st|nd|rd|th)\s*year/i);
  const yearMatch3 = text.match(/\b(\d)\b/);
  if (yearMatch1) year = parseInt(yearMatch1[1]);
  else if (yearMatch2) year = parseInt(yearMatch2[1]);
  else if (yearMatch3) year = parseInt(yearMatch3[1]);

  // Parse major
  const knownMajors = ['Computer Science', 'Business Administration', 'Mechanical Engineering', 'Psychology'];
  let major = null;
  const lower = text.toLowerCase();
  for (const m of knownMajors) {
    if (lower.includes(m.toLowerCase())) { major = m; break; }
  }
  // Allow partial matches
  if (!major) {
    if (lower.includes('computer') || lower.includes('cs')) major = 'Computer Science';
    else if (lower.includes('business') || lower.includes('bba')) major = 'Business Administration';
    else if (lower.includes('mechanical') || lower.includes('me ')) major = 'Mechanical Engineering';
    else if (lower.includes('psych')) major = 'Psychology';
  }

  return { year, major };
}

function parsePreferences(text) {
  const prefs = {};
  const lower = text.toLowerCase();

  // Check for "no preference"
  if (/^no\s*(preference|specific)?\s*$/i.test(lower.trim()) || lower.trim() === 'none') {
    return prefs;
  }

  // Parse holiday/free day preference
  const holidayMatch = lower.match(/(\d+)\s*(?:day|days)\s*(?:of\s*)?(?:holiday|free|off|holiday)/i);
  if (holidayMatch) {
    prefs.holidays = parseInt(holidayMatch[1]);
  } else if (/holiday|free day|day off/i.test(lower) && /one|1|a\b/i.test(lower)) {
    prefs.holidays = 1;
  }

  // Parse minimize gaps
  if (/minimi[sz]e?\s*gaps?|no\s*gaps?|reduce\s*gaps?|less\s*gaps?/i.test(lower)) {
    prefs.minimizeGaps = true;
  }

  // If nothing parsed, default to minimizeGaps
  if (Object.keys(prefs).length === 0 && !/no preference|none/i.test(lower)) {
    prefs.minimizeGaps = true;
  }

  return prefs;
}

/* ============================================================
   MAIN INPUT HANDLER
   ============================================================ */
async function handleSend() {
  const text = el.input.value.trim();
  if (!text) return;
  el.input.value = '';

  addUserMessage(text);

  switch (state.step) {
    case 1:
      await handleStep1(text);
      break;
    case 4:
      await handleStep4(text);
      break;
    case 6:
      await handleStep6(text);
      break;
    case 8:
      await handleStep8(text);
      break;
    case 10:
      handleStep10(text);
      break;
    default:
      addBotMessage('<em>Please use the buttons above to continue.</em>');
      break;
  }
}

/* --- Step 1 handler --- */
async function handleStep1(text) {
  const { year, major } = parseYearAndMajor(text);

  if (year && major) {
    state.academicYear = year;
    state.major = major;
    addBotMessage(`Got it — <strong>Year ${year}, ${major}</strong>. Let me fetch the curriculum for you. 📚`);
    await transitionToStep2();
  } else {
    let msg = 'I could not quite catch that. ';
    if (!year && !major) msg += 'Please provide both your academic year and major.';
    else if (!year) msg += 'Which academic year are you in? (e.g., Year 1, 2, 3, or 4)';
    else if (!major) msg += 'Which major? Available: Computer Science, Business Administration, Mechanical Engineering, Psychology';
    addBotMessage(`<em>${msg}</em><br><br><em>Example: "Year 2, Computer Science"</em>`);
  }
}

/* --- Step 4 handler --- */
async function handleStep4(text) {
  if (isSkipRequest(text)) {
    addBotMessage('No problem — skipping common core selection. Moving on to free electives.');
    transitionToStep6();
  } else {
    await transitionToStep5(text);
  }
}

/* --- Step 6 handler --- */
async function handleStep6(text) {
  if (isSkipRequest(text)) {
    addBotMessage('No problem — skipping free elective selection. Moving on to scheduling preferences.');
    transitionToStep8();
  } else {
    await transitionToStep7(text);
  }
}

/* --- Step 8 handler --- */
function handleStep8(text) {
  const prefs = parsePreferences(text);
  state.schedulingPreferences = prefs;

  let prefSummary = 'Preferences: ';
  if (prefs.holidays) prefSummary += `${prefs.holidays} day(s) of holiday`;
  if (prefs.holidays && prefs.minimizeGaps) prefSummary += ', ';
  if (prefs.minimizeGaps) prefSummary += 'minimize gaps between classes';
  if (!prefs.holidays && !prefs.minimizeGaps) prefSummary += 'no specific constraints';

  addBotMessage(prefSummary + '.');
  transitionToStep9();
}

/* --- Step 10 handler --- */
function handleStep10(text) {
  const lower = text.toLowerCase();

  if (/major|step\s*2|step\s*3/.test(lower)) {
    redoStep2();
  } else if (/common\s*core|step\s*[45]/.test(lower)) {
    redoStep4();
  } else if (/free\s*elective|step\s*[67]/.test(lower)) {
    redoStep6();
  } else if (/prefer|schedule\s*pref|step\s*8/.test(lower)) {
    redoStep8();
  } else if (/regen|generat|try\s*again|redo/.test(lower)) {
    state.step = 9;
    updateStepIndicator();
    generateSchedule();
  } else {
    transitionToStep10();
  }
}

/* ============================================================
   EVENT LISTENERS & INIT
   ============================================================ */
el.sendBtn.addEventListener('click', handleSend);
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !el.input.disabled) handleSend();
});

el.backBtn.addEventListener('click', () => {
  el.timetableView.classList.add('hidden');
  el.chatView.classList.remove('hidden');
  el.input.focus();
  scrollToBottom();
});

// Start the app
initStep1();
