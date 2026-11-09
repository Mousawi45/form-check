/* Form engine: turns a clip's pose track into reps, range-of-motion verdicts and form flags.
   Pure functions, no DOM. Keypoints are COCO-17 [x,y,conf] in video pixels. */
(function (root) {
  'use strict';
  var KP = { nose:0, sh:[5, 6], el:[7, 8], wr:[9, 10], hp:[11, 12], kn:[13, 14], an:[15, 16] };
  var D = 180 / Math.PI;
  function P(k, i) { return k[i]; }                    // [x,y,c]
  function ang(a, b, c) {                               // angle at b, degrees
    var v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    var n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y); if (!n) return NaN;
    return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * D;
  }
  function vecAng(ax, ay, bx, by) { var n = Math.hypot(ax, ay) * Math.hypot(bx, by); if (!n) return NaN; return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / n))) * D; }
  function ok(k, idx, min) { for (var i = 0; i < idx.length; i++) if (!k[idx[i]] || k[idx[i]][2] < (min || 0.35)) return false; return true; }

  /* ---------- signals (s = 0 left, 1 right) ---------- */
  var SIG = {
    knee:  { need:['hp','kn','an'], f:function (k, s) { return ang(k[KP.hp[s]], k[KP.kn[s]], k[KP.an[s]]); } },
    kneeMin: { need:['hp','kn','an'], both:true, f:function (k) { var a = ok(k, [11, 13, 15]) ? ang(k[11], k[13], k[15]) : NaN, b = ok(k, [12, 14, 16]) ? ang(k[12], k[14], k[16]) : NaN; return isNaN(a) ? b : isNaN(b) ? a : Math.min(a, b); } },
    kneeMax: { need:['hp','kn','an'], both:true, f:function (k) { var a = ok(k, [11, 13, 15]) ? ang(k[11], k[13], k[15]) : NaN, b = ok(k, [12, 14, 16]) ? ang(k[12], k[14], k[16]) : NaN; return isNaN(a) ? b : isNaN(b) ? a : Math.max(a, b); } },
    thigh: { need:['hp','kn'], f:function (k, s) { var h = k[KP.hp[s]], n = k[KP.kn[s]]; return Math.atan2(n[1] - h[1], Math.max(Math.abs(h[0] - n[0]), 1e-6)) * D; } },
    hip:   { need:['sh','hp','kn'], f:function (k, s) { return ang(k[KP.sh[s]], k[KP.hp[s]], k[KP.kn[s]]); } },
    elbow: { need:['sh','el','wr'], f:function (k, s) { return ang(k[KP.sh[s]], k[KP.el[s]], k[KP.wr[s]]); } },
    torso: { need:['sh','hp'], f:function (k, s) { var a = k[KP.sh[s]], b = k[KP.hp[s]]; return Math.atan2(a[0] - b[0], b[1] - a[1]) * D; } },        // signed lean from vertical
    lean:  { need:['sh','hp'], f:function (k, s) { var a = k[KP.sh[s]], b = k[KP.hp[s]]; return Math.abs(Math.atan2(a[0] - b[0], b[1] - a[1]) * D); } },
    uarm:  { need:['sh','el','hp'], f:function (k, s) { var sh = k[KP.sh[s]], el = k[KP.el[s]], hp = k[KP.hp[s]]; return vecAng(hp[0] - sh[0], hp[1] - sh[1], el[0] - sh[0], el[1] - sh[1]); } },
    abdMax: { need:['sh','el','hp'], both:true, f:function (k) { var r = []; [0, 1].forEach(function (s) { if (ok(k, [KP.sh[s], KP.el[s], KP.hp[s]])) r.push(SIG.uarm.f(k, s)); }); return r.length ? Math.max.apply(null, r) : NaN; } },
    abdAvg: { need:['sh','el','hp'], both:true, f:function (k) { var r = []; [0, 1].forEach(function (s) { if (ok(k, [KP.sh[s], KP.el[s], KP.hp[s]])) r.push(SIG.uarm.f(k, s)); }); return r.length ? r.reduce(function (a, b) { return a + b; }, 0) / r.length : NaN; } },
    elbowMin: { need:['sh','el','wr'], both:true, f:function (k) { var r = []; [0, 1].forEach(function (s) { if (ok(k, [KP.sh[s], KP.el[s], KP.wr[s]])) r.push(SIG.elbow.f(k, s)); }); return r.length ? Math.min.apply(null, r) : NaN; } },
    wristSep: { need:['sh','wr'], both:true, f:function (k) { if (!ok(k, [5, 6, 9, 10])) return NaN; var sw = Math.hypot(k[5][0] - k[6][0], k[5][1] - k[6][1]); if (sw < 1) return NaN; return Math.hypot(k[9][0] - k[10][0], k[9][1] - k[10][1]) / sw; } },
    body:  { need:['sh','hp','an'], f:function (k, s) { return ang(k[KP.sh[s]], k[KP.hp[s]], k[KP.an[s]]); } },
    shin:  { need:['kn','an'], f:function (k, s) { var a = k[KP.kn[s]], b = k[KP.an[s]]; return Math.abs(Math.atan2(a[0] - b[0], b[1] - a[1]) * D); } },
    hipUp: { need:['sh','hp'], f:function (k, s) { return -k[KP.hp[s]][1]; }, norm:'torso' },
    kneeUp: { need:['kn','hp','sh'], f:function (k, s) { return -k[KP.kn[s]][1]; }, norm:'torso' },
    hipX:  { need:['sh','hp'], f:function (k, s) { return k[KP.hp[s]][0]; }, norm:'torso' }
  };
  function sigIdx(name, s) { var g = SIG[name].need, out = []; g.forEach(function (j) { var v = KP[j]; out.push(typeof v === 'number' ? v : v[s]); }); return out; }

  /* ---------- rules ----------
     Every check carries its evidence level and sources (see the Exercise Technique Evidence report).
     must = the stretched (or loaded) end; missing it makes the rep a partial.
     nice = the squeezed end; missing it makes a stretch partial (still counts), unless the rep falls under `floor`.
     flag = form fault that changes the target muscle or adds risk.  cue = the plan's own cue, little or no growth evidence. */
  var SRC = {
    pallares21:{ a:'Pallarés 2021', d:'10.1111/sms.14006' }, kassiano23r:{ a:'Kassiano 2023 (review)', d:'10.1519/JSC.0000000000004415' },
    wolf25:{ a:'Wolf 2025', d:'10.7717/peerj.18904' }, mcmahon26:{ a:'McMahon 2026', d:'10.1519/JSC.0000000000005561' },
    varovic25:{ a:'Varovic 2025', d:'10.1055/a-2615-4935' }, schoenfeld15:{ a:'Schoenfeld 2015', d:'10.1007/s40279-015-0304-0' },
    amdi25:{ a:'Amdi & King 2025', d:'10.1080/02640414.2025.2535198' }, kubo19:{ a:'Kubo 2019', d:'10.1007/s00421-019-04181-y' },
    bloom13:{ a:'Bloomquist 2013', d:'10.1007/s00421-013-2642-7' }, fry03:{ a:'Fry 2003', d:'10.1519/1533-4287(2003)017%3C0629:eokpoh%3E2.0.co;2' },
    pedrosa22:{ a:'Pedrosa 2022', d:'10.1080/17461391.2021.1927199' }, pedrosa23:{ a:'Pedrosa 2023', d:'10.3390/sports11020039' },
    havers25:{ a:'Havers 2025', d:'10.1002/ejsc.70087' }, pinto12:{ a:'Pinto 2012', d:'10.1519/JSC.0b013e31823a3b15' },
    morin25:{ a:'Morin 2025', d:'10.1519/JSC.0000000000005159' }, crawford25:{ a:'Crawford 2025', d:'10.1249/MSS.0000000000003701' },
    plotkin23:{ a:'Plotkin 2023', d:'10.3389/fphys.2023.1279170' }, maeo21:{ a:'Maeo 2021', d:'10.1249/MSS.0000000000002523' },
    maeo23:{ a:'Maeo 2023', d:'10.1080/17461391.2022.2100279' }, kassiano23c:{ a:'Kassiano 2023 (calves)', d:'10.1519/JSC.0000000000004460' },
    kinoshita23:{ a:'Kinoshita 2023', d:'10.3389/fphys.2023.1272106' }, larsen25:{ a:'Larsen 2025', d:'10.3389/fphys.2025.1611468' },
    difonza26:{ a:'Di Fonza 2026', d:'10.3390/jfmk11030315' }, augustin25:{ a:'Augustin 2025', d:'10.70252/GDBL2230' },
    yue26:{ a:'Yue 2026', d:'10.2196/102399' }, schoenfeld20:{ a:'Schoenfeld & Grgic 2020', d:'10.1177/2050312120901559' }
  };
  function chk(kind, code, label, test, ev, src, floor) { return { code:code, label:label, test:test, kind:kind, partial:kind === 'must' || kind === 'nice', ev:ev || 'low', src:src || [], floor:floor || null }; }
  function M(code, label, test, ev, src) { return chk('must', code, label, test, ev, src); }
  function N(code, label, test, floor, ev, src) { return chk('nice', code, label, test, ev, src, floor); }
  function F(code, label, test, ev, src) { return chk('flag', code, label, test, ev, src); }
  function Q(code, label, test, ev, src) { return chk('cue', code, label, test, ev, src); }
  var V_SIDE = 'side', V_FRONT = 'front';
  var TIP = {
    side:'Film from your side, phone about hip height and 2–3 m away, whole body in frame. The side nearest the camera is measured.',
    sideLow:'Film from your side with the phone at bench height, 2–3 m away, your whole body in frame.',
    front:'Film from the front, phone at chest height and 2–3 m away, both arms and your hips in frame.'
  };
  function R(o) { return o; }
  var ROMSRC = ['pallares21', 'kassiano23r', 'wolf25'];
  var TEMPO = Q('tempo', 'Lowered in under 1 s (your plan: 2–3 s)', function (r) { return r.ecc == null || r.ecc >= 1.0; }, 'strong', ['schoenfeld15', 'amdi25']);
  var SQUEEZE = Q('squeeze', 'No 1-second squeeze', function (r) { return r.holdExt >= 0.6; }, 'low', []);
  var SQUAT = R({ view:V_SIDE, sig:'thigh', ext:'min', unit:'°', what:'thigh angle', prom:22, ecc:'to', target:5, better:'lower',
    checks:[M('depth', 'Thighs at least parallel', function (r) { return r.ext <= 5; }, 'moderate', ['kubo19', 'bloom13']),
      N('stand', 'Stand all the way up', function (r) { return r.aux.kneeTop >= 150; }, function (r) { return r.aux.kneeTop >= 125; }, 'low', ROMSRC)],
    aux:{ kneeTop:['knee', 'maxAfter'] } });
  var LEGPRESS = R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:25, ecc:'to', target:95, better:'lower',
    checks:[M('depth', 'Knees to about 90°', function (r) { return r.ext <= 95; }, 'low', ['bloom13', 'pedrosa22']),
      N('press', 'Press most of the way out', function (r) { return r.other >= 135; }, function (r) { return r.other >= 115; }, 'low', ROMSRC),
      Q('lock', 'Knees locked out (safety cue)', function (r) { return r.other < 172; }, 'low', [])] });
  var LUNGE = R({ view:V_SIDE, sig:'kneeMin', ext:'min', unit:'°', what:'front knee angle', prom:22, ecc:'to', target:100, better:'lower',
    checks:[M('depth', 'Front knee to about 90°', function (r) { return r.ext <= 100; }, 'low', ['kubo19', 'bloom13']),
      N('stand', 'Stand back up', function (r) { return r.other >= 150; }, function (r) { return r.other >= 125; }, 'low', ROMSRC)] });
  var HINGE_SQUAT = F('squat', 'Knees bent too much (turns it into a squat)', function (r) { return r.aux.kneeAt >= 130; }, 'low', ['morin25', 'crawford25']);
  var HINGE = R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:25, ecc:'to', target:115, better:'lower',
    checks:[M('depth', 'Hips back to a hamstring stretch', function (r) { return r.ext <= 115; }, 'low', ['morin25', 'crawford25']),
      N('stand', 'Stand tall at the top', function (r) { return r.other >= 160; }, function (r) { return r.other >= 140; }, 'low', ROMSRC), HINGE_SQUAT],
    aux:{ kneeAt:['knee', 'atExt'] } });
  var THRUST = R({ view:V_SIDE, sig:'hip', ext:'max', unit:'°', what:'hip angle', prom:22, ecc:'from', target:165, better:'higher',
    checks:[M('top', 'Hips to a straight line', function (r) { return r.ext >= 165; }, 'moderate', ['plotkin23']), SQUEEZE,
      Q('shin', 'Shins not vertical at the top', function (r) { return r.aux.shinAt <= 22; }, 'low', [])],
    aux:{ shinAt:['shin', 'atExt'] } });
  var CURLPAT = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:35, ecc:'from', target:70, better:'lower',
    checks:[M('bottom', 'Lower to straight arms', function (r) { return r.other >= 145; }, 'moderate', ['pedrosa23', 'havers25', 'pinto12']),
      N('top', 'Curl all the way up', function (r) { return r.ext <= 70; }, function (r) { return r.ext <= 100; }, 'moderate', ['pedrosa23', 'havers25']),
      Q('drift', 'Elbows drifting forward', function (r) { return r.aux.uarm <= 25; }, 'moderate', ['augustin25']),
      Q('swing', 'Swinging the body', function (r) { return r.aux.torso <= 10; }, 'moderate', ['augustin25'])],
    aux:{ uarm:['uarm', 'range'], torso:['torso', 'range'] } }, o || {})); };
  var PRESS_DEPTH = M('depth', 'Lower to a chest stretch', function (r) { return r.ext <= 100; }, 'low', ['wolf25']);
  var PRESS_LOCK = N('lockout', 'Press until nearly straight', function (r) { return r.other >= 150; }, function (r) { return r.other >= 125; }, 'low', ROMSRC);
  var PRESS = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:30, ecc:'to', target:100, better:'lower', tip:'sideLow',
    checks:[PRESS_DEPTH, PRESS_LOCK] }, o || {})); };
  var VPRESS = R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:150, better:'higher',
    checks:[M('bottom', 'Lower to chin height', function (r) { return r.other <= 100; }, 'low', ROMSRC),
      N('lockout', 'Press until nearly straight overhead', function (r) { return r.ext >= 150; }, function (r) { return r.ext >= 125; }, 'low', ROMSRC), TEMPO,
      F('arch', 'Arching off the pad (turns it into an incline press)', function (r) { return r.aux.torso <= 12; }, 'low', [])],
    aux:{ torso:['torso', 'range'] } });
  var ROW_REACH = M('reach', 'Return to a full reach', function (r) { return r.other >= 145; }, 'low', ['wolf25']);
  var ROW_PULL = N('pull', 'Pull elbows back past your torso', function (r) { return r.ext <= 100; }, function (r) { return r.ext <= 125; }, 'low', ['difonza26']);
  var ROW = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:100, better:'lower',
    checks:[ROW_REACH, ROW_PULL] }, o || {})); };
  var PULL_STRETCH = M('stretch', 'Full stretch at the top', function (r) { return r.other >= 150; }, 'low', ['wolf25']);
  var PULL_LEAN = F('lean', 'Leaning back too far', function (r) { return r.aux.lean <= 30; }, 'low', ['difonza26']);
  var VPULL = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:35, ecc:'from', target:85, better:'lower',
    checks:[PULL_STRETCH, N('pull', 'Pull to the upper chest', function (r) { return r.ext <= 85; }, function (r) { return r.ext <= 115; }, 'low', ['difonza26'])] }, o || {})); };
  var FLY = function (o) { return R(Object.assign({ view:V_FRONT, sig:'wristSep', ext:'min', unit:'×', what:'hand gap (shoulder widths)', rel:true, prom:0.35, ecc:'from', better:'lower',
    checks:[F('elbow', 'Elbow angle changing (turns it into a press)', function (r) { return r.aux.elbow <= 30; }, 'low', [])], aux:{ elbow:['elbowMin', 'range'] } }, o || {})); };
  var REAR = R({ view:V_FRONT, sig:'wristSep', ext:'max', unit:'×', what:'hand gap (shoulder widths)', rel:true, prom:0.35, ecc:'from', better:'higher', checks:[] });
  var LATERAL = function (sig) { return R({ view:V_FRONT, sig:sig, ext:'max', unit:'°', what:'arm angle from your side', prom:30, ecc:'from', target:70, better:'higher',
    checks:[N('height', 'Raise to about shoulder height', function (r) { return r.ext >= 70; }, function (r) { return r.ext >= 45; }, 'low', ['larsen25']),
      F('high', 'Raised well above shoulder height', function (r) { return r.ext < 110; }, 'low', []), TEMPO,
      F('swing', 'Swinging the body', function (r) { return r.aux.torso <= 10; }, 'low', [])],
    aux:{ torso:['torso', 'range'] } }); };
  var PUSHDOWN = R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:160, better:'higher',
    checks:[M('return', 'Let forearms rise past horizontal', function (r) { return r.other <= 100; }, 'moderate', ['maeo23', 'kassiano23r']),
      N('lockout', 'Push to fully straight', function (r) { return r.ext >= 160; }, function (r) { return r.ext >= 135; }, 'low', ROMSRC),
      Q('drift', 'Elbows drifting from your sides', function (r) { return r.aux.uarm <= 20; }, 'moderate', ['augustin25']),
      Q('lean', 'Leaning into it', function (r) { return r.aux.torso <= 12; }, 'moderate', ['augustin25'])],
    aux:{ uarm:['uarm', 'range'], torso:['torso', 'range'] } });
  var OHEXT = R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:155, better:'higher',
    checks:[M('stretch', 'Deep elbow bend behind your head', function (r) { return r.other <= 75; }, 'moderate', ['maeo23']),
      N('lockout', 'Straighten your arms', function (r) { return r.ext >= 155; }, function (r) { return r.ext >= 130; }, 'low', ROMSRC),
      Q('drift', 'Upper arms moving', function (r) { return r.aux.uarm <= 20; }, 'moderate', ['augustin25'])],
    aux:{ uarm:['uarm', 'range'] } });
  var CALF = function (sig) { return R({ view:V_SIDE, sig:sig, ext:'max', unit:'', what:'heel height', rel:true, prom:0.06, ecc:'from', better:'higher', relEv:'moderate', relSrc:['kassiano23c', 'kinoshita23'],
    checks:[Q('pause', 'No pause in the stretch at the bottom', function (r) { return r.holdOther >= 0.7; }, 'low', [])] }); };
  var KNEERAISE = R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:30, ecc:'from', target:80, better:'lower',
    checks:[M('height', 'Knees above hip level', function (r) { return r.ext <= 80; }, 'low', ['schoenfeld20']),
      N('return', 'Lower all the way', function (r) { return r.other >= 145; }, function (r) { return r.other >= 120; }, 'low', ['schoenfeld20']),
      Q('swing', 'Swinging', function (r) { return r.aux.torso <= 15; }, 'low', [])],
    aux:{ torso:['torso', 'range'] } });
  var BACKEXT = R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:25, ecc:'to', target:120, better:'lower',
    checks:[M('depth', 'Hinge down to a hamstring stretch', function (r) { return r.ext <= 120; }, 'low', ['morin25', 'crawford25']),
      N('top', 'Rise to a straight line', function (r) { return r.other >= 165; }, function (r) { return r.other >= 145; }, 'low', ROMSRC)] });

  var RULES = {
    hack:SQUAT, smith_squat:SQUAT, bb_squat:SQUAT, goblet:SQUAT,
    leg_press:LEGPRESS, sl_leg_press:Object.assign({}, LEGPRESS, { per:true }),
    db_split:Object.assign({}, LUNGE, { per:true }), bulgarian:Object.assign({}, LUNGE, { per:true }),
    walking_lunge:Object.assign({}, LUNGE, { per:true, note:'You walk out of frame on walking lunges, so only the reps the camera sees are counted.' }),
    step_up:R({ view:V_SIDE, sig:'hipUp', ext:'max', unit:'', what:'hip height', rel:true, prom:0.25, ecc:'from', per:true, better:'higher',
      checks:[M('stand', 'Stand tall on the box', function (r) { return r.aux.kneeTop >= 160; }, 'low', [])], aux:{ kneeTop:['kneeMax', 'atExt'] } }),
    db_rdl:HINGE, bb_rdl:HINGE, smith_rdl:HINGE,
    cable_pullthrough:Object.assign({}, HINGE, { target:120, checks:[M('depth', 'Hinge back to a hamstring stretch', function (r) { return r.ext <= 120; }, 'low', ['morin25', 'crawford25']),
      N('stand', 'Drive the hips all the way through', function (r) { return r.other >= 160; }, function (r) { return r.other >= 140; }, 'low', ROMSRC), HINGE_SQUAT] }),
    back_ext:BACKEXT,
    ht_mc:THRUST, bb_ht:THRUST, smith_ht:THRUST,
    leg_ext:R({ view:V_SIDE, sig:'knee', ext:'max', unit:'°', what:'knee angle', prom:30, ecc:'from', target:160, better:'higher',
      checks:[M('bottom', 'Lower until fully bent', function (r) { return r.other <= 100; }, 'moderate', ['pedrosa22', 'mcmahon26']),
        N('top', 'Straighten fully', function (r) { return r.ext >= 160; }, function (r) { return r.ext >= 130; }, 'moderate', ['pedrosa22', 'mcmahon26']), SQUEEZE,
        F('hips', 'Hips lifting off the seat', function (r) { return r.aux.hip <= 15; }, 'low', [])],
      aux:{ hip:['hip', 'range'] } }),
    seated_curl:R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:30, ecc:'from', target:75, better:'lower',
      checks:[M('return', 'Return to nearly straight', function (r) { return r.other >= 150; }, 'moderate', ['maeo21']),
        N('curl', 'Heels under the seat as far as they go', function (r) { return r.ext <= 75; }, function (r) { return r.ext <= 110; }, 'low', ROMSRC)] }),
    lying_curl:R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:30, ecc:'from', target:80, better:'lower',
      checks:[M('return', 'Lower to nearly straight', function (r) { return r.other >= 150; }, 'moderate', ['maeo21']),
        N('curl', 'Curl heels toward your glutes', function (r) { return r.ext <= 80; }, function (r) { return r.ext <= 115; }, 'low', ROMSRC), TEMPO,
        F('hips', 'Hips rising off the bench', function (r) { return r.aux.hip <= 15; }, 'low', [])],
      aux:{ hip:['hip', 'range'] } }),
    ball_curl:R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:30, ecc:'from', target:90, better:'lower',
      checks:[M('return', 'Roll back out to straight legs', function (r) { return r.other >= 150; }, 'moderate', ['maeo21']),
        N('curl', 'Roll the ball all the way in', function (r) { return r.ext <= 90; }, function (r) { return r.ext <= 120; }, 'low', ROMSRC),
        F('hips', 'Hips dropping', function (r) { return r.aux.hipAt >= 145; }, 'low', [])],
      aux:{ hipAt:['hip', 'atExt'] } }),
    standing_calf:CALF('hipUp'), sl_db_calf:Object.assign({}, CALF('hipUp'), { per:true }), seated_calf:CALF('kneeUp'),
    lp_calf:{ none:'The camera can’t see your ankles bend on the leg press, so this one can’t be checked from video.' },
    ab_crunch_mc:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'trunk angle', rel:true, prom:12, ecc:'from', better:'lower', relSrc:['schoenfeld20'], checks:[] }),
    cable_crunch:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'trunk angle', rel:true, prom:12, ecc:'from', better:'lower', relSrc:['schoenfeld20'],
      checks:[Q('sitback', 'Sitting back on your heels', function (r) { return r.aux.hipX <= 0.25; }, 'low', [])], aux:{ hipX:['hipX', 'range'] } }),
    captain:KNEERAISE, hanging_kr:KNEERAISE,
    leg_raise:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:30, ecc:'from', target:100, better:'lower',
      checks:[M('height', 'Legs up to vertical', function (r) { return r.ext <= 100; }, 'low', ['schoenfeld20']),
        N('return', 'Lower the legs back down', function (r) { return r.other >= 150; }, function (r) { return r.other >= 125; }, 'low', ['schoenfeld20']),
        Q('knees', 'Knees bending', function (r) { return r.aux.kneeAt >= 145; }, 'low', [])],
      aux:{ kneeAt:['knee', 'atExt'] } }),
    dead_bug:R({ view:V_SIDE, sig:'kneeMax', ext:'max', unit:'°', what:'leg reach', rel:true, prom:30, ecc:'from', per:true, better:'higher', checks:[] }),
    pushup:PRESS({ tip:'side', checks:[M('depth', 'Chest down to a fist from the floor', function (r) { return r.ext <= 100; }, 'low', ['wolf25']),
      N('lockout', 'Press back to straight arms', function (r) { return r.other >= 155; }, function (r) { return r.other >= 130; }, 'low', ROMSRC),
      F('line', 'Hips sagging or piking', function (r) { return r.aux.body >= 155; }, 'low', [])], aux:{ body:['body', 'minWin'] } }),
    mc_press:PRESS({ checks:[PRESS_DEPTH, PRESS_LOCK, TEMPO] }),
    db_bench:PRESS(), smith_bench:PRESS(), bb_bench:PRESS(),
    mc_incline:PRESS({ checks:[M('depth', 'Lower to an upper-chest stretch', function (r) { return r.ext <= 100; }, 'low', ['wolf25']), PRESS_LOCK, TEMPO] }),
    db_incline:PRESS(), smith_incline:PRESS(),
    mc_dip:R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:155, better:'higher',
      checks:[M('return', 'Come back up to about 90°', function (r) { return r.other <= 100; }, 'low', ['maeo23']),
        N('lockout', 'Press down to straight arms', function (r) { return r.ext >= 155; }, function (r) { return r.ext >= 130; }, 'low', ROMSRC)] }),
    mc_shoulder:VPRESS, db_shoulder:VPRESS, smith_ohp:VPRESS,
    cs_row:ROW({ checks:[ROW_REACH, ROW_PULL, F('pad', 'Lifting off the pad', function (r) { return r.aux.torso <= 15; }, 'low', []), Q('squeeze', 'No 1-second squeeze', function (r) { return r.holdExt >= 0.5; }, 'low', [])], aux:{ torso:['torso', 'range'] } }),
    db_cs_row:ROW({ checks:[ROW_REACH, ROW_PULL, F('pad', 'Chest lifting off the bench', function (r) { return r.aux.torso <= 15; }, 'low', []), Q('squeeze', 'No 1-second squeeze', function (r) { return r.holdExt >= 0.5; }, 'low', [])], aux:{ torso:['torso', 'range'] } }),
    cable_row:ROW({ checks:[ROW_REACH, ROW_PULL, F('rock', 'Rocking back and forth', function (r) { return r.aux.torso <= 20; }, 'low', ['difonza26'])], aux:{ torso:['torso', 'range'] } }),
    db_row:ROW(),
    pulldown:VPULL({ checks:VPULL().checks.concat([PULL_LEAN]), aux:{ lean:['lean', 'maxWin'] } }),
    ng_pulldown:VPULL({ checks:VPULL().checks.concat([PULL_LEAN]), aux:{ lean:['lean', 'maxWin'] } }),
    assisted_pu:VPULL({ target:75, checks:[PULL_STRETCH, N('pull', 'Pull your chest toward the bar', function (r) { return r.ext <= 75; }, function (r) { return r.ext <= 110; }, 'low', [])] }),
    band_pu:VPULL({ target:75, checks:[PULL_STRETCH, N('pull', 'Chin over the bar', function (r) { return r.ext <= 75; }, function (r) { return r.ext <= 110; }, 'low', [])] }),
    pec_deck:FLY({ checks:[FLY().checks[0], SQUEEZE] }), cable_fly:FLY(), db_fly:FLY(),
    rear_deck:REAR, face_pull:REAR, db_rear:REAR,
    cable_lat:LATERAL('abdMax'), mc_lat:LATERAL('abdAvg'), db_lat:LATERAL('abdAvg'),
    pushdown:PUSHDOWN, oh_cable_ext:OHEXT, db_oh_ext:OHEXT,
    cable_curl:CURLPAT({ checks:CURLPAT().checks.concat([TEMPO]) }), db_curl:CURLPAT(), incline_db_curl:CURLPAT(), hammer:CURLPAT(),
    preacher_mc:CURLPAT({ checks:[M('bottom', 'Lower until nearly straight', function (r) { return r.other >= 140; }, 'moderate', ['pedrosa23', 'havers25']),
      N('top', 'Curl all the way up', function (r) { return r.ext <= 70; }, function (r) { return r.ext <= 100; }, 'moderate', ['pedrosa23', 'havers25'])], aux:{} })
  };
  function ruleFor(id) { return RULES[id] || null; }
  /* The checks of a rule as plain data for the UI: label, kind, evidence level, sources with links. */
  function metaFor(rule) {
    if (!rule || rule.none) return [];
    var out = (rule.checks || []).map(function (c) { return { code:c.code, label:c.label, kind:c.kind, ev:c.ev, src:(c.src || []).map(srcOf).filter(Boolean) }; });
    if (rule.rel) out.push({ code:'short', label:'Under 70% of your best reps’ range', kind:'must', ev:rule.relEv || 'low', src:(rule.relSrc || ['pallares21', 'kassiano23r']).map(srcOf).filter(Boolean) });
    return out;
  }
  function srcOf(k) { var s = SRC[k]; return s ? { a:s.a, url:'https://doi.org/' + s.d } : null; }
  function tipFor(rule) { return TIP[rule.tip || rule.view] || TIP.side; }

  /* ---------- signal processing ---------- */
  function median(a) { var b = a.filter(function (x) { return !isNaN(x); }).sort(function (x, y) { return x - y; }); if (!b.length) return NaN; var m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function pct(a, p) { var b = a.filter(function (x) { return !isNaN(x); }).sort(function (x, y) { return x - y; }); if (!b.length) return NaN; return b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))]; }
  function fillGaps(a, maxGap) {
    var out = a.slice(), n = a.length, i = 0;
    while (i < n) {
      if (!isNaN(out[i])) { i++; continue; }
      var j = i; while (j < n && isNaN(out[j])) j++;
      var L = i - 1, Rr = j;
      if (L >= 0 && Rr < n && (j - i) <= maxGap) for (var q = i; q < j; q++) out[q] = out[L] + (out[Rr] - out[L]) * (q - L) / (Rr - L);
      i = j;
    }
    return out;
  }
  function smooth(a, win) {
    var n = a.length, med = new Array(n), out = new Array(n), h = Math.max(1, win >> 1);
    for (var i = 0; i < n; i++) { med[i] = isNaN(a[i]) ? NaN : median([a[i - 1], a[i], a[i + 1]].map(function (v) { return v == null ? NaN : v; })); if (isNaN(med[i])) med[i] = a[i]; }
    for (var j = 0; j < n; j++) { var s = 0, c = 0; for (var k = j - h; k <= j + h; k++) if (k >= 0 && k < n && !isNaN(med[k])) { s += med[k]; c++; } out[j] = c ? s / c : NaN; }
    return out;
  }
  /* peaks of y (maxima) with topographic prominence >= prom and spacing >= dist samples */
  function peaks(y, prom, dist) {
    var n = y.length, cand = [];
    for (var i = 1; i < n - 1; i++) {
      if (isNaN(y[i]) || !(isNaN(y[i - 1]) || y[i] > y[i - 1])) continue;
      var j = i; while (j + 1 < n && y[j + 1] === y[i]) j++;        // plateau
      if (j + 1 >= n || (!isNaN(y[j + 1]) && y[j + 1] > y[i])) continue;
      var lm = y[i], k; for (k = i - 1; k >= 0 && !(y[k] > y[i]); k--) if (!isNaN(y[k]) && y[k] < lm) lm = y[k];
      var rm = y[i]; for (k = j + 1; k < n && !(y[k] > y[i]); k++) if (!isNaN(y[k]) && y[k] < rm) rm = y[k];
      var p = y[i] - Math.max(lm, rm);
      if (p >= prom) cand.push({ i:(i + j) >> 1, p:p });
      i = j;
    }
    cand.sort(function (a, b) { return b.p - a.p; });
    var keep = [];
    cand.forEach(function (c) { if (keep.every(function (k) { return Math.abs(k.i - c.i) >= dist; })) keep.push(c); });
    return keep.map(function (c) { return c.i; }).sort(function (a, b) { return a - b; });
  }

  /* ---------- analysis ---------- */
  /* track: [{t:sec, k:[[x,y,c]x17] | null}], id: exercise id. */
  function analyze(track, id) {
    var rule = ruleFor(id);
    if (!rule) return { error:'no-rule' };
    if (rule.none) return { error:'unsupported', message:rule.none };
    var n = track.length;
    if (n < 8) return { error:'short', message:'The clip is too short. Record the whole set.' };
    var dt = (track[n - 1].t - track[0].t) / Math.max(1, n - 1), fps = dt > 0 ? 1 / dt : 10;
    // side: the one the camera sees best for the main signal
    var sig = SIG[rule.sig], side = 0;
    if (!sig.both) {
      var sc = [0, 0];
      track.forEach(function (f) { if (!f.k) return; [0, 1].forEach(function (s) { sigIdx(rule.sig, s).forEach(function (j) { sc[s] += f.k[j][2]; }); }); });
      side = sc[1] > sc[0] ? 1 : 0;
    }
    function series(name) {
      var sg = SIG[name], idx = sg.both ? null : sigIdx(name, side);
      return track.map(function (f) { if (!f.k) return NaN; if (idx && !ok(f.k, idx)) return NaN; var v = sg.f(f.k, side); return isFinite(v) ? v : NaN; });
    }
    // body scale for normalised signals
    var torsoLen = median(track.map(function (f) { if (!f.k || !ok(f.k, [KP.sh[side], KP.hp[side]])) return NaN; var a = f.k[KP.sh[side]], b = f.k[KP.hp[side]]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }));
    function prep(name) {
      var a = series(name);
      if (SIG[name].norm === 'torso' && torsoLen > 0) a = a.map(function (v) { return v / torsoLen; });
      return smooth(fillGaps(a, Math.round(fps * 0.5)), Math.max(3, Math.round(fps * 0.25)));
    }
    var y = prep(rule.sig);
    var have = y.filter(function (v) { return !isNaN(v); }).length, coverage = have / n;
    if (coverage < 0.4) return { error:'tracking', message:'The camera couldn’t follow your ' + (rule.view === V_FRONT ? 'arms' : 'body') + ' through most of the clip. ' + tipFor(rule), coverage:coverage };
    var lo = pct(y, 0.05), hi = pct(y, 0.95), span = hi - lo;
    var prom = rule.rel ? Math.max(rule.prom, span * 0.35) : rule.prom;
    var yy = rule.ext === 'min' ? y.map(function (v) { return -v; }) : y;
    var ev = peaks(yy, prom, Math.max(2, Math.round(fps * 0.6)));
    // camera angle sanity
    var warn = [];
    var sepRatio = median(track.map(function (f) { if (!f.k || !ok(f.k, [5, 6]) || !(torsoLen > 0)) return NaN; return Math.abs(f.k[5][0] - f.k[6][0]) / torsoLen; }));
    if (rule.view === V_SIDE && sepRatio > 0.55) warn.push('The camera looks angled rather than side-on, so angles may be off. ' + tipFor(rule));
    if (rule.view === V_FRONT && sepRatio < 0.35) warn.push('This one reads best from the front. ' + tipFor(rule));
    if (coverage < 0.7) warn.push('Tracking was patchy in parts of the clip, so treat these numbers as rough.');
    if (rule.note) warn.push(rule.note);
    var auxS = {};
    Object.keys(rule.aux || {}).forEach(function (k) { var nm = rule.aux[k][0]; if (!auxS[nm]) auxS[nm] = prep(nm); });
    var reps = ev.map(function (e, r) {
      var a = r ? Math.round((ev[r - 1] + e) / 2) : 0, b = r < ev.length - 1 ? Math.round((e + ev[r + 1]) / 2) : n - 1;
      var before = y.slice(a, e + 1), after = y.slice(e, b + 1);
      var opp = rule.ext === 'min' ? Math.max : Math.min;
      function oppOf(seg) { var v = seg.filter(function (x) { return !isNaN(x); }); return v.length ? opp.apply(null, v) : NaN; }
      var rep = { i:r + 1, e:e, t:track[e].t, ext:y[e], other:oppOf(after), otherBefore:oppOf(before), a:a, b:b, aux:{} };
      var range = Math.abs(rep.ext - (isNaN(rep.other) ? rep.otherBefore : rep.other));
      rep.range = range;
      // eccentric time: 'to' = moving into the extreme (before half), 'from' = moving out of it (after half)
      function cross(seg, t0, from, to) { // time from leaving 'from' band to reaching 'to' band (15%/85% of range)
        if (!(range > 0)) return null;
        var s0 = -1, s1 = -1;
        for (var q = 0; q < seg.length; q++) {
          var fr = Math.abs(seg[q] - from) / range;
          if (s0 < 0 && fr > 0.1) s0 = q;
          if (s0 >= 0 && Math.abs(seg[q] - to) / range < 0.1) { s1 = q; break; }
        }
        return s0 >= 0 && s1 > s0 ? (s1 - s0) * dt / 0.8 : null;   // 10%->90% of the travel, scaled to the whole
      }
      rep.ecc = rule.ecc === 'to' ? cross(before, 0, rep.otherBefore, rep.ext) : cross(after, 0, rep.ext, rep.other);
      function hold(center, val, lim) { var band = Math.max(range * 0.06, 2.5 * (rule.rel ? range / 40 : 1)), c = 0, q; for (q = center; q >= lim[0] && Math.abs(y[q] - val) <= band; q--) c++; for (q = center + 1; q <= lim[1] && Math.abs(y[q] - val) <= band; q++) c++; return Math.max(0, c - 1) * dt; }
      rep.holdExt = range > 0 ? hold(e, rep.ext, [a, b]) : 0;
      var oi = -1; for (var q2 = e; q2 <= b; q2++) if (y[q2] === rep.other) { oi = q2; break; }
      rep.holdOther = oi >= 0 && range > 0 ? hold(oi, rep.other, [e, b]) : 0;
      Object.keys(rule.aux || {}).forEach(function (k) {
        var spec = rule.aux[k], s = auxS[spec[0]], mode = spec[1], seg, v;
        if (mode === 'atExt') v = s[e];
        else if (mode === 'maxAfter') { seg = s.slice(e, b + 1).filter(function (x) { return !isNaN(x); }); v = seg.length ? Math.max.apply(null, seg) : NaN; }
        else { seg = s.slice(a, b + 1).filter(function (x) { return !isNaN(x); });
          v = !seg.length ? NaN : mode === 'range' ? Math.max.apply(null, seg) - Math.min.apply(null, seg) : mode === 'minWin' ? Math.min.apply(null, seg) : Math.max.apply(null, seg); }
        rep.aux[k] = v;
      });
      return rep;
    });
    // relative range: partial when under 70% of the set's best reps
    var best = null;
    if (rule.rel && reps.length) { var rs = reps.map(function (r) { return r.range; }).sort(function (a, b) { return b - a; }); best = median(rs.slice(0, Math.min(3, rs.length))); }
    var flagCount = {}, cueCount = {};
    function safe(fn, r) { try { return !!fn(r); } catch (e) { return true; } }
    reps.forEach(function (r) {
      r.fails = []; r.spFails = []; r.flags = []; r.cues = [];
      var auxBad = Object.keys(r.aux).some(function (k) { return !isFinite(r.aux[k]); });
      (rule.checks || []).forEach(function (c) {
        if (safe(c.test, r)) return;
        if (c.kind === 'must') r.fails.push(c.code);
        else if (c.kind === 'nice') { if (!c.floor || safe(c.floor, r)) r.spFails.push(c.code); else r.fails.push(c.code); }
        else if (auxBad && Object.keys(r.aux).length) return;
        else if (c.kind === 'flag') { r.flags.push(c.code); flagCount[c.code] = (flagCount[c.code] || 0) + 1; }
        else { r.cues.push(c.code); cueCount[c.code] = (cueCount[c.code] || 0) + 1; }
      });
      if (best && r.range < best * 0.7) r.fails.push('short');
      r.partial = r.fails.length > 0; r.sp = !r.partial && r.spFails.length > 0;
    });
    var meta = metaFor(rule), labels = {}, kinds = {};
    meta.forEach(function (m) { labels[m.code] = m.label; kinds[m.code] = m.kind; });
    var nP = reps.filter(function (r) { return r.partial; }).length, nS = reps.filter(function (r) { return r.sp; }).length;
    return { id:id, view:rule.view, side:side ? 'right' : 'left', fps:Math.round(fps), coverage:coverage, n:reps.length, nGood:reps.length - nP - nS, nSp:nS, nPartial:nP,
      reps:reps, flags:flagCount, cues:cueCount, labels:labels, kinds:kinds, meta:meta, warn:warn, rel:!!rule.rel, unit:rule.unit, what:rule.what, target:rule.target, better:rule.better, per:!!rule.per,
      series:y, times:track.map(function (f) { return f.t; }), duration:track[n - 1].t - track[0].t };
  }

  var API = { analyze:analyze, ruleFor:ruleFor, tipFor:tipFor, metaFor:function (id) { return metaFor(ruleFor(id)); }, RULES:RULES, SRC:SRC, SIG:SIG, _peaks:peaks };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.FormEngine = API;
})(typeof window !== 'undefined' ? window : this);
