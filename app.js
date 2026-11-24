// Kürsü v2 — Yavuz Hoca Saha Defteri

const KEYS = {
  NOTES: 'kursu_v2_notes',
  CLASSES: 'kursu_v2_classes',
  SCHEDULE: 'kursu_v2_schedule',
  NOTIFIED: 'kursu_v2_notified'
};

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];

let state = {
  notes: JSON.parse(localStorage.getItem(KEYS.NOTES) || '[]'),
  classes: JSON.parse(localStorage.getItem(KEYS.CLASSES) || '[]'),
  schedule: JSON.parse(localStorage.getItem(KEYS.SCHEDULE) || '{"0":[],"1":[],"2":[],"3":[],"4":[]}'),
  notifiedMap: JSON.parse(localStorage.getItem(KEYS.NOTIFIED) || '{}'),
  activeClass: 'ALL',
  detectedClass: '',
  search: '',
  selectedDay: Math.min(Math.max(new Date().getDay() - 1, 0), 4),
  installPrompt: null,
  timerSec: 300,
  timerId: null,
  timerOn: false
};

// Elements
const installBar = document.getElementById('installHeroBar');
const installBtn = document.getElementById('installBtn');
const notifPermBtn = document.getElementById('notifPermBtn');
const micPermBtn = document.getElementById('micPermBtn');
const classRail = document.getElementById('classRail');
const composerClassSelect = document.getElementById('composerClassSelect');
const detectedBar = document.getElementById('detectedClassBar');
const detectedLabel = document.getElementById('detectedClassLabel');
const noteInput = document.getElementById('noteInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const searchInput = document.getElementById('searchInput');
const notesList = document.getElementById('notesList');
const toastEl = document.getElementById('toastEl');

function persist() {
  localStorage.setItem(KEYS.NOTES, JSON.stringify(state.notes));
  localStorage.setItem(KEYS.CLASSES, JSON.stringify(state.classes));
  localStorage.setItem(KEYS.SCHEDULE, JSON.stringify(state.schedule));
  localStorage.setItem(KEYS.NOTIFIED, JSON.stringify(state.notifiedMap));
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2300);
}

// Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Direct Install Button (triggers native install prompt directly without modal/command)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  installBar.style.display = 'flex';
});

installBtn.addEventListener('click', async () => {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    const result = await state.installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      installBar.style.display = 'none';
      toast('Uygulama yüklendi');
    }
    state.installPrompt = null;
  } else {
    toast('Tarayıcı menüsünden "Ana ekrana ekle" ile kurun');
  }
});

window.addEventListener('appinstalled', () => {
  installBar.style.display = 'none';
});

// Direct Permission Requests (Notification & Microphone)
function refreshPermissionBadges() {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      notifPermBtn.classList.add('granted');
      notifPermBtn.textContent = 'Bildirim Açık';
    } else {
      notifPermBtn.classList.remove('granted');
      notifPermBtn.textContent = 'Bildirim İzni';
    }
  }
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'microphone' }).then(res => {
      if (res.state === 'granted') {
        micPermBtn.classList.add('granted');
        micPermBtn.textContent = 'Mikrofon Açık';
      } else {
        micPermBtn.classList.remove('granted');
        micPermBtn.textContent = 'Mikrofon İzni';
      }
    }).catch(() => {});
  }
}

async function requestNotificationPermission(silentToast = false) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const res = await Notification.requestPermission();
    refreshPermissionBadges();
    if (!silentToast) {
      toast(res === 'granted' ? 'Ders bildirimleri aktif' : 'Bildirim izni verilmedi');
    }
  } else {
    refreshPermissionBadges();
  }
}

async function requestMicrophonePermission(silentToast = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    refreshPermissionBadges();
    if (!silentToast) toast('Mikrofon izni verildi');
  } catch {
    refreshPermissionBadges();
    if (!silentToast) toast('Mikrofon izni reddedildi');
  }
}

notifPermBtn.addEventListener('click', () => requestNotificationPermission(false));
micPermBtn.addEventListener('click', () => requestMicrophonePermission(false));

// Request both permissions smoothly on first user interaction
let initialPermsRequested = false;
function triggerInitialPermissionsOnce() {
  if (initialPermsRequested) return;
  initialPermsRequested = true;
  requestNotificationPermission(true);
  requestMicrophonePermission(true);
}
window.addEventListener('pointerdown', triggerInitialPermissionsOnce, { once: true });

// Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${tab}`).classList.add('active');
    document.getElementById('inputBar').style.display = tab === 'notes' ? 'flex' : 'none';
    if (tab !== 'notes') detectedBar.classList.remove('visible');
  });
});

// Smart Class Tag Detection (e.g., "8a", "8-a", "8 A", "7c", "10b")
function normalizeClassName(raw) {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})[-]?([A-ZÇĞİÖŞÜ])$/);
  if (match) return `${match[1]}-${match[2]}`;
  return raw.trim().toUpperCase();
}

function detectClassFromText(text) {
  // First check user-defined classes
  for (const cls of state.classes) {
    const plain = cls.replace('-', '');
    const r1 = new RegExp(`(^|\s)${cls.replace('-', '[-\s]?')}(\s|$|[.,!?])`, 'i');
    const r2 = new RegExp(`(^|\s)${plain}(\s|$|[.,!?])`, 'i');
    if (r1.test(text) || r2.test(text)) return cls;
  }
  // General pattern like "8a", "8-a", "8 A", "7b"
  const genMatch = text.match(/(?:^|\s)(\d{1,2})\s*-?\s*([a-zA-ZçğıöşüÇĞİÖŞÜ])(?=\s|$|[.,!?])/);
  if (genMatch) {
    return `${genMatch[1]}-${genMatch[2].toUpperCase()}`;
  }
  return '';
}

function updateDetectedClassPreview() {
  const detected = detectClassFromText(noteInput.value);
  state.detectedClass = detected;
  if (detected && !composerClassSelect.value) {
    detectedLabel.textContent = `Algılanan Sınıf Etiketi: ${detected}`;
    detectedBar.classList.add('visible');
  } else {
    detectedBar.classList.remove('visible');
  }
}

document.getElementById('clearDetectedBtn').addEventListener('click', () => {
  state.detectedClass = '';
  detectedBar.classList.remove('visible');
});

noteInput.addEventListener('input', () => {
  noteInput.style.height = 'auto';
  noteInput.style.height = Math.min(noteInput.scrollHeight, 84) + 'px';
  updateDetectedClassPreview();
});

// Classes UI
function renderClasses() {
  let html = `<button class="class-pill ${state.activeClass === 'ALL' ? 'active' : ''}" data-cls="ALL">Tümü</button>`;
  state.classes.forEach(cls => {
    html += `<button class="class-pill ${state.activeClass === cls ? 'active' : ''}" data-cls="${esc(cls)}">${esc(cls)}</button>`;
  });
  html += `<button class="class-pill class-pill-plus" id="openClassModalBtn">+ Sınıf Ekle</button>`;
  classRail.innerHTML = html;

  classRail.querySelectorAll('.class-pill[data-cls]').forEach(pill => {
    pill.addEventListener('click', () => {
      state.activeClass = pill.dataset.cls;
      composerClassSelect.value = state.activeClass !== 'ALL' ? state.activeClass : '';
      renderClasses();
      renderNotes();
    });
  });

  document.getElementById('openClassModalBtn').addEventListener('click', () => {
    renderClassModalList();
    openModal('classModal');
  });

  const prev = composerClassSelect.value;
  composerClassSelect.innerHTML = `<option value="">Oto</option>` +
    state.classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (state.classes.includes(prev)) {
    composerClassSelect.value = prev;
  } else if (state.activeClass !== 'ALL') {
    composerClassSelect.value = state.activeClass;
  }
}

function renderClassModalList() {
  const box = document.getElementById('classTagsList');
  if (state.classes.length === 0) {
    box.innerHTML = `<span style="font-size:0.78rem;color:var(--text-dim)">Henüz sınıf yok. Yazarken "8a" derseniz otomatik etiket açılır.</span>`;
    return;
  }
  box.innerHTML = state.classes.map(c => `
    <span class="class-tag-chip">
      ${esc(c)}
      <button type="button" onclick="deleteClassItem('${esc(c)}')">&times;</button>
    </span>
  `).join('');
}

window.deleteClassItem = function(cls) {
  state.classes = state.classes.filter(c => c !== cls);
  if (state.activeClass === cls) state.activeClass = 'ALL';
  persist();
  renderClasses();
  renderClassModalList();
  renderNotes();
};

document.getElementById('addClassForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = document.getElementById('classInput');
  const norm = normalizeClassName(inp.value);
  if (!norm) return;
  if (!state.classes.includes(norm)) {
    state.classes.push(norm);
    persist();
    renderClasses();
    renderClassModalList();
    toast(`${norm} eklendi`);
  }
  inp.value = '';
});

// Notes CRUD
function saveNote() {
  const raw = noteInput.value.trim();
  if (!raw) return;

  let finalClass = composerClassSelect.value || state.detectedClass || detectClassFromText(raw) || '';
  if (finalClass) {
    finalClass = normalizeClassName(finalClass);
    if (!state.classes.includes(finalClass)) {
      state.classes.push(finalClass);
      renderClasses();
    }
  }

  state.notes.unshift({
    id: Date.now().toString(),
    text: raw,
    classTag: finalClass,
    createdAt: new Date().toISOString(),
    pinned: false,
    done: false
  });

  persist();
  noteInput.value = '';
  noteInput.style.height = 'auto';
  state.detectedClass = '';
  detectedBar.classList.remove('visible');
  renderNotes();
}

sendBtn.addEventListener('click', saveNote);
noteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    saveNote();
  }
});

searchInput.addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderNotes();
});

function formatDateLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const clock = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Bugün ${clock}`;
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} • ${clock}`;
}

function renderNotes() {
  const list = state.notes
    .filter(n => {
      const okClass = state.activeClass === 'ALL' || n.classTag === state.activeClass;
      const okSearch = !state.search ||
        n.text.toLowerCase().includes(state.search) ||
        (n.classTag && n.classTag.toLowerCase().includes(state.search));
      return okClass && okSearch;
    })
    .sort((a, b) => (a.pinned === b.pinned ? Number(b.id) - Number(a.id) : a.pinned ? -1 : 1));

  if (list.length === 0) {
    notesList.innerHTML = `
      <div class="empty-box">
        <h3>${state.activeClass === 'ALL' ? 'Not defteri boş' : state.activeClass + ' için not yok'}</h3>
        <p>Alttan yazın veya sesli not bırakın. "8a" yazdığınızda etiket otomatik açılır.</p>
      </div>
    `;
    return;
  }

  notesList.innerHTML = list.map(n => `
    <article class="note-item ${n.pinned ? 'pinned' : ''} ${n.done ? 'done' : ''}">
      <div class="note-top">
        <div class="note-tags">
          ${n.classTag ? `<span class="tag-class">${esc(n.classTag)}</span>` : ''}
          <span class="tag-date">${formatDateLabel(n.createdAt)}</span>
        </div>
        <div class="note-btns">
          <button class="icon-action ${n.pinned ? 'pin-on' : ''}" onclick="toggleNotePin('${n.id}')" title="Sabitle">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${n.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
            </svg>
          </button>
          <button class="icon-action ${n.done ? 'done-on' : ''}" onclick="toggleNoteDone('${n.id}')" title="Tamamlandı">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
          <button class="icon-action" onclick="removeNote('${n.id}')" title="Sil">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="note-body">${esc(n.text)}</div>
    </article>
  `).join('');
}

window.toggleNotePin = function(id) {
  const item = state.notes.find(x => x.id === id);
  if (item) { item.pinned = !item.pinned; persist(); renderNotes(); }
};

window.toggleNoteDone = function(id) {
  const item = state.notes.find(x => x.id === id);
  if (item) { item.done = !item.done; persist(); renderNotes(); }
};

window.removeNote = function(id) {
  state.notes = state.notes.filter(x => x.id !== id);
  persist();
  renderNotes();
  toast('Silindi');
};

// Speech Recognition
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let recording = false;

if (SR) {
  rec = new SR();
  rec.lang = 'tr-TR';
  rec.continuous = false;
  rec.interimResults = true;

  let prefix = '';
  rec.onstart = () => {
    recording = true;
    prefix = noteInput.value ? noteInput.value + ' ' : '';
    micBtn.classList.add('live');
    toast('Dinleniyor...');
  };
  rec.onresult = (e) => {
    let spoken = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      spoken += e.results[i][0].transcript;
    }
    noteInput.value = prefix + spoken;
    noteInput.style.height = 'auto';
    noteInput.style.height = Math.min(noteInput.scrollHeight, 84) + 'px';
    updateDetectedClassPreview();
  };
  rec.onerror = () => {
    recording = false;
    micBtn.classList.remove('live');
  };
  rec.onend = () => {
    recording = false;
    micBtn.classList.remove('live');
  };
  micBtn.addEventListener('click', async () => {
    await requestMicrophonePermission(true);
    if (recording) rec.stop();
    else rec.start();
  });
} else {
  micBtn.addEventListener('click', () => toast('Sesli giriş desteklenmiyor'));
}

// Schedule & Lesson Alerts (Checks every 15s for exact/upcoming lesson time)
function renderSchedule() {
  document.getElementById('daysGrid').innerHTML = DAYS.map((d, i) => `
    <button class="day-pill ${state.selectedDay === i ? 'active' : ''}" onclick="setDay(${i})">${d.slice(0, 3)}</button>
  `).join('');

  document.getElementById('dayHeading').textContent = `${DAYS[state.selectedDay]} Dersleri`;
  const lessons = (state.schedule[state.selectedDay] || []).sort((a, b) => a.time.localeCompare(b.time));
  const container = document.getElementById('lessonsList');

  if (lessons.length === 0) {
    container.innerHTML = `<div class="empty-box" style="padding:28px 14px;"><h3>Ders eklenmemiş</h3><p>"+ Ders Ekle" ile saat ve sınıf girin.</p></div>`;
    return;
  }

  container.innerHTML = lessons.map(l => `
    <div class="lesson-row">
      <div class="lesson-info-left">
        <div class="lesson-clock">${esc(l.time)}</div>
        <div>
          <div class="lesson-title">${esc(l.className)}</div>
          <div class="lesson-sub">${esc(l.detail || 'Ders')}</div>
        </div>
      </div>
      <button class="icon-action" onclick="deleteLessonItem('${l.id}')" title="Sil">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  `).join('');
}

window.setDay = function(i) {
  state.selectedDay = i;
  renderSchedule();
};

document.getElementById('openLessonModalBtn').addEventListener('click', () => {
  requestNotificationPermission(true);
  openModal('lessonModal');
});

document.getElementById('addLessonForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const time = document.getElementById('lessonTimeInp').value;
  const cls = normalizeClassName(document.getElementById('lessonClassInp').value);
  const detail = document.getElementById('lessonDetailInp').value.trim();
  if (!time || !cls) return;

  if (!state.schedule[state.selectedDay]) state.schedule[state.selectedDay] = [];
  state.schedule[state.selectedDay].push({
    id: Date.now().toString(),
    time,
    className: cls,
    detail
  });

  if (!state.classes.includes(cls)) {
    state.classes.push(cls);
    renderClasses();
  }

  persist();
  renderSchedule();
  closeAllModals();
  e.target.reset();
  toast(`${time} — ${cls} eklendi`);
});

window.deleteLessonItem = function(id) {
  state.schedule[state.selectedDay] = state.schedule[state.selectedDay].filter(x => x.id !== id);
  persist();
  renderSchedule();
};

// Lesson Notification Checker
function checkLessonNotifications() {
  const now = new Date();
  const dayIdx = now.getDay() - 1;
  if (dayIdx < 0 || dayIdx > 4) return;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowHM = `${hh}:${mm}`;
  const todayKey = now.toISOString().slice(0, 10);

  const lessons = state.schedule[dayIdx] || [];
  lessons.forEach(lesson => {
    const alertKey = `${todayKey}_${lesson.id}_${lesson.time}`;
    if (lesson.time === nowHM && !state.notifiedMap[alertKey]) {
      state.notifiedMap[alertKey] = true;
      persist();
      toast(`Ders Saati: ${lesson.time} — ${lesson.className}`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`Ders Vakti: ${lesson.className}`, {
            body: `${lesson.time} — ${lesson.detail || 'Sınıfınıza geçiş saati'}`,
            icon: './icon.svg',
            tag: alertKey
          });
        } catch {}
      }
    }
  });
}

// Timer
const readoutEl = document.getElementById('stopwatchReadout');
const startTimerBtn = document.getElementById('startTimerBtn');
const resetTimerBtn = document.getElementById('resetTimerBtn');

function drawTimer() {
  const m = Math.floor(state.timerSec / 60);
  const s = state.timerSec % 60;
  readoutEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

document.querySelectorAll('.preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    clearInterval(state.timerId);
    state.timerOn = false;
    startTimerBtn.textContent = 'Başlat';
    state.timerSec = Number(btn.dataset.sec);
    drawTimer();
  });
});

startTimerBtn.addEventListener('click', () => {
  if (state.timerOn) {
    clearInterval(state.timerId);
    state.timerOn = false;
    startTimerBtn.textContent = 'Devam Et';
  } else {
    if (state.timerSec <= 0) state.timerSec = 300;
    state.timerOn = true;
    startTimerBtn.textContent = 'Duraklat';
    state.timerId = setInterval(() => {
      state.timerSec--;
      drawTimer();
      if (state.timerSec <= 0) {
        clearInterval(state.timerId);
        state.timerOn = false;
        startTimerBtn.textContent = 'Başlat';
        if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
        toast('Süre bitti');
      }
    }, 1000);
  }
});

resetTimerBtn.addEventListener('click', () => {
  clearInterval(state.timerId);
  state.timerOn = false;
  state.timerSec = 300;
  startTimerBtn.textContent = 'Başlat';
  drawTimer();
});

// Save Data in Local Storage WITHOUT triggering any file download
document.getElementById('saveSnapshotBtn').addEventListener('click', () => {
  persist();
  toast(`Kaydedildi (${state.notes.length} not)`);
});

// Modals
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeAllModals() {
  document.querySelectorAll('.modal-bg').forEach(m => m.classList.remove('open'));
}
document.querySelectorAll('.modal-bg').forEach(bg => {
  bg.addEventListener('click', (e) => { if (e.target === bg) closeAllModals(); });
});
document.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', closeAllModals));

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Boot
refreshPermissionBadges();
renderClasses();
renderNotes();
renderSchedule();
drawTimer();
checkLessonNotifications();
setInterval(checkLessonNotifications, 15000);
