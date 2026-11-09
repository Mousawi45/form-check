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

  /* ---------- rules ---------- */
  function C(code, label, test, partial) { return { code:code, label:label, test:test, partial:!!partial }; }
  var V_SIDE = 'side', V_FRONT = 'front';
  var TIP = {
    side:'Film from your side, phone about hip height and 2–3 m away, whole body in frame. The side nearest the camera is measured.',
    sideLow:'Film from your side with the phone at bench height, 2–3 m away, your whole body in frame.',
    front:'Film from the front, phone at chest height and 2–3 m away, both arms and your hips in frame.'
  };
  function R(o) { return o; }
  var SQUAT = R({ view:V_SIDE, sig:'thigh', ext:'min', unit:'°', what:'thigh angle', zero:'parallel', prom:22, ecc:'to',
    checks:[C('depth', 'Thighs at least parallel', function (r) { return r.ext <= 5; }, true), C('stand', 'Stand all the way up', function (r) { return r.aux.kneeTop >= 150; }, true)],
    aux:{ kneeTop:['knee', 'maxAfter'] }, show:function (v) { return (v > 0 ? '+' : '') + Math.round(v) + '°'; }, target:5, better:'lower' });
  var LEGPRESS = R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:25, ecc:'to',
    checks:[C('depth', 'Knees to about 90°', function (r) { return r.ext <= 95; }, true), C('press', 'Press most of the way out', function (r) { return r.other >= 135; }, true), C('lock', 'Knees locked out at the top', function (r) { return r.other < 172; })],
    target:95, better:'lower' });
  var LUNGE = R({ view:V_SIDE, sig:'kneeMin', ext:'min', unit:'°', what:'front knee angle', prom:22, ecc:'to',
    checks:[C('depth', 'Front knee to about 90°', function (r) { return r.ext <= 100; }, true), C('stand', 'Stand back up', function (r) { return r.other >= 150; }, true)], target:100, better:'lower' });
  var HINGE = R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:25, ecc:'to',
    checks:[C('depth', 'Hips back to a hamstring stretch', function (r) { return r.ext <= 115; }, true), C('stand', 'Stand tall at the top', function (r) { return r.other >= 160; }, true), C('squat', 'Knees bent too much (turning it into a squat)', function (r) { return r.aux.kneeAt >= 130; })],
    aux:{ kneeAt:['knee', 'atExt'] }, target:115, better:'lower' });
  var THRUST = R({ view:V_SIDE, sig:'hip', ext:'max', unit:'°', what:'hip angle', prom:22, ecc:'from',
    checks:[C('top', 'Hips to a straight line', function (r) { return r.ext >= 165; }, true), C('squeeze', 'Squeeze about 1 s at the top', function (r) { return r.holdExt >= 0.6; }), C('shin', 'Shins about vertical at the top', function (r) { return r.aux.shinAt <= 22; })],
    aux:{ shinAt:['shin', 'atExt'] }, target:165, better:'higher' });
  var CURLPAT = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:35, ecc:'from', target:70, better:'lower',
    checks:[C('top', 'Curl all the way up', function (r) { return r.ext <= 70; }, true), C('bottom', 'Lower to straight arms', function (r) { return r.other >= 145; }, true), C('drift', 'Elbows drifting forward', function (r) { return r.aux.uarm <= 25; }), C('swing', 'Swinging the body', function (r) { return r.aux.torso <= 10; })],
    aux:{ uarm:['uarm', 'range'], torso:['torso', 'range'] } }, o || {})); };
  var PRESS = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:30, ecc:'to', target:100, better:'lower',
    checks:[C('depth', 'Lower to a chest stretch', function (r) { return r.ext <= 100; }, true), C('lockout', 'Press until nearly straight', function (r) { return r.other >= 150; }, true)] }, o || {})); };
  var tempoCheck = function (sec) { return C('tempo', 'Lowering faster than ' + sec + ' s', function (r) { return r.ecc == null || r.ecc >= sec * 0.75; }); };
  var VPRESS = R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:150, better:'higher',
    checks:[C('lockout', 'Press until nearly straight overhead', function (r) { return r.ext >= 150; }, true), C('bottom', 'Lower to chin height', function (r) { return r.other <= 100; }, true), tempoCheck(2), C('arch', 'Arching off the pad', function (r) { return r.aux.torso <= 12; })],
    aux:{ torso:['torso', 'range'] } });
  var ROW = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:100, better:'lower',
    checks:[C('pull', 'Pull elbows back past your torso', function (r) { return r.ext <= 100; }, true), C('reach', 'Return to a full reach', function (r) { return r.other >= 145; }, true)] }, o || {})); };
  var VPULL = function (o) { return R(Object.assign({ view:V_SIDE, sig:'elbow', ext:'min', unit:'°', what:'elbow angle', prom:35, ecc:'from', target:85, better:'lower',
    checks:[C('pull', 'Pull to the upper chest', function (r) { return r.ext <= 85; }, true), C('stretch', 'Full stretch at the top', function (r) { return r.other >= 150; }, true)] }, o || {})); };
  var FLY = function (o) { return R(Object.assign({ view:V_FRONT, sig:'wristSep', ext:'min', unit:'×', what:'hand gap (shoulder widths)', rel:true, prom:0.35, ecc:'from', better:'lower',
    checks:[C('elbow', 'Elbow angle changing (turning it into a press)', function (r) { return r.aux.elbow <= 30; })], aux:{ elbow:['elbowMin', 'range'] } }, o || {})); };
  var REAR = R({ view:V_FRONT, sig:'wristSep', ext:'max', unit:'×', what:'hand gap (shoulder widths)', rel:true, prom:0.35, ecc:'from', better:'higher', checks:[] });
  var LATERAL = function (sig) { return R({ view:V_FRONT, sig:sig, ext:'max', unit:'°', what:'arm angle from your side', prom:30, ecc:'from', target:70, better:'higher',
    checks:[C('height', 'Raise to shoulder height', function (r) { return r.ext >= 70; }, true), C('high', 'Raised above shoulder height', function (r) { return r.ext < 110; }), tempoCheck(1.5), C('swing', 'Swinging the body', function (r) { return r.aux.torso <= 10; })],
    aux:{ torso:['torso', 'range'] } }); };
  var PUSHDOWN = R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:160, better:'higher',
    checks:[C('lockout', 'Push to fully straight', function (r) { return r.ext >= 160; }, true), C('return', 'Let forearms rise past horizontal', function (r) { return r.other <= 100; }, true), C('drift', 'Elbows drifting from your sides', function (r) { return r.aux.uarm <= 20; }), C('lean', 'Leaning into it', function (r) { return r.aux.torso <= 12; })],
    aux:{ uarm:['uarm', 'range'], torso:['torso', 'range'] } });
  var OHEXT = R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:155, better:'higher',
    checks:[C('lockout', 'Straighten your arms', function (r) { return r.ext >= 155; }, true), C('stretch', 'Deep elbow bend behind your head', function (r) { return r.other <= 75; }, true), C('drift', 'Upper arms moving', function (r) { return r.aux.uarm <= 20; })],
    aux:{ uarm:['uarm', 'range'] } });
  var CALF = function (sig) { return R({ view:V_SIDE, sig:sig, ext:'max', unit:'', what:'heel height', rel:true, prom:0.06, ecc:'from', better:'higher',
    checks:[C('pause', 'No pause in the stretch at the bottom', function (r) { return r.holdOther >= 0.7; })] }); };
  var KNEERAISE = R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:30, ecc:'from', target:80, better:'lower',
    checks:[C('height', 'Knees above hip level', function (r) { return r.ext <= 80; }, true), C('return', 'Lower all the way', function (r) { return r.other >= 145; }, true), C('swing', 'Swinging', function (r) { return r.aux.torso <= 15; })],
    aux:{ torso:['torso', 'range'] } });

  var RULES = {
    hack:SQUAT, smith_squat:SQUAT, bb_squat:SQUAT, goblet:SQUAT,
    leg_press:LEGPRESS, sl_leg_press:Object.assign({}, LEGPRESS, { per:true }),
    db_split:Object.assign({}, LUNGE, { per:true }), bulgarian:Object.assign({}, LUNGE, { per:true }),
    walking_lunge:Object.assign({}, LUNGE, { per:true, note:'You walk out of frame on walking lunges, so only the reps the camera sees are counted.' }),
    step_up:R({ view:V_SIDE, sig:'hipUp', ext:'max', unit:'', what:'hip height', rel:true, prom:0.25, ecc:'from', per:true, better:'higher',
      checks:[C('stand', 'Stand tall on the box', function (r) { return r.aux.kneeTop >= 160; }, true)], aux:{ kneeTop:['kneeMax', 'atExt'] } }),
    db_rdl:HINGE, bb_rdl:HINGE, smith_rdl:HINGE,
    cable_pullthrough:Object.assign({}, HINGE, { checks:[C('depth', 'Hinge back to a hamstring stretch', function (r) { return r.ext <= 120; }, true), C('stand', 'Drive the hips all the way through', function (r) { return r.other >= 160; }, true), HINGE.checks[2]] }),
    back_ext:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:25, ecc:'to', target:120, better:'lower',
      checks:[C('depth', 'Hinge down to a hamstring stretch', function (r) { return r.ext <= 120; }, true), C('top', 'Rise to a straight line', function (r) { return r.other >= 165; }, true)] }),
    ht_mc:THRUST, bb_ht:THRUST, smith_ht:THRUST,
    leg_ext:R({ view:V_SIDE, sig:'knee', ext:'max', unit:'°', what:'knee angle', prom:30, ecc:'from', target:160, better:'higher',
      checks:[C('top', 'Straighten fully', function (r) { return r.ext >= 160; }, true), C('bottom', 'Lower until fully bent', function (r) { return r.other <= 100; }, true), C('squeeze', 'Squeeze about 1 s at the top', function (r) { return r.holdExt >= 0.6; }), C('hips', 'Hips lifting off the seat', function (r) { return r.aux.hip <= 15; })],
      aux:{ hip:['hip', 'range'] } }),
    seated_curl:R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:30, ecc:'from', target:75, better:'lower',
      checks:[C('curl', 'Heels under the seat as far as they go', function (r) { return r.ext <= 75; }, true), C('return', 'Return to nearly straight', function (r) { return r.other >= 150; }, true)] }),
    lying_curl:R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:30, ecc:'from', target:80, better:'lower',
      checks:[C('curl', 'Curl heels toward your glutes', function (r) { return r.ext <= 80; }, true), C('return', 'Lower to nearly straight', function (r) { return r.other >= 150; }, true), tempoCheck(2), C('hips', 'Hips rising off the bench', function (r) { return r.aux.hip <= 15; })],
      aux:{ hip:['hip', 'range'] } }),
    ball_curl:R({ view:V_SIDE, sig:'knee', ext:'min', unit:'°', what:'knee angle', prom:30, ecc:'from', target:90, better:'lower',
      checks:[C('curl', 'Roll the ball all the way in', function (r) { return r.ext <= 90; }, true), C('return', 'Roll back out to straight legs', function (r) { return r.other >= 150; }, true), C('hips', 'Hips dropping', function (r) { return r.aux.hipAt >= 145; })],
      aux:{ hipAt:['hip', 'atExt'] } }),
    standing_calf:CALF('hipUp'), sl_db_calf:Object.assign({}, CALF('hipUp'), { per:true }), seated_calf:CALF('kneeUp'),
    lp_calf:{ none:'The camera can’t see your ankles bend on the leg press, so this one can’t be checked from video.' },
    ab_crunch_mc:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'trunk angle', rel:true, prom:12, ecc:'from', better:'lower', checks:[] }),
    cable_crunch:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'trunk angle', rel:true, prom:12, ecc:'from', better:'lower',
      checks:[C('sitback', 'Sitting back on your heels', function (r) { return r.aux.hipX <= 0.25; })], aux:{ hipX:['hipX', 'range'] } }),
    captain:KNEERAISE, hanging_kr:KNEERAISE,
    leg_raise:R({ view:V_SIDE, sig:'hip', ext:'min', unit:'°', what:'hip angle', prom:30, ecc:'from', target:100, better:'lower',
      checks:[C('height', 'Legs up to vertical', function (r) { return r.ext <= 100; }, true), C('return', 'Lower the legs back down', function (r) { return r.other >= 150; }, true), C('knees', 'Knees bending', function (r) { return r.aux.kneeAt >= 145; })],
      aux:{ kneeAt:['knee', 'atExt'] } }),
    dead_bug:R({ view:V_SIDE, sig:'kneeMax', ext:'max', unit:'°', what:'leg reach', rel:true, prom:30, ecc:'from', per:true, better:'higher', checks:[] }),
    pushup:PRESS({ checks:[C('depth', 'Chest down to a fist from the floor', function (r) { return r.ext <= 100; }, true), C('lockout', 'Press back to straight arms', function (r) { return r.other >= 155; }, true), C('line', 'Hips sagging or piking', function (r) { return r.aux.body >= 155; })], aux:{ body:['body', 'minWin'] } }),
    mc_press:PRESS({ checks:[PRESS().checks[0], PRESS().checks[1], tempoCheck(2)], tip:'sideLow' }),
    db_bench:PRESS({ tip:'sideLow' }), smith_bench:PRESS({ tip:'sideLow' }), bb_bench:PRESS({ tip:'sideLow' }),
    mc_incline:PRESS({ checks:[C('depth', 'Lower to an upper-chest stretch', function (r) { return r.ext <= 100; }, true), PRESS().checks[1], tempoCheck(2)], tip:'sideLow' }),
    db_incline:PRESS({ tip:'sideLow' }), smith_incline:PRESS({ tip:'sideLow' }),
    mc_dip:R({ view:V_SIDE, sig:'elbow', ext:'max', unit:'°', what:'elbow angle', prom:30, ecc:'from', target:155, better:'higher',
      checks:[C('lockout', 'Press down to straight arms', function (r) { return r.ext >= 155; }, true), C('return', 'Come back up to about 90°', function (r) { return r.other <= 100; }, true)] }),
    mc_shoulder:VPRESS, db_shoulder:VPRESS, smith_ohp:VPRESS,
    cs_row:ROW({ checks:[ROW().checks[0], ROW().checks[1], C('pad', 'Lifting off the pad', function (r) { return r.aux.torso <= 15; }), C('squeeze', 'Squeeze about 1 s', function (r) { return r.holdExt >= 0.5; })], aux:{ torso:['torso', 'range'] } }),
    db_cs_row:ROW({ checks:[ROW().checks[0], ROW().checks[1], C('pad', 'Chest lifting off the bench', function (r) { return r.aux.torso <= 15; }), C('squeeze', 'Squeeze about 1 s', function (r) { return r.holdExt >= 0.5; })], aux:{ torso:['torso', 'range'] } }),
    cable_row:ROW({ checks:[ROW().checks[0], ROW().checks[1], C('rock', 'Rocking back and forth', function (r) { return r.aux.torso <= 20; })], aux:{ torso:['torso', 'range'] } }),
    db_row:ROW(),
    pulldown:VPULL({ checks:[VPULL().checks[0], VPULL().checks[1], C('lean', 'Leaning back too far', function (r) { return r.aux.lean <= 30; })], aux:{ lean:['lean', 'maxWin'] } }),
    ng_pulldown:VPULL({ checks:[VPULL().checks[0], VPULL().checks[1], C('lean', 'Leaning back too far', function (r) { return r.aux.lean <= 30; })], aux:{ lean:['lean', 'maxWin'] } }),
    assisted_pu:VPULL({ checks:[C('pull', 'Pull your chest toward the bar', function (r) { return r.ext <= 75; }, true), VPULL().checks[1]], target:75 }),
    band_pu:VPULL({ checks:[C('pull', 'Chin over the bar', function (r) { return r.ext <= 75; }, true), VPULL().checks[1]], target:75 }),
    pec_deck:FLY({ checks:[FLY().checks[0], C('squeeze', 'Squeeze about 1 s', function (r) { return r.holdExt >= 0.6; })] }), cable_fly:FLY(), db_fly:FLY({ tip:'front' }),
    rear_deck:REAR, face_pull:REAR, db_rear:REAR,
    cable_lat:LATERAL('abdMax'), mc_lat:LATERAL('abdAvg'), db_lat:LATERAL('abdAvg'),
    pushdown:PUSHDOWN, oh_cable_ext:OHEXT, db_oh_ext:OHEXT,
    cable_curl:CURLPAT({ checks:CURLPAT().checks.concat([tempoCheck(2)]) }), db_curl:CURLPAT(), incline_db_curl:CURLPAT(), hammer:CURLPAT(),
    preacher_mc:CURLPAT({ checks:[C('top', 'Curl all the way up', function (r) { return r.ext <= 70; }, true), C('bottom', 'Lower until nearly straight', function (r) { return r.other >= 140; }, true)], aux:{} })
  };
  function ruleFor(id) { return RULES[id] || null; }
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
    var flagCount = {};
    reps.forEach(function (r) {
      r.partial = false; r.fails = []; r.flags = [];
      (rule.checks || []).forEach(function (c) {
        var pass; try { pass = c.test(r); } catch (e) { pass = true; }
        if (pass !== false && !(pass !== pass)) return;
        if (c.partial) { r.partial = true; r.fails.push(c.code); } else { r.flags.push(c.code); flagCount[c.code] = (flagCount[c.code] || 0) + 1; }
      });
      if (best && r.range < best * 0.7) { r.partial = true; r.fails.push('short'); }
    });
    var labels = {}; (rule.checks || []).forEach(function (c) { labels[c.code] = c.label; }); labels.short = 'Shorter than your best reps';
    var nP = reps.filter(function (r) { return r.partial; }).length;
    return { id:id, view:rule.view, side:side ? 'right' : 'left', fps:Math.round(fps), coverage:coverage, n:reps.length, nGood:reps.length - nP, nPartial:nP,
      reps:reps, flags:flagCount, labels:labels, warn:warn, rel:!!rule.rel, unit:rule.unit, what:rule.what, target:rule.target, better:rule.better, per:!!rule.per,
      series:y, times:track.map(function (f) { return f.t; }), duration:track[n - 1].t - track[0].t };
  }

  var API = { analyze:analyze, ruleFor:ruleFor, tipFor:tipFor, RULES:RULES, SIG:SIG, _peaks:peaks };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.FormEngine = API;
})(typeof window !== 'undefined' ? window : this);
