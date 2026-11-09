(function(){
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS = 'form-check-live.v1';
let prefs = { ex:'hack', cam:'environment', snd:'voice' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} };
const EX = {}; (window.EXERCISES || []).forEach(x => { EX[x.id] = x; });

/* ---------- setup ---------- */
function fillSelect(){
  const sel = $('exSel'), groups = {};
  window.EXERCISES.forEach(x => { (groups[x.g] = groups[x.g] || []).push(x); });
  sel.innerHTML = Object.keys(groups).map(g => '<optgroup label="' + esc(g) + '">' + groups[g].map(x => '<option value="' + x.id + '">' + esc(x.n) + '</option>').join('') + '</optgroup>').join('');
  if (!EX[prefs.ex]) prefs.ex = 'hack';
  sel.value = prefs.ex; showEx();
}
function showEx(){
  const rule = FormEngine.ruleFor(prefs.ex), x = EX[prefs.ex];
  if (!rule || rule.none) { $('exTip').textContent = rule && rule.none ? rule.none : 'No form check for this one yet.'; $('exChecks').innerHTML = ''; $('startBtn').disabled = true; return; }
  $('startBtn').disabled = false;
  $('exTip').textContent = FormEngine.tipFor(rule) + (x && x.per ? ' Do one side per set; reps are counted ' + x.per + '.' : '');
  $('exChecks').innerHTML = (rule.checks || []).map(c => '<li>' + esc(c.label) + ' <small>' + (c.partial ? 'range' : 'form') + '</small></li>').join('') + (rule.rel ? '<li>Reps under 70% of your best rep count as partial <small>range</small></li>' : '');
}
$('exSel').addEventListener('change', e => { prefs.ex = e.target.value; savePrefs(); showEx(); });
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
function cue(rep){
  const kind = rep.partial ? 'p' : rep.flags.length ? 'f' : 'g';
  try { if (navigator.vibrate) navigator.vibrate(kind === 'g' ? 60 : [80, 60, 80]); } catch (e) {}
  if (prefs.snd === 'off') return;
  if (prefs.snd === 'voice') say(rep.i + (kind === 'p' ? ', partial' : kind === 'f' ? ', check form' : ''));
  else if (kind === 'g') tone(880, 0.13); else if (kind === 'p') { tone(330, 0.16); tone(330, 0.16, 0.22); } else { tone(600, 0.1); tone(600, 0.1, 0.16); }
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
  const x = EX[prefs.ex], rule = FormEngine.ruleFor(prefs.ex);
  $('hudEx').innerHTML = esc(x.n) + '<small>' + esc(rule.what) + (rule.target != null && !rule.rel ? ' · target ' + (rule.better === 'lower' ? '≤ ' : '≥ ') + rule.target + '°' : '') + '</small>';
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
    const L = $('last'), kind = rep.partial ? 'p' : rep.flags.length ? 'f' : 'g';
    L.className = 'last ' + kind; L.hidden = false;
    const why = rep.fails.concat(rep.flags).map(c => res.labels[c]).filter(Boolean)[0];
    L.textContent = 'Rep ' + rep.i + (rule.rel ? '' : ' · ' + fmtVal(rule, rep.ext)) + ' · ' + (kind === 'g' ? 'full' : kind === 'p' ? 'partial' : 'full') + (why ? ': ' + why.toLowerCase() : '');
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
  r.reps.forEach(rep => { g += '<circle class="' + (rep.partial ? 'dp' : 'dg') + '" cx="' + X(rep.e).toFixed(1) + '" cy="' + Y(rep.ext).toFixed(1) + '" r="5"/>'; });
  return g + '<text class="ax" x="' + pl + '" y="' + (H - 3) + '">0 s</text><text class="ax" x="' + (W - pr) + '" y="' + (H - 3) + '" text-anchor="end">' + Math.round(ts[n - 1] - ts[0]) + ' s</text></svg>';
}
function b64url(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function codeFor(r){
  const today = new Date(), ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
  return 'VFC1.' + b64url(JSON.stringify({ x:prefs.ex, d:ymd, t:Date.now(), cov:Math.round(r.coverage * 100) / 100, w:r.warn.slice(0, 3),
    r:r.reps.map(p => ({ e:r1(p.ext), o:r1(p.other), c:r1(p.ecc), h:r1(p.holdExt), a:p.fails, f:p.flags })) }));
}
function showSummary(res){
  $('live').hidden = true; $('summary').hidden = false; $('setup').hidden = true; window.scrollTo(0, 0);
  const x = EX[prefs.ex]; $('sumEx').textContent = x.n;
  const card = $('sumCard');
  if (res.error) { card.innerHTML = '<p class="tip">' + esc(res.message || 'Couldn’t read the set.') + '</p>'; $('code').value = ''; $('copyBtn').disabled = true; return; }
  $('copyBtn').disabled = !res.n;
  let h = '<div class="row" style="justify-content:space-between;align-items:flex-end"><div class="big">' + res.n + '<small>rep' + (res.n === 1 ? '' : 's') + (res.per ? ' this side' : '') + '</small></div><div class="split">' + (res.n ? '<span class="g">' + res.nGood + ' full</span>' + (res.nPartial ? '<span class="p">' + res.nPartial + ' partial</span>' : '') : '<span class="n">No reps found</span>') + '</div></div>';
  h += chart(res);
  h += '<div class="chips">' + res.reps.map(p => '<span class="chip' + (p.partial ? ' p' : '') + (p.flags.length ? ' f' : '') + '"><b>' + p.i + '</b><small>' + (fmtVal(FormEngine.ruleFor(prefs.ex), p.ext) || (p.partial ? 'short' : 'full')) + '</small></span>').join('') + '</div>';
  const by = {}; res.reps.forEach(p => p.fails.concat(p.flags).forEach(c => (by[c] = by[c] || []).push(p.i)));
  const items = Object.keys(by).map(c => { const fail = res.reps.some(p => p.fails.includes(c)); return '<li class="' + (fail ? 'p' : 'f') + '"><i></i><span><b>' + esc(res.labels[c] || c) + '</b>' + (fail ? ' missed' : '') + ' on rep' + (by[c].length > 1 ? 's ' : ' ') + by[c].join(', ') + '</span></li>'; });
  if (res.n && !items.length) items.push('<li><i></i><span><b>Every rep hit the standard.</b></span></li>');
  if (items.length) h += '<ul class="issues">' + items.join('') + '</ul>';
  res.warn.forEach(w => { h += '<p class="note">' + esc(w) + '</p>'; });
  h += '<p class="note">Angles from a phone camera are estimates, give or take about 5–10°.</p>';
  card.innerHTML = h;
  $('code').value = res.n ? codeFor(res) : '';
  $('copyStatus').textContent = '';
}
$('copyBtn').addEventListener('click', () => {
  const t = $('code').value; if (!t) return;
  const done = ok => { $('copyStatus').textContent = ok ? 'Copied. Paste it in Daily Vitals → Gym.' : 'Select the code above and copy it.'; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => done(true), () => { $('code').select(); done(false); });
  else { $('code').select(); done(false); }
});
$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);
$('nextBtn').addEventListener('click', () => { $('summary').hidden = true; $('setup').hidden = false; start(); });
$('changeBtn').addEventListener('click', () => { $('summary').hidden = true; $('setup').hidden = false; $('startBtn').disabled = false; window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && running && !wake) { try { wake = await navigator.wakeLock.request('screen'); } catch (e) {} } });

function boot(){
  if (!window.FormEngine || !window.EXERCISES) { setTimeout(boot, 50); return; }
  fillSelect(); syncSeg();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('setupStatus').textContent = 'This browser can’t open the camera here. Open the page in Safari or Chrome.'; $('setupStatus').classList.add('err'); }
  if (window.tf) loadModel(() => {}).catch(() => {});   // start downloading early
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
window.__fc = { analyze:() => lastRes, track:() => track };
})();
