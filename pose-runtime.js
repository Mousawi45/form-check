/* Pose runtime: runs the compact ONNX-derived graph (YOLO11n-pose) with TensorFlow.js ops.
   Feature maps travel in NHWC (what TF.js convolutions want); any op whose meaning depends on the
   ONNX layout (Reshape, Transpose, MatMul, Slice) first converts its input back to NCHW. */
(function (root) {
  'use strict';
  function f16(h) {
    var s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  var F16 = null;
  function f16Table() { if (F16) return F16; F16 = new Float32Array(65536); for (var i = 0; i < 65536; i++) F16[i] = f16(i); return F16; }
  function b64ToBytes(b64) {
    if (typeof atob === 'function') { var bin = atob(b64), n = bin.length, out = new Uint8Array(n); for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i); return out; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  function PoseRT(tf, spec) {
    this.tf = tf; this.spec = spec; this.W = {}; this.C = {};
    var bytes = b64ToBytes(spec.wb64), u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), T = f16Table();
    var self = this;
    Object.keys(spec.w).forEach(function (name) {
      var w = spec.w[name], a = new Float32Array(w.len);
      for (var i = 0; i < w.len; i++) a[i] = T[u16[w.off + i]];
      self.W[name] = { s: w.s, d: a };
    });
    Object.keys(spec.c).forEach(function (name) { self.C[name] = spec.c[name]; });
    this.inputSize = spec.input.shape[2];
    this.prepared = {};
    this.prepare();
  }

  /* Build TF tensors for conv filters/biases once. */
  PoseRT.prototype.prepare = function () {
    var tf = this.tf, self = this;
    this.spec.nodes.forEach(function (n, idx) {
      if (n.op !== 'Conv') return;
      var W = self.W[n.i[1]] || self.C[n.i[1]], B = n.i[2] ? (self.W[n.i[2]] || self.C[n.i[2]]) : null;
      var O = W.s[0], Ig = W.s[1], kh = W.s[2], kw = W.s[3], g = n.a.group || 1;
      var t = tf.tensor4d(W.d, [O, Ig, kh, kw]);
      var filt, dw = g > 1;
      if (!dw) filt = tf.keep(tf.transpose(t, [2, 3, 1, 0]));             // [kh,kw,I,O]
      else {
        if (Ig !== 1 || O !== g) throw new Error('Only depthwise grouped convs are supported');
        filt = tf.keep(tf.transpose(t, [2, 3, 0, 1]));                     // [kh,kw,C,1]
      }
      t.dispose();
      var bias = B ? tf.keep(tf.tensor1d(B.d)) : null;
      var p = n.a.pads || [0, 0, 0, 0];
      self.prepared[idx] = { filt: filt, bias: bias, dw: dw, stride: (n.a.strides || [1, 1]), pad: [[0, 0], [p[0], p[2]], [p[1], p[3]], [0, 0]] };
    });
  };
  PoseRT.prototype.constArr = function (name) { var c = this.C[name]; return c ? c.d : null; };

  /* input: tf.Tensor4D [1,S,S,3] float32 in 0..1 (NHWC). Returns tf.Tensor [1,56,N]. Call inside tf.tidy. */
  PoseRT.prototype.forward = function (input) {
    var tf = this.tf, self = this, env = {};
    env[this.spec.input.name] = { t: input, nhwc: true };
    function raw(v) { // to exact ONNX layout
      if (v.nhwc && v.t.rank === 4) return tf.transpose(v.t, [0, 3, 1, 2]);
      return v.t;
    }
    function nhwc(v) { if (v.nhwc) return v.t; if (v.t.rank !== 4) throw new Error('nhwc() on rank ' + v.t.rank); return tf.transpose(v.t, [0, 2, 3, 1]); }
    function get(name) {
      if (env[name]) return env[name];
      if (self.W[name]) { var w = self.W[name]; return (env[name] = { t: tf.tensor(w.d, w.s.length ? w.s : []), nhwc: false, k: true }); }
      if (self.C[name]) { var c = self.C[name]; return (env[name] = { t: tf.tensor(c.d, c.s.length ? c.s : [], c.t === 'i' ? 'int32' : 'float32'), nhwc: false, k: true, ints: c.t === 'i' ? c.d : null }); }
      throw new Error('Missing tensor ' + name);
    }
    function ints(name) { var c = self.C[name]; if (!c) throw new Error('Expected const ' + name); return c.d; }
    function axisOf(a, rank) { return a < 0 ? a + rank : a; }
    var NC2NH = [0, 3, 1, 2]; // nchw axis -> nhwc axis
    function binary(n, fn) {
      var A = get(n.i[0]), B = get(n.i[1]);
      var aS = A.t.size === 1, bS = B.t.size === 1;
      if (A.nhwc && B.nhwc) return { t: fn(A.t, B.t), nhwc: true };
      if (A.nhwc && bS) return { t: fn(A.t, B.t.reshape([])), nhwc: true };
      if (B.nhwc && aS) return { t: fn(A.t.reshape([]), B.t), nhwc: true };
      return { t: fn(raw(A), raw(B)), nhwc: false };
    }
    for (var idx = 0; idx < this.spec.nodes.length; idx++) {
      var n = this.spec.nodes[idx], out;
      switch (n.op) {
        case 'Conv': {
          var P = this.prepared[idx], x = nhwc(get(n.i[0]));
          var pad = P.pad, sym = pad[1][0] === pad[1][1] && pad[2][0] === pad[2][1] && pad[1][0] === pad[2][0];
          var pv = sym ? pad[1][0] : pad;
          var y = P.dw ? tf.depthwiseConv2d(x, P.filt, P.stride, pv) : tf.conv2d(x, P.filt, P.stride, pv);
          if (P.bias) y = tf.add(y, P.bias);
          out = { t: y, nhwc: true }; break;
        }
        case 'Sigmoid': { var v = get(n.i[0]); out = { t: tf.sigmoid(v.t), nhwc: v.nhwc }; break; }
        case 'Mul': out = binary(n, tf.mul); break;
        case 'Add': out = binary(n, tf.add); break;
        case 'Sub': out = binary(n, tf.sub); break;
        case 'Div': out = binary(n, tf.div); break;
        case 'Concat': {
          var vs = n.i.map(get), allN = vs.every(function (v) { return v.nhwc; });
          var r0 = vs[0].t.rank, ax = axisOf(n.a.axis, r0);
          if (allN && r0 === 4) out = { t: tf.concat(vs.map(function (v) { return v.t; }), NC2NH[ax]), nhwc: true };
          else out = { t: tf.concat(vs.map(raw), ax), nhwc: false };
          break;
        }
        case 'Split': {
          var sv = get(n.i[0]), sax = axisOf(n.a.axis, sv.t.rank), sizes = n.a.split || (n.i[1] ? ints(n.i[1]) : null);
          var parts = sv.nhwc && sv.t.rank === 4 ? tf.split(sv.t, sizes, NC2NH[sax]) : tf.split(raw(sv), sizes, sax);
          var isN = sv.nhwc && sv.t.rank === 4;
          n.o.forEach(function (name, j) { env[name] = { t: parts[j], nhwc: isN }; });
          continue;
        }
        case 'MaxPool': {
          var mx = nhwc(get(n.i[0])), ks = n.a.kernel_shape, st = n.a.strides || [1, 1], mp = n.a.pads || [0, 0, 0, 0];
          var same = st[0] === 1 && mp[0] === (ks[0] - 1) / 2;
          out = { t: same ? tf.maxPool(mx, ks, st, 'same') : tf.maxPool(tf.pad(mx, [[0, 0], [mp[0], mp[2]], [mp[1], mp[3]], [0, 0]], -1e9), ks, st, 'valid'), nhwc: true };
          break;
        }
        case 'Resize': {
          var rx = nhwc(get(n.i[0])), sc = self.C[n.i[2]] ? self.C[n.i[2]].d : [1, 1, 2, 2];
          var H = rx.shape[1], Wd = rx.shape[2];
          out = { t: tf.image.resizeNearestNeighbor(rx, [Math.round(H * sc[2]), Math.round(Wd * sc[3])], false, false), nhwc: true };
          break;
        }
        case 'Reshape': {
          var rv = get(n.i[0]), rt = raw(rv), shp = ints(n.i[1]).slice();
          for (var q = 0; q < shp.length; q++) if (shp[q] === 0) shp[q] = rt.shape[q];
          out = { t: tf.reshape(rt, shp), nhwc: false }; break;
        }
        case 'Transpose': { out = { t: tf.transpose(raw(get(n.i[0])), n.a.perm), nhwc: false }; break; }
        case 'Softmax': {
          var smv = raw(get(n.i[0])), sa = axisOf(n.a.axis == null ? -1 : n.a.axis, smv.rank);
          if (sa === smv.rank - 1) out = { t: tf.softmax(smv), nhwc: false };
          else { var perm = []; for (var z = 0; z < smv.rank; z++) perm.push(z); perm[sa] = smv.rank - 1; perm[smv.rank - 1] = sa; out = { t: tf.transpose(tf.softmax(tf.transpose(smv, perm)), perm), nhwc: false }; }
          break;
        }
        case 'MatMul': { out = { t: tf.matMul(raw(get(n.i[0])), raw(get(n.i[1]))), nhwc: false }; break; }
        case 'Slice': {
          var slv = raw(get(n.i[0])), starts = ints(n.i[1]), ends = ints(n.i[2]), axes = n.i[3] ? ints(n.i[3]) : starts.map(function (_, j) { return j; });
          var steps = n.i[4] ? ints(n.i[4]) : null;
          if (steps && steps.some(function (s) { return s !== 1; })) throw new Error('Slice steps unsupported');
          var begin = slv.shape.map(function () { return 0; }), size = slv.shape.slice();
          axes.forEach(function (a, j) {
            var ax2 = axisOf(a, slv.rank), dim = slv.shape[ax2];
            var b = starts[j] < 0 ? starts[j] + dim : starts[j], e = ends[j] < 0 ? ends[j] + dim : Math.min(ends[j], dim);
            b = Math.max(0, Math.min(b, dim)); begin[ax2] = b; size[ax2] = Math.max(0, e - b);
          });
          out = { t: tf.slice(slv, begin, size), nhwc: false }; break;
        }
        default: throw new Error('Unsupported op ' + n.op);
      }
      env[n.o[0]] = out;
    }
    return raw(env[this.spec.output]);
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PoseRT; else root.PoseRT = PoseRT;
})(typeof window !== 'undefined' ? window : this);
