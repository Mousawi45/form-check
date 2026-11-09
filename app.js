(function(){
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS = 'form-check-live.v1';
let prefs = { ex:'hack', cam:'environment', snd:'voice' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} };
const EX = {}; (window.EXERCISES || []).forEach(x => { EX[x.id] = x; });

/* ---------- plan from Daily Vitals ---------- */
const DV_URL = 'https://claude.ai/artifact/79HREb7uoFQKNjZaryAH33#gym', EVIDENCE_DOC = 'https://claude.ai/artifact/H5w4Hkk4P93VMvSpE3J2xz';
let plan = null, cur = null;   // plan: { d, wk, n, it:[{ k, s, x, sets, lo, hi, done }], got }; cur: the plan item being trained
const int = (v, lo, hi) => { v = Math.round(Number(v)); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
function parsePlan(str){
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/')))));
    if (!o || o.v !== 1 || !Array.isArray(o.it)) return null;
    const it = o.it.slice(0, 16).filter(i => i && typeof i.k === 'string' && /^[a-z0-9_]{2,12}$/.test(i.k) && EX[i.x]).map(i => ({ k:i.k, s:String(i.s || '').slice(0, 4), x:i.x, sets:int(i.sets, 1, 10) || 3, lo:int(i.lo, 1, 50), hi:int(i.hi, 1, 60), done:int(i.done, 0, 20) || 0 }));
    if (!it.length) return null;
    return { d:/^\d{4}-\d\d-\d\d$/.test(o.d) ? o.d : '', wk:String(o.wk || '').slice(0, 4), n:String(o.n || 'Today').slice(0, 40), cur:typeof o.cur === 'string' ? o.cur : '', it, got:Date.now() };
  } catch (e) { return null; }
}
const item = k => plan && plan.it.find(i => i.k === k);
const nextUndone = () => plan && (plan.it.find(i => i.done < i.sets) || null);
function loadPlan(text){
  const m = /[#&]plan=([A-Za-z0-9_-]+)/.exec(text == null ? location.hash : text), inc = m ? parsePlan(m[1]) : null;
  if (text != null && !inc) return false;
  const saved = prefs.plan && Date.now() - (prefs.plan.got || 0) < 16 * 3600e3 ? prefs.plan : null;
  if (inc) {
    if (saved && saved.d === inc.d && saved.wk === inc.wk) inc.it.forEach(i => { const o = saved.it.find(z => z.k === i.k && z.x === i.x); if (o) i.done = Math.max(i.done, o.done); });
    plan = inc; cur = item(inc.cur) ? inc.cur : (nextUndone() || plan.it[0]).k;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  } else if (saved) { plan = saved; cur = item(prefs.cur) ? prefs.cur : null; }
  else prefs.plan = null;
  if (plan) { prefs.plan = plan; if (cur) prefs.ex = item(cur).x; }
  prefs.cur = cur; savePrefs();
  return !!inc;
}
/* Opened from the home-screen icon: paste the link copied in Daily Vitals. */
const PASTE_HINT = $('planPasteMsg').innerHTML;
$('planPaste').addEventListener('input', e => {
  const v = e.target.value.trim(); if (!v) { $('planPasteMsg').innerHTML = PASTE_HINT; return; }
  if (loadPlan(v)) { e.target.value = ''; $('planPasteMsg').innerHTML = PASTE_HINT; showEx(); renderPlan(); }
  else $('planPasteMsg').textContent = 'That isn’t a workout link. In Daily Vitals tap Go live, then Copy link.';
});
function renderPlan(){
  $('planCard').hidden = !plan; $('planIn').hidden = !!plan; if (!plan) return;
  $('planTitle').textContent = plan.n;
  const left = plan.it.filter(i => i.done < i.sets).length;
  $('planNote').textContent = left ? left + ' of ' + plan.it.length + ' to go' : 'All done';
  $('planList').innerHTML = plan.it.map(i => { const x = EX[i.x], ok = i.done >= i.sets; return '<button type="button" class="pi' + (ok ? ' done' : '') + '" data-k="' + esc(i.k) + '" aria-pressed="' + (i.k === cur) + '"><span class="ps">' + esc(i.s) + '</span><span class="pn"><b>' + esc(x.n) + '</b><small>' + Math.min(i.done, i.sets) + ' of ' + i.sets + ' sets' + (i.lo ? ' · ' + i.lo + '–' + i.hi + ' reps' : '') + (x.per ? ' ' + esc(x.per) : '') + '</small></span><span class="pk" aria-hidden="true">' + (ok ? '✓' : '') + '</span></button>'; }).join('');
}
$('planList').addEventListener('click', e => { const b = e.target.closest('.pi'); if (!b || !item(b.dataset.k)) return; choose(item(b.dataset.k).x, b.dataset.k); });

/* ---------- exercise picker with search ---------- */
const SYN = { Chest:'pecs push', Back:'lats pull row', Legs:'quads glutes hamstrings hams calves thighs', 'Shoulders & arms':'delts biceps triceps arms', Abs:'core' };
const EQN = { machine:'Machine', cable:'Cable', free:'Free weight', bw:'Bodyweight' };
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const textOf = x => norm(x.n + ' ' + (EQN[x.eq] || '') + ' ' + x.g + ' ' + (SYN[x.g] || ''));
function hit(text, q){ const flat = text.replace(/ /g, ''); return norm(q).split(' ').filter(Boolean).every(w => (' ' + text).indexOf(' ' + w) >= 0 || flat.indexOf(w) >= 0); }
function renderPicker(){
  const q = $('q').value, groups = {}, inPlan = plan ? new Set(plan.it.map(i => i.x)) : new Set();
  window.EXERCISES.forEach(x => { if (!q || hit(textOf(x), q)) (groups[x.g] = groups[x.g] || []).push(x); });
  const row = x => '<button type="button" class="po" data-x="' + x.id + '" aria-pressed="' + (x.id === prefs.ex) + '"><b>' + esc(x.n) + '</b><small>' + esc(EQN[x.eq] || '') + (inPlan.has(x.id) ? ' · in today’s workout' : '') + '</small></button>';
  let h = '';
  if (plan && !q) h += '<div class="pg"><span class="eyebrow">Today’s workout</span>' + plan.it.map(i => EX[i.x]).map(row).join('') + '</div>';
  h += Object.keys(groups).map(g => '<div class="pg"><span class="eyebrow">' + esc(g) + '</span>' + groups[g].map(row).join('') + '</div>').join('');
  $('pickList').innerHTML = h || '<p class="note">Nothing matches. Try a muscle (chest, quads), a machine or part of the name.</p>';
}
function openPicker(){ $('picker').hidden = false; $('setup').inert = true; $('q').value = ''; renderPicker(); setTimeout(() => $('q').focus(), 30); }
function closePicker(){ $('picker').hidden = true; $('setup').inert = false; $('pickBtn').focus(); }
$('pickBtn').addEventListener('click', openPicker);
$('pickClose').addEventListener('click', closePicker);
$('q').addEventListener('input', renderPicker);
$('q').addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const f = $('pickList').querySelector('.po'); if (f) setTimeout(() => f.click(), 0); });
$('pickList').addEventListener('click', e => { const b = e.target.closest('.po'); if (!b) return; choose(b.dataset.x); closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('picker').hidden) closePicker(); });
function choose(id, k){
  if (!EX[id]) return;
  prefs.ex = id;
  cur = k || (plan && (plan.it.find(i => i.x === id && i.done < i.sets) || plan.it.find(i => i.x === id)) || {}).k || null;
  prefs.cur = cur; savePrefs(); showEx(); renderPlan();
}

/* ---------- what gets checked, with the evidence ---------- */
const EVL = { strong:'Strong evidence', moderate:'Moderate evidence', low:'Low evidence' };
const KIND = { must:['Range', 'missing it makes a partial'], nice:['Range', 'missing it makes a stretch partial, which still counts'], flag:['Form', 'flagged, rep still counts'], cue:['Plan cue', 'from your plan; little growth evidence either way'] };
const evLine = m => '<span class="ev">' + EVL[m.ev] + '</span>' + (m.src && m.src.length ? ' · ' + m.src.map(x => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.a) + '</a>').join(', ') : '');
function showEx(){
  const rule = FormEngine.ruleFor(prefs.ex), x = EX[prefs.ex], it = item(cur);
  $('exName').textContent = x.n;
  $('exMeta').textContent = (it ? it.s + ' · ' + Math.min(it.done, it.sets) + ' of ' + it.sets + ' sets · ' : '') + (EQN[x.eq] || '') + ' · ' + x.g;
  $('exCues').innerHTML = (x.c || []).map(c => '<li>' + esc(c) + '</li>').join('');
  if (!rule || rule.none) { $('exTip').textContent = rule && rule.none ? rule.none : 'No form check for this one yet.'; $('exChecks').innerHTML = ''; $('startBtn').disabled = true; return; }
  $('startBtn').disabled = false;
  $('exTip').textContent = FormEngine.tipFor(rule) + (x.per ? ' Do one side per set; reps are counted ' + x.per + '.' : '');
  $('exChecks').innerHTML = FormEngine.metaFor(prefs.ex).map(m => '<li class="k-' + m.kind + '"><span><b>' + esc(m.label) + '</b> <small>' + KIND[m.kind][0] + ': ' + KIND[m.kind][1] + '</small></span><small>' + evLine(m) + '</small></li>').join('');
}
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => { prefs.cam = b.dataset.cam; savePrefs(); syncSeg(); }));
document.querySelectorAll('[data-snd]').forEach(b => b.addEventListener('click', () => { prefs.snd = b.dataset.snd; savePrefs(); syncSeg(); }));
function syncSeg(){
  document.querySelectorAll('[data-cam]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === prefs.cam)));
  document.querySelectorAll('[data-snd]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.snd === prefs.snd)));
}

/* ---------- sound ---------- */
let actx = null;
function unlockAudio(){
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; }
  try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
}
function tone(f, d, at){ if (!actx) return; const t = actx.currentTime + (at || 0), o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + 0.02); }
function say(text){ try { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.15; speechSynthesis.speak(u); } catch (e) {} }
/* p partial (stretched end missed) · s stretch partial (still counts) · f form flag · g full */
const repKind = r => r.partial ? 'p' : r.flags.length ? 'f' : r.sp ? 's' : 'g';
function cue(rep){
  const kind = repKind(rep);
  try { if (navigator.vibrate) navigator.vibrate(kind === 'g' ? 60 : kind === 's' ? [60, 50, 40] : [80, 60, 80]); } catch (e) {}
  if (prefs.snd === 'off') return;
  if (prefs.snd === 'voice') say(rep.i + (kind === 'p' ? ', partial' : kind === 's' ? ', stretch partial' : kind === 'f' ? ', check form' : ''));
  else if (kind === 'g') tone(880, 0.13); else if (kind === 's') { tone(880, 0.1); tone(660, 0.12, 0.14); } else if (kind === 'p') { tone(330, 0.16); tone(330, 0.16, 0.22); } else { tone(600, 0.1); tone(600, 0.1, 0.16); }
}

/* ---------- model ---------- */
let rt = null, SZ = 512, modelP = null;
function loadModel(onMsg){
  if (rt) return Promise.resolve(rt);
  if (modelP) return modelP;
  modelP = (async () => {
    onMsg('Loading the pose model…');
    if (!window.tf) throw new Error('The model library didn’t load. Check your connection and reload.');
    try { await tf.setBackend('webgl'); await tf.ready(); } catch (e) { throw new Error('This browser can’t run the pose model (WebGL is off).'); }
    const r = await fetch('pose-model.json'); if (!r.ok) throw new Error('The pose model didn’t download. Check your connection.');
    const spec = await r.json();
    rt = new PoseRT(tf, spec); SZ = rt.inputSize;
    onMsg('Warming up…');
    const w = tf.tidy(() => rt.forward(tf.zeros([1, SZ, SZ, 3]))); await w.data(); w.dispose();
    return rt;
  })();
  modelP.catch(() => { modelP = null; });
  return modelP;
}
function iou(a, b){ const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]), i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1), u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i; return u > 0 ? i / u : 0; }
function pick(d, N, prev, map){
  let best = -1, bs = -1, bb = null;
  for (let i = 0; i < N; i++) {
    const c = d[4 * N + i]; if (c < 0.3) continue;
    const cx = d[i], cy = d[N + i], w = d[2 * N + i], h = d[3 * N + i], box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    const s = prev ? iou(box, prev) * 2 + c * 0.2 : c * w * h;
    if (s > bs) { bs = s; best = i; bb = box; }
  }
  if (best < 0 || (prev && bs < 0.3)) return null;
  const k = [];
  for (let j = 0; j < 17; j++) k.push([(d[(5 + 3 * j) * N + best] - map.dx) / map.sc, (d[(6 + 3 * j) * N + best] - map.dy) / map.sc, d[(7 + 3 * j) * N + best]]);
  return { k, box:bb };
}

/* ---------- live ---------- */
let stream = null, running = false, track = [], prevBox = null, miss = 0, t0 = 0, recStart = 0, recording = false, announced = 0, lastSeen = 0, frames = 0, fpsT = 0, lastRes = null, wake = null;
const cv = document.createElement('canvas'), cx = cv.getContext('2d');
async function start(){
  unlockAudio();
  const st = $('setupStatus'); st.classList.remove('err');
  $('startBtn').disabled = true;
  try {
    await loadModel(m => { st.textContent = m; });
    st.textContent = 'Opening the camera…';
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:prefs.cam, width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
  } catch (e) {
    st.classList.add('err');
    st.textContent = e && e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.' : (e && e.message) || 'Couldn’t start. Try again.';
    $('startBtn').disabled = false; return;
  }
  st.textContent = '';
  const v = $('vid'); v.srcObject = stream; await v.play().catch(() => {});
  $('setup').hidden = true; $('summary').hidden = true; $('live').hidden = false;
  $('live').classList.toggle('mirror', prefs.cam === 'user');
  const x = EX[prefs.ex], rule = FormEngine.ruleFor(prefs.ex), it = item(cur);
  $('hudEx').innerHTML = (it ? esc(it.s) + ' · ' : '') + esc(x.n) + '<small>' + esc(rule.what) + (rule.target != null && !rule.rel ? ' · target ' + (rule.better === 'lower' ? '≤ ' : '≥ ') + rule.target + '°' : '') + '</small>';
  $('hudReps').innerHTML = '0<small>reps</small>'; $('last').hidden = true; $('gVal').textContent = '–'; $('gLbl').textContent = rule.rel ? '' : rule.what;
  track = []; prevBox = null; miss = 0; announced = 0; lastRes = null; recording = false; frames = 0; fpsT = performance.now(); t0 = performance.now(); lastSeen = 0;
  try { wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
  running = true; tick();
  // countdown, then record
  const cnt = $('count'); cnt.hidden = false;
  for (let n = 5; n > 0 && running; n--) { $('countN').textContent = n; if (prefs.snd !== 'off') tone(n === 1 ? 660 : 520, 0.08); await new Promise(r => setTimeout(r, 1000)); }
  cnt.hidden = true;
  if (!running) return;
  if (prefs.snd === 'voice') say('Go'); else if (prefs.snd === 'beep') tone(990, 0.2);
  recStart = performance.now(); recording = true;
}
function schedule(){ const v = $('vid'); if (!running) return; if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => tick()); else requestAnimationFrame(() => tick()); }
async function tick(){
  if (!running) return;
  const v = $('vid');
  if (v.readyState < 2 || !v.videoWidth) { schedule(); return; }
  const vw = v.videoWidth, vh = v.videoHeight;
  if (cv.width !== SZ) { cv.width = SZ; cv.height = SZ; }
  const sc = SZ / Math.max(vw, vh), map = { sc, dx:(SZ - vw * sc) / 2, dy:(SZ - vh * sc) / 2 };
  cx.fillStyle = '#727272'; cx.fillRect(0, 0, SZ, SZ); cx.drawImage(v, map.dx, map.dy, vw * sc, vh * sc);
  const out = tf.tidy(() => rt.forward(tf.browser.fromPixels(cv).toFloat().div(255).expandDims(0)));
  const d = await out.data(), N = out.shape[2]; out.dispose();
  if (!running) return;
  const p = pick(d, N, prevBox, map), now = performance.now();
  if (p) { prevBox = p.box; miss = 0; lastSeen = now; } else if (++miss > 6) prevBox = null;
  draw(p ? p.k : null, vw, vh);
  if (recording) {
    track.push({ t:(now - recStart) / 1000, k:p ? p.k : null });
    if (track.length >= 10) live(now);
  }
  $('banner').hidden = !(now - lastSeen > 1500);
  if (!$('banner').hidden) $('banner').textContent = 'Step into frame: whole body visible, ' + (FormEngine.ruleFor(prefs.ex).view === 'front' ? 'facing the phone' : 'side-on to the phone');
  frames++; if (now - fpsT > 1000) { $('fps').textContent = (frames * 1000 / (now - fpsT)).toFixed(0) + ' fps'; frames = 0; fpsT = now; }
  schedule();
}
function draw(k, vw, vh){
  const c = $('ov'), r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  if (!k) return;
  const s = Math.min(c.width / vw, c.height / vh), ox = (c.width - vw * s) / 2, oy = (c.height - vh * s) / 2;
  const E = [[5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
  g.lineCap = 'round'; g.lineWidth = 5 * dpr; g.strokeStyle = 'rgba(61,214,140,.95)';
  E.forEach(e => { const a = k[e[0]], b = k[e[1]]; if (a[2] < 0.35 || b[2] < 0.35) return; g.beginPath(); g.moveTo(ox + a[0] * s, oy + a[1] * s); g.lineTo(ox + b[0] * s, oy + b[1] * s); g.stroke(); });
  g.fillStyle = '#fff';
  for (let i = 5; i < 17; i++) { const q = k[i]; if (q[2] < 0.35) continue; g.beginPath(); g.arc(ox + q[0] * s, oy + q[1] * s, 5 * dpr, 0, 7); g.fill(); }
}
function fmtVal(rule, v){ if (!isFinite(v)) return '–'; if (rule.rel) return ''; const x = Math.round(v); return (rule.what === 'thigh angle' && x > 0 ? '+' : '') + x + (rule.unit === '°' ? '°' : ''); }
function live(now){
  const rule = FormEngine.ruleFor(prefs.ex), res = FormEngine.analyze(track, prefs.ex);
  if (res.error) return;
  lastRes = res;
  const y = res.series[res.series.length - 1];
  if (!rule.rel) {
    $('gVal').textContent = fmtVal(rule, y);
    $('gauge').classList.toggle('ok', rule.target != null && (rule.better === 'lower' ? y <= rule.target : y >= rule.target));
  }
  // announce a rep once its return half is under way (so the finish of the rep is measured too)
  while (announced < res.n) {
    const rep = res.reps[announced], tNow = (now - recStart) / 1000, since = tNow - rep.t;
    const back = Math.abs(rep.ext - rep.otherBefore) > 0 ? Math.abs(y - rep.otherBefore) / Math.abs(rep.ext - rep.otherBefore) : 0;
    if (since < 0.35 || (back > 0.25 && since < 2)) break;
    announced++;
    cue(rep);
    $('hudReps').innerHTML = announced + '<small>rep' + (announced === 1 ? '' : 's') + (res.per ? ' this side' : '') + '</small>';
    const L = $('last'), kind = repKind(rep);
    L.className = 'last ' + kind; L.hidden = false;
    const why = rep.fails.concat(rep.spFails || [], rep.flags, rep.cues || []).map(c => res.labels[c]).filter(Boolean)[0];
    L.textContent = 'Rep ' + rep.i + (rule.rel ? '' : ' · ' + fmtVal(rule, rep.ext)) + ' · ' + (kind === 'p' ? 'partial' : kind === 's' ? 'stretch partial' : 'full') + (why ? ': ' + why.toLowerCase() : '');
  }
}
function stopStream(){ running = false; recording = false; try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {} stream = null; try { wake && wake.release(); } catch (e) {} wake = null; try { speechSynthesis.cancel(); } catch (e) {} }
function stop(){
  stopStream();
  const res = track.length >= 8 ? FormEngine.analyze(track, prefs.ex) : { error:'short', message:'The set was too short to read. Record the whole set.' };
  showSummary(res);
}

/* ---------- summary ---------- */
function chart(r){
  const ys = r.series, ts = r.times, n = ys.length; if (n < 2) return '';
  const W = 320, H = 96, pl = 30, pr = 6, pt = 8, pb = 16, vals = ys.filter(v => !isNaN(v)); if (!vals.length) return '';
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (r.target != null && !r.rel) { lo = Math.min(lo, r.target); hi = Math.max(hi, r.target); }
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = i => pl + (W - pl - pr) * (ts[i] - ts[0]) / Math.max(0.001, ts[n - 1] - ts[0]), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
  let d = '', pen = false; for (let i = 0; i < n; i++) { if (isNaN(ys[i])) { pen = false; continue; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(ys[i]).toFixed(1); pen = true; }
  let g = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(r.what) + ' over the set">';
  if (r.target != null && !r.rel) { const ty = Y(r.target), a = r.better === 'lower' ? ty : pt, b = r.better === 'lower' ? H - pb : ty; g += '<rect class="tz" x="' + pl + '" y="' + Math.min(a, b).toFixed(1) + '" width="' + (W - pl - pr) + '" height="' + Math.abs(b - a).toFixed(1) + '"/><line class="tg" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '"/><text class="ax" x="' + (pl - 4) + '" y="' + (ty + 3).toFixed(1) + '" text-anchor="end">' + r.target + '°</text>'; }
  g += '<path class="ln" d="' + d + '"/>';
  r.reps.forEach(rep => { g += '<circle class="' + (rep.partial ? 'dp' : rep.sp ? 'ds' : 'dg') + '" cx="' + X(rep.e).toFixed(1) + '" cy="' + Y(rep.ext).toFixed(1) + '" r="5"/>'; });
  return g + '<text class="ax" x="' + pl + '" y="' + (H - 3) + '">0 s</text><text class="ax" x="' + (W - pr) + '" y="' + (H - 3) + '" text-anchor="end">' + Math.round(ts[n - 1] - ts[0]) + ' s</text></svg>';
}
function b64url(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function codeFor(r){
  const today = new Date(), ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
  const o = { x:prefs.ex, d:ymd, t:Date.now(), cov:Math.round(r.coverage * 100) / 100, w:r.warn.slice(0, 3),
    r:r.reps.map(p => ({ e:r1(p.ext), o:r1(p.other), c:r1(p.ecc), h:r1(p.holdExt), a:p.fails, s:p.spFails || [], f:p.flags, q:p.cues || [] })) };
  if (item(cur) && item(cur).x === prefs.ex) o.k = cur;   // lands on this exercise slot in Daily Vitals
  return 'VFC1.' + b64url(JSON.stringify(o));
}
function showSummary(res){
  $('live').hidden = true; $('summary').hidden = false; $('setup').hidden = true; window.scrollTo(0, 0);
  const x = EX[prefs.ex], it = item(cur) && item(cur).x === prefs.ex ? item(cur) : null; $('sumEx').textContent = (it ? it.s + ' · ' : '') + x.n;
  const card = $('sumCard');
  if (res.error) { card.innerHTML = '<p class="tip">' + esc(res.message || 'Couldn’t read the set.') + '</p>'; $('code').value = ''; $('copyBtn').disabled = true; nextLabel(); return; }
  $('copyBtn').disabled = !res.n;
  if (it && res.n) { it.done = Math.min(20, it.done + 1); prefs.plan = plan; savePrefs(); }
  let h = '<div class="row" style="justify-content:space-between;align-items:flex-end"><div class="big">' + res.n + '<small>rep' + (res.n === 1 ? '' : 's') + (res.per ? ' this side' : '') + '</small></div><div class="split">' + (res.n ? '<span class="g">' + res.nGood + ' full</span>' + (res.nSp ? '<span class="s">' + res.nSp + ' stretch partial</span>' : '') + (res.nPartial ? '<span class="p">' + res.nPartial + ' partial</span>' : '') : '<span class="n">No reps found</span>') + '</div></div>';
  if (it) h += '<p class="note">Set ' + it.done + ' of ' + it.sets + (it.lo ? ' · plan ' + it.lo + '–' + it.hi + ' reps' : '') + '</p>';
  h += chart(res);
  h += '<div class="chips">' + res.reps.map(p => '<span class="chip ' + repKind(p) + '"><b>' + p.i + '</b><small>' + (fmtVal(FormEngine.ruleFor(prefs.ex), p.ext) || (p.partial ? 'short' : 'full')) + '</small></span>').join('') + '</div>';
  const meta = {}; (res.meta || []).forEach(m => { meta[m.code] = m; });
  const order = { must:0, nice:1, flag:2, cue:3 }, by = {};
  res.reps.forEach(p => p.fails.concat(p.partial ? [] : p.spFails || [], p.flags, p.cues || []).forEach(c => (by[c] = by[c] || []).push(p.i)));
  const items = Object.keys(by).sort((a, b) => order[(meta[a] || {}).kind || 'cue'] - order[(meta[b] || {}).kind || 'cue']).map(c => {
    const m = meta[c] || { label:res.labels[c] || c, kind:'cue', ev:'low', src:[] }, on = ' on rep' + (by[c].length > 1 ? 's ' : ' ') + by[c].join(', ');
    const t = m.kind === 'must' ? ' missed' + on + ' (partial)' : m.kind === 'nice' ? ' missed' + on + '. Stretched end reached, so these still count' : on + (m.kind === 'cue' ? ' (plan cue)' : '');
    return '<li class="' + ({ must:'p', nice:'s', flag:'f', cue:'q' })[m.kind] + '"><i></i><span><b>' + esc(m.label) + '</b>' + t + '<small>' + evLine(m) + '</small></span></li>';
  });
  if (res.n && !items.length) items.push('<li><i></i><span><b>Every rep hit the standard.</b></span></li>');
  if (items.length) h += '<ul class="issues">' + items.join('') + '</ul>';
  res.warn.forEach(w => { h += '<p class="note">' + esc(w) + '</p>'; });
  h += '<p class="note">Phone-camera angles can be off by 10–15°, so compare reps with each other rather than trusting one number.</p>';
  card.innerHTML = h;
  $('code').value = res.n ? codeFor(res) : '';
  $('pasteWhere').textContent = it ? it.s + ' ' + x.n : x.n;
  $('copyStatus').textContent = '';
  nextLabel();
}
/* after the last planned set of an exercise, the main button moves on to the next one */
function nextLabel(){ const it = item(cur), nx = nextUndone(); $('nextBtn').textContent = it && it.done >= it.sets && nx ? 'Next exercise' : 'Next set'; }
$('copyBtn').addEventListener('click', () => {
  const t = $('code').value; if (!t) return;
  const done = ok => { $('copyStatus').textContent = ok ? 'Copied. Paste it in Daily Vitals → Gym.' : 'Select the code above and copy it.'; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => done(true), () => { $('code').select(); done(false); });
  else { $('code').select(); done(false); }
});
$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
function toSetup(){ $('summary').hidden = true; $('setup').hidden = false; showEx(); renderPlan(); window.scrollTo(0, 0); }
$('nextBtn').addEventListener('click', () => {
  const it = item(cur), nx = nextUndone();
  if (it && it.done >= it.sets && nx) { choose(nx.x, nx.k); toSetup(); return; }   // new exercise: see the camera tip first
  toSetup(); start();
});
$('changeBtn').addEventListener('click', () => { toSetup(); openPicker(); });
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && running && !wake) { try { wake = await navigator.wakeLock.request('screen'); } catch (e) {} } });

function boot(){
  if (!window.FormEngine || !window.EXERCISES) { setTimeout(boot, 50); return; }
  if (!EX[prefs.ex]) prefs.ex = 'hack';
  loadPlan(); showEx(); renderPlan(); syncSeg();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('setupStatus').textContent = 'This browser can’t open the camera here. Open the page in Safari or Chrome.'; $('setupStatus').classList.add('err'); }
  if (window.tf) loadModel(() => {}).catch(() => {});   // start downloading early
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
window.__fc = { analyze:() => lastRes, track:() => track, plan:() => plan, cur:() => cur, summary:showSummary };
})();
