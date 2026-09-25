/* Home-page intro: rotates the scenes, runs the chapter bar and pause
   button, plays each scene's animation, and draws the dot grid ("taxels")
   that ripples wherever a scene touches the skin.
   Scene text comes from _data/home.yml; the drawings are in _includes/art/. */
(function () {
  'use strict';

  var root = document.querySelector('[data-intro]');
  if (!root) return;

  var scenes = [].slice.call(root.querySelectorAll('.scene'));
  var chapters = [].slice.call(root.querySelectorAll('[data-go]'));
  var bars = chapters.map(function (c) { return c.querySelector('.bar b'); });
  var toggle = root.querySelector('.intro-toggle');
  var canvas = root.querySelector('.intro-canvas');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var style = getComputedStyle(root);
  var DOT = cssVar('--dot', '#D2D9E2');
  var ACCENT = hexToRgb(cssVar('--accent', '#00A651'));
  var BLUE = hexToRgb(cssVar('--blue', '#005BAA'));
  var DIM = [110, 128, 152];
  var LED_OFF = [185, 197, 211];

  var RIPPLE_LIFE = 2600, RIPPLE_SPEED = 0.16, RIPPLE_WIDTH = 20;

  var index = 0, elapsed = 0, lastFrame = 0, frameId = 0;
  var userPaused = reduceMotion.matches, offscreen = false;
  var still = false, previewing = false;
  var memo = {};            // per-scene animation state, cleared on every scene change
  var width = 0, height = 0, dots = [], ripples = [];

  /* Helpers ------------------------------------------------------------ */

  function cssVar(name, fallback) { return (style.getPropertyValue(name) || fallback).trim(); }
  function hexToRgb(hex) { var n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, u) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * u) + ',' + Math.round(a[1] + (b[1] - a[1]) * u) + ',' + Math.round(a[2] + (b[2] - a[2]) * u) + ')';
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function span(t, t0, t1) { return smooth((t - t0) / (t1 - t0)); }
  function gauss(d, w) { return Math.exp(-(d * d) / (2 * w * w)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pt(x, y) { return r1(x) + ' ' + r1(y); }
  function noise(n) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
  function $(svg, sel) { return svg.querySelector(sel); }
  function $$(svg, sel) { return [].slice.call(svg.querySelectorAll(sel)); }
  function once(key) { if (memo[key]) return false; memo[key] = true; return true; }

  // Piecewise value over time: keys = [[time, value], ...], eased between keys.
  function track(t, keys) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * span(t, keys[i - 1][0], keys[i][0]);
    }
    return keys[keys.length - 1][1];
  }

  // A live signal: fn(time) drawn from t0 up to `now`, across x0..x1.
  function trace(t0, t1, now, x0, x1, fn, step) {
    var end = Math.min(now, t1), d = '';
    if (end <= t0) return { d: '', x: x0 };
    for (var t = t0; ; t += step) {
      if (t > end) t = end;
      d += (d ? 'L' : 'M') + pt(x0 + (x1 - x0) * (t - t0) / (t1 - t0), fn(t));
      if (t >= end) break;
    }
    return { d: d, x: x0 + (x1 - x0) * (end - t0) / (t1 - t0) };
  }

  // Highlights the current state in the scene's list of steps.
  function setStep(i) {
    var list = scenes[index].querySelector('[data-steps]');
    if (!list || memo.step === i) return;
    memo.step = i;
    [].forEach.call(list.children, function (li, k) { li.classList.toggle('is-on', k === i); });
  }

  // Sensor points that light up where touched and fade afterwards (tau = fade time, ms).
  function lightTaxels(svg, t, tau, level) {
    var dt = memo.last === undefined || t < memo.last ? 0 : t - memo.last;
    memo.last = t;
    var tax = memo.tax || (memo.tax = []), peak = 0;
    $$(svg, '.taxel').forEach(function (c, i) {
      var a = Math.max((tax[i] || 0) * Math.exp(-dt / tau), clamp(level(+c.getAttribute('cx'), +c.getAttribute('cy')), 0, 1));
      tax[i] = a;
      if (a > peak) peak = a;
      var r0 = c._r0 || (c._r0 = +c.getAttribute('r'));
      c.setAttribute('r', r1(r0 * (1 + 1.1 * a)));
      c.style.fill = mix(DIM, ACCENT, a);
    });
    return peak;
  }

  /* Hand ----------------------------------------------------------------
     A side view of a hand: thumb toward the viewer, palm down, fingers along
     +x, wrist at (0, 0). A pose gives each finger's [MCP, PIP, DIP] angles and
     the thumb's [direction, MCP, IP] angles in degrees (positive = curl). */

  var FINGERS = [   // little, ring, middle, index; rd/rp = back/palm-side radius at each joint
    { base: [52, 4], seg: [10, 33, 21, 18], rd: [10.8, 9.8, 8.8, 8, 7.2], rp: [10.8, 9.8, 8.8, 8, 7.2] },
    { base: [58, 2], seg: [12, 42, 27, 20], rd: [11.8, 10.8, 9.8, 8.8, 7.9], rp: [11.8, 10.8, 9.8, 8.8, 7.9] },
    { base: [63, 0], seg: [14, 46, 29, 21], rd: [12.5, 11.4, 10.4, 9.4, 8.4], rp: [12.5, 11.4, 10.4, 9.4, 8.4] },
    { base: [66, -2], seg: [16, 42, 25, 20], rd: [16.4, 12, 10.8, 9.8, 8.8], rp: [17.6, 11.6, 10.4, 9.4, 8.6], nail: true }
  ];
  var THUMB = { base: [8, 7], seg: [8, 30, 26, 22], rd: [13, 12.4, 11.4, 10.4, 9.4], rp: [14, 13, 11.6, 10.4, 9.6], nail: true };
  var PALM_UNDER = [[70, 15.4], [54, 18.6], [36, 20.6], [22, 20.4], [12, 20.2], [5, 18.4], [-6, 17.1]];
  var POSES = {
    open:    { f: [[4, 6, 4], [3, 6, 4], [3, 5, 3], [2, 4, 3]], t: [3, 6, 6] },
    point:   { f: [[68, 108, 62], [66, 108, 62], [64, 106, 60], [2, 4, 3]], t: [10, 20, 22] },
    fist:    { f: [[70, 110, 64], [68, 110, 64], [66, 110, 64], [64, 108, 62]], t: [16, 26, 22] },
    claw:    { f: [[26, 58, 40], [26, 58, 40], [24, 56, 38], [22, 54, 36]], t: [8, 14, 12] },
    relaxed: { f: [[10, 20, 12], [9, 19, 12], [8, 18, 11], [7, 16, 10]], t: [6, 10, 10] }
  };
  function mixPose(a, b, u) {
    function m(x, y) { return x.map(function (v, i) { return typeof v === 'number' ? v + (y[i] - v) * u : m(v, y[i]); }); }
    return { f: m(a.f, b.f), t: m(a.t, b.t) };
  }

  // One finger or thumb as a smooth outline (bends = [MCP, PIP, DIP]).
  function digit(g, dir0, bends) {
    var seg = g.seg, n = seg.length, J = [], acc = 0;
    for (var i = 0; i < n - 1; i++) { acc += seg[i]; J.push(acc); }
    var total = acc + seg[n - 1];
    var widths = bends.map(function (b, j) {
      return clamp((g.rd[j + 1] + g.rp[j + 1]) / 2 * Math.abs(b) / 57.3 * 1.25, 3, Math.min(seg[j], seg[j + 1]) * 0.95);
    });
    function dirAt(s) {
      var d = dir0;
      for (var j = 0; j < bends.length; j++) d += bends[j] * smooth((s - J[j] + widths[j] / 2) / widths[j]);
      return d * Math.PI / 180;
    }
    function radAt(arr, s) {
      var start = 0;
      for (var i = 0; i < n; i++) {
        var end = start + seg[i];
        if (s <= end || i === n - 1) {
          var u = clamp((s - start) / seg[i], 0, 1);
          if (i === 0) u = 1 - (1 - u) * (1 - u);     // the knuckle narrows quickly into the finger
          return arr[i] + (arr[i + 1] - arr[i]) * u;
        }
        start = end;
      }
      return arr[n];
    }
    var x = g.base[0], y = g.base[1], ds = 1.25, c = [], dors = [], palm = [];
    for (var s = 0; s <= total + 0.001; s += ds) {
      var a = dirAt(s), nx = Math.sin(a), ny = -Math.cos(a), knuck = 0, crease = 0;
      for (var j = 1; j < bends.length; j++) {
        var b = clamp(Math.abs(bends[j]) / 90, 0, 1.3);
        knuck += (0.6 + 1.3 * b) * gauss(s - J[j], 3 + 2.2 * b);
        crease += (0.7 + 3.2 * b) * gauss(s - J[j], 2 + 2.6 * b);
      }
      var bm = clamp(Math.abs(bends[0]) / 90, 0, 1.3);
      knuck += 2.2 * bm * gauss(s - J[0], 4 + 2 * bm);
      crease += 2.6 * bm * gauss(s - J[0], 3 + 3 * bm);
      var pad = 0.5 * gauss(s - (J[0] + J[1]) / 2, seg[1] * 0.28) + 0.45 * gauss(s - (J[1] + J[2]) / 2, seg[2] * 0.28) + 0.6 * gauss(s - (J[2] + total) / 2, seg[3] * 0.3);
      var rd = radAt(g.rd, s) + knuck, rp = Math.max(radAt(g.rp, s) * 0.5, radAt(g.rp, s) - crease + pad);
      c.push([x, y, a]);
      dors.push([x + nx * rd, y + ny * rd]);
      palm.push([x - nx * rp, y - ny * rp]);
      x += Math.cos(a) * ds; y += Math.sin(a) * ds;
    }
    var e = c[c.length - 1], dx = Math.cos(e[2]), dy = Math.sin(e[2]), ex = Math.sin(e[2]), ey = -Math.cos(e[2]);
    var D = dors[dors.length - 1], Q = palm[palm.length - 1], rt = (g.rd[n] + g.rp[n]) / 2;
    var T = [e[0] + dx * rt * 1.02 - ex * rt * 0.08, e[1] + dy * rt * 1.02 - ey * rt * 0.08];
    var d = 'M' + pt(dors[0][0], dors[0][1]);
    for (var k = 1; k < dors.length; k++) d += 'L' + pt(dors[k][0], dors[k][1]);
    d += 'C' + pt(D[0] + dx * rt * 0.58, D[1] + dy * rt * 0.58) + ' ' + pt(T[0] + ex * rt * 0.55, T[1] + ey * rt * 0.55) + ' ' + pt(T[0], T[1]);
    d += 'C' + pt(T[0] - ex * rt * 0.62, T[1] - ey * rt * 0.62) + ' ' + pt(Q[0] + dx * rt * 0.66, Q[1] + dy * rt * 0.66) + ' ' + pt(Q[0], Q[1]);
    for (var m = palm.length - 2; m >= 0; m--) d += 'L' + pt(palm[m][0], palm[m][1]);
    var out = { d: d, nail: '', pts: dors.concat(palm, [T]), tip: T };
    if (g.nail) {
      var at = function (s, off) {
        var idx = clamp(Math.round(s / ds), 0, c.length - 1), q = c[idx], extra = s - idx * ds;
        return [q[0] + Math.cos(q[2]) * extra + Math.sin(q[2]) * off, q[1] + Math.sin(q[2]) * extra - Math.cos(q[2]) * off];
      };
      var rdt = g.rd[n], s1 = total - rdt * 1.45, s2 = total + rdt * 0.42, ro = rdt * 0.84, ri = rdt * 0.26;
      var A1 = at(s1, ro), A2 = at(s2, ro * 0.88), B2 = at(s2 - rdt * 0.15, ri), B1 = at(s1, ri);
      var M1 = at(s1 - rdt * 0.26, (ro + ri) / 2), M2 = at(s2 + rdt * 0.22, (ro * 0.88 + ri) / 2);
      out.nail = 'M' + pt(A1[0], A1[1]) + 'L' + pt(A2[0], A2[1]) + 'Q' + pt(M2[0], M2[1]) + ' ' + pt(B2[0], B2[1]) +
        'L' + pt(B1[0], B1[1]) + 'Q' + pt(M1[0], M1[1]) + ' ' + pt(A1[0], A1[1]) + 'Z';
    }
    return out;
  }

  function digits(pose) {
    return FINGERS.map(function (g, i) { return digit(g, 0, pose.f[i]); })
      .concat([digit(THUMB, pose.t[0], [0, pose.t[1], pose.t[2]])]);
  }

  // The hand drawing inside a scene (cached on the element).
  function hand(svg) {
    var el = $(svg, '.hand');
    if (!el._hand) {
      el._hand = { el: el, forearm: $(el, '.h-forearm'), digits: $$(el, '.h-digit'), nails: $$(el, '.h-nail') };
    }
    return el._hand;
  }

  function drawHand(h, pose) {
    var key = JSON.stringify(pose);
    if (h.key === key) return;
    h.key = key;
    var ds = digits(pose), pts = PALM_UNDER.slice();
    ds.forEach(function (dg, i) { h.digits[i].setAttribute('d', dg.d); pts = pts.concat(dg.pts); });
    h.nails[0].setAttribute('d', ds[3].nail);
    h.nails[1].setAttribute('d', ds[4].nail);
    h.pts = pts;
    h.tip = ds[3].tip;
  }

  // Positions the hand so its lowest point (or, with anchor 'tip', the index
  // fingertip) sits at `contact` (x, y in the scene). Returns a function that
  // maps a point of the forearm drawing to scene coordinates.
  function placeHand(h, o) {
    var a = o.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    var sx = o.mirror ? -o.scale : o.scale, sy = o.scale, lx = 0, ly = -1e9;
    if (o.anchor === 'tip') {
      lx = h.tip[0] * sx * ca - h.tip[1] * sy * sa;
      ly = h.tip[0] * sx * sa + h.tip[1] * sy * ca;
    } else {
      for (var i = 0; i < h.pts.length; i++) {
        var X = h.pts[i][0] * sx, Y = h.pts[i][1] * sy, wy = X * sa + Y * ca;
        if (wy > ly) { ly = wy; lx = X * ca - Y * sa; }
      }
    }
    var tx = o.contact[0] - lx, ty = o.contact[1] - ly, w = (o.wrist || 0) * Math.PI / 180;
    h.el.setAttribute('transform', 'translate(' + pt(tx, ty) + ') rotate(' + r1(o.angle) + ') scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ')');
    h.el.style.setProperty('--hs', o.scale);
    h.forearm.setAttribute('transform', 'rotate(' + r1(o.wrist || 0) + ')');
    return function (x, y) {
      var fx = (x * Math.cos(w) - y * Math.sin(w)) * sx, fy = (x * Math.sin(w) + y * Math.cos(w)) * sy;
      return [tx + fx * ca - fy * sa, ty + fx * sa + fy * ca];
    };
  }

  /* Dot grid ------------------------------------------------------------ */

  function resize() {
    var rect = root.getBoundingClientRect();
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    var gap = width < 600 ? 16 : 18;
    dots = [];
    for (var y = gap / 2; y < height; y += gap) {
      for (var x = gap / 2; x < width; x += gap) dots.push(x, y);
    }
    draw(performance.now());
  }

  function draw(now) {
    ripples = ripples.filter(function (r) { return now - r.t < RIPPLE_LIFE; });
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = DOT;
    ctx.beginPath();
    var lit = [];
    for (var i = 0; i < dots.length; i += 2) {
      var x = dots[i], y = dots[i + 1], k = 0;
      for (var j = 0; j < ripples.length; j++) {
        var r = ripples[j], age = Math.max(0, now - r.t);
        var dist = Math.sqrt((x - r.x) * (x - r.x) + (y - r.y) * (y - r.y));
        var e = r.k * Math.max(0, 1 - Math.abs(dist - age * RIPPLE_SPEED) / RIPPLE_WIDTH) * (1 - age / RIPPLE_LIFE);
        if (e > k) k = e;
      }
      if (k > 0.04) { lit.push(x, y, Math.min(k, 1)); continue; }
      ctx.moveTo(x + 1.1, y);
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
    }
    ctx.fill();
    for (var n = 0; n < lit.length; n += 3) {
      ctx.fillStyle = 'rgba(' + ACCENT.join(',') + ',' + (0.25 + 0.75 * lit[n + 2]).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(lit[n], lit[n + 1], 1.1 + 1.7 * lit[n + 2], 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Starts a ripple in the dot grid at a point of a scene drawing.
  function ripple(svg, x, y, strength) {
    if (still || previewing || reduceMotion.matches) return;
    var box = svg.viewBox.baseVal, b = svg.getBoundingClientRect(), r = root.getBoundingClientRect();
    var s = Math.min(b.width / box.width, b.height / box.height);
    var ox = (b.width - box.width * s) / 2, oy = (b.height - box.height * s) / 2;
    ripples.push({ x: b.left - r.left + ox + (x - box.x) * s, y: b.top - r.top + oy + (y - box.y) * s, t: performance.now(), k: strength || 1 });
    start();
  }

  /* Scene animations ----------------------------------------------------
     Each takes the drawing and the time (ms) since the scene started.
     `key` is the moment shown as a still frame (paused or reduced motion). */

  var anims = {};

  // HRI Lab: a person and a robot reach out and touch. The muscle signal on the
  // person's forearm (bio-signal), the touch (physical HRI), and the robot's
  // skin sensing it (robotic skin) light up in turn, with the labels below.
  anims.title = function (svg, t) {
    var C = [136, 92], CONTACT_T = 2300, APART_T = 5600;
    var hd = track(t, [[0, 13], [1500, 13], [CONTACT_T, 0.4], [APART_T, 0.4], [6400, 9]]);
    var rd = track(t, [[0, 6], [1500, 6], [CONTACT_T, 0], [APART_T, 0], [6400, 4]]);
    var touching = t >= CONTACT_T && t < APART_T + 200;

    // The person's hand rises from the lower left (pointing 28 deg up) ...
    var h = hand(svg), ha = -28 * Math.PI / 180;
    drawHand(h, POSES.point);
    var map = placeHand(h, { angle: -28, scale: 0.56, anchor: 'tip',
      contact: [C[0] - hd * Math.cos(ha), C[1] - hd * Math.sin(ha)] });
    // ... and the robot's comes down from the upper right (pointing 22 deg down).
    var RA = -22, RS = 1.12, rc = Math.cos(RA * Math.PI / 180), rs = Math.sin(RA * Math.PI / 180);
    var ro = [C[0] + rd * rc, C[1] + rd * rs];
    $(svg, '.robot').setAttribute('transform', 'translate(' + pt(ro[0], ro[1]) + ') rotate(' + RA + ') scale(' + RS + ') translate(-141.2 -93)');
    function onRobot(x, y) {
      var dx = (x - 141.2) * RS, dy = (y - 93) * RS;
      return [ro[0] + dx * rc - dy * rs, ro[1] + dx * rs + dy * rc];
    }

    // Bio-signal: the forearm's muscles fire before the hand moves.
    var emg = span(t, 900, 1300) * (1 - 0.6 * span(t, 2600, 3400)) * (1 - 0.4 * span(t, APART_T, 6200));
    $$(svg, '.h-band .electrode').forEach(function (e, i) {
      e.style.fill = mix(BLUE, ACCENT, clamp(emg * (0.8 + 0.2 * noise(Math.floor(t / 70) + i)), 0, 1));
    });
    var wave = '', k = Math.floor(t / 45);
    for (var x = -62; x <= -16; x += 1.5) {
      wave += (wave ? 'L' : 'M') + pt(x, -36 + 10 * emg * (0.55 * Math.sin(x * 1.7 + t / 60) + 0.45 * noise(Math.round(x * 2) + k)));
    }
    var waveEl = $(svg, '.emg-wave');
    waveEl.setAttribute('d', wave);
    waveEl.setAttribute('opacity', emg.toFixed(2));

    // Physical HRI: the fingertips meet; rings spread from the touch.
    if (t >= CONTACT_T && once('touch')) ripple(svg, C[0], C[1]);
    $$(svg, '.ring').forEach(function (ring, i) {
      var age = t - CONTACT_T - i * 240, on = age >= 0 && age < 1500;
      ring.setAttribute('cx', C[0]);
      ring.setAttribute('cy', C[1]);
      ring.setAttribute('r', on ? r1(4 + age * 0.03) : 0);
      ring.setAttribute('opacity', on ? ((1 - age / 1500) * (0.85 - i * 0.2)).toFixed(2) : 0);
    });

    // Robotic skin: the fingertip feels the touch first, then the palm's skin.
    var fade = 1 - span(t, APART_T, 6300);
    var tipLevel = touching ? span(t, CONTACT_T, CONTACT_T + 120) : 0;
    var tip = $(svg, '.tip-taxel');
    tip.style.fill = mix(DIM, ACCENT, tipLevel);
    tip.setAttribute('r', r1(1.3 * (1 + tipLevel)));
    var palmPeak = 0;
    $$(svg, '.palm-taxel').forEach(function (c) {
      var delay = (+c.getAttribute('cx') - 198) * 18;
      var a = span(t, CONTACT_T + 150 + delay, CONTACT_T + 450 + delay) * fade * (0.85 + 0.15 * Math.sin(t / 150));
      if (a > palmPeak) palmPeak = a;
      c.style.fill = mix(DIM, ACCENT, a);
      c.setAttribute('r', r1(1.3 * (1 + a)));
    });
    $(svg, '.led').style.fill = mix(LED_OFF, ACCENT, palmPeak);
    $(svg, '.led-glow').setAttribute('opacity', (palmPeak * 0.35).toFixed(2));

    // Labels light up in order, each pointing at its part of the drawing.
    var band = map(-39, 21.5), skin = onRobot(205, 111.5), leaders = $$(svg, '.leader'), tags = $$(svg, '.tag-l');
    leaders[0].setAttribute('d', 'M44 177L' + pt(band[0], band[1] + 1.5));
    leaders[1].setAttribute('d', 'M' + C[0] + ' 177V' + r1(C[1] + 9));
    leaders[2].setAttribute('d', 'M214 177L' + pt(skin[0], skin[1] + 1.5));
    [t >= 900, t >= CONTACT_T, t >= CONTACT_T + 250].forEach(function (on, i) {
      leaders[i].classList.toggle('on', on);
      tags[i].classList.toggle('on', on);
    });
  };
  anims.title.key = 3200;

  // Robotic skin: a press is sensed as a change in current (pressure);
  // a light rub sends vibrations to the microphones (vibration).
  var SKIN_DEPTH = [[0, -14], [950, -14], [1450, 7], [3100, 7], [3500, 2.2], [5300, 2.2], [5750, -14]];
  anims.skin = function (svg, t) {
    var depth = track(t, SKIN_DEPTH);
    var rub = span(t, 3500, 3700) * (1 - span(t, 5100, 5300));
    var xf = 130 + 24 * Math.sin(2 * Math.PI * (t - 3500) / 900) * rub;
    var dent = Math.max(depth, 0);
    function top(x) { return 62 + dent * gauss(x - xf, 11); }

    var d = 'M28 92V' + r1(top(28));
    for (var x = 31; x <= 232; x += 3) d += 'L' + x + ' ' + r1(top(x));
    $(svg, '.layer').setAttribute('d', d + 'V92Z');
    var h = hand(svg);
    drawHand(h, POSES.point);
    placeHand(h, { angle: 34, scale: 0.44, contact: [xf, 62 + depth], wrist: -4 });

    // Pressure: current between the two sensing modules bends and grows under the press.
    var pressed = dent > 3.5;
    $$(svg, '.current').forEach(function (line, i) {
      var hgt = [7, 13, 19][i], k = [0.35, 0.65, 0.95][i], p = '';
      for (var x = 76; x <= 184; x += 4) {
        p += (p ? 'L' : 'M') + pt(x, 85 - hgt * Math.sin(Math.PI * (x - 76) / 108) + dent * k * gauss(x - xf, 13));
      }
      line.setAttribute('d', p);
      line.classList.toggle('on', pressed);
    });
    var glow = $(svg, '.press-glow');
    glow.setAttribute('cx', r1(xf));
    glow.setAttribute('cy', r1(62 + dent + 9));
    glow.setAttribute('opacity', (clamp(dent / 7, 0, 1) * 0.3).toFixed(2));

    // Vibration: wavefronts from the touch, one on contact and a stream while rubbing.
    var emits = [1450];
    for (var te = 3550; te <= 5250 && te <= t; te += 170) emits.push(te);
    emits = emits.filter(function (e) { return e <= t; }).slice(-6);
    $$(svg, '.wave').forEach(function (w, i) {
      var e = emits[emits.length - 1 - i];
      var age = e === undefined ? -1 : t - e;
      var rad = age * 0.07;
      var on = age >= 0 && rad < 80;
      var ex = 130 + 24 * Math.sin(2 * Math.PI * (e - 3500) / 900) * (span(e, 3500, 3700) * (1 - span(e, 5100, 5300)));
      w.setAttribute('cx', r1(on ? ex : 130));
      w.setAttribute('cy', r1(62 + (e === 1450 ? 7 : 2.2)));
      w.setAttribute('r', on ? r1(rad) : 0);
      w.setAttribute('opacity', on ? (0.85 * Math.pow(1 - rad / 80, 1.4)).toFixed(2) : 0);
    });
    var vibe = function (s) {
      var hit = s >= 1450 && s < 1800 ? 0.75 * Math.exp(-(s - 1450) / 90) * Math.sin((s - 1450) / 8) : 0;
      var env = (span(s, 3500, 3650) * (1 - span(s, 5150, 5300))) * (0.7 + 0.3 * Math.abs(Math.cos(2 * Math.PI * (s - 3500) / 900)));
      return hit + env * (0.55 * Math.sin(s / 7) + 0.45 * noise(Math.floor(s / 15))) + 0.04 * noise(Math.floor(s / 20) + 7);
    };
    var level = Math.max(rub, t >= 1500 && t < 1900 ? 0.8 * Math.exp(-(t - 1500) / 180) : 0);
    $$(svg, '.mic-glow').forEach(function (g) { g.setAttribute('opacity', (level * 0.35).toFixed(2)); });

    // Monitor: pressure and vibration traced live.
    var now = still ? 7600 : t;
    var pr = trace(900, 7600, now, 37, 223, function (s) {
      return 159 - 17 * (Math.max(track(s, SKIN_DEPTH), 0) / 7) - 0.4 * noise(Math.floor(s / 40));
    }, 40);
    var vt = trace(900, 7600, now, 37, 223, function (s) { return 183 - 9 * vibe(s); }, 12);
    $(svg, '.trace-p').setAttribute('d', pr.d);
    $(svg, '.trace-v').setAttribute('d', vt.d);
    $(svg, '.cursor').setAttribute('d', pr.d ? 'M' + r1(pr.x) + ' 142V192' : '');

    if (t >= 1450 && once('press')) ripple(svg, 130, 69);
    if (t >= 3550 && once('rub')) ripple(svg, 130, 64, 0.7);
  };
  anims.skin.key = 2300;

  // Physical HRI: the robot is at work, carrying a cup, when a person touches
  // its skin. It tells the touches apart and reacts to each one differently,
  // as in our T-RO study: hit -> pause, stroke -> continue, scratch -> return
  // the cup, press -> emergency stop.
  var ARM = (function () {                  // shoulder, elbow, wrist as drawn
    var s = [46, 154], e = [98, 70], w = [192, 88];
    function len(a, b) { return Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])); }
    return { s: s, e: e, w: w, l1: len(s, e), l2: len(e, w),
      a1: Math.atan2(e[1] - s[1], e[0] - s[0]), a2: Math.atan2(w[1] - e[1], w[0] - e[0]) };
  })();
  var HIT = 1860, CONTINUE = 5450, PLACE = 7550, RELEASE = 8450, STOP = 9600;
  var TABLE = [204, 102], AWAY = [172, 72];  // wrist positions: cup on the table; heading away after
  var STATES = [   // [from (ms), state, badge text]
    [0, 'work', 'WORKING'], [1900, 'pause', 'PAUSE'], [5400, 'resume', 'CONTINUE'],
    [7250, 'cup', 'RETURN CUP'], [STOP, 'stop', 'EMERGENCY STOP']
  ];
  var ICONS = {
    work: 'M18 21a3 3 0 1 0 6 0a3 3 0 1 0-6 0Z',
    pause: 'M18.3 18.2h2v5.6h-2ZM21.7 18.2h2v5.6h-2Z',
    resume: 'M18.8 17.8L24.3 21L18.8 24.2Z',
    cup: 'M20.2 17.4h1.6v2.8h2L21 23.2l-3-3h2ZM18 24h6v1.1h-6Z',
    stop: 'M18.3 18.3h5.4v5.4h-5.4Z'
  };

  // Task time: runs while the robot works, stops for the pause, runs again on "continue".
  function runFrom(t, t0, ease) {
    if (t <= t0) return 0;
    var u = (t - t0) / ease;
    return u < 1 ? ease * (u * u * u - u * u * u * u / 2) : t - t0 - ease / 2;
  }
  function wristAt(t) {
    t = Math.min(t, STOP);                    // the emergency stop freezes everything
    var task = runFrom(t, 500, 1) - runFrom(t, HIT, 120) + runFrom(t, CONTINUE, 600);
    var w = [ARM.w[0] + 12 * Math.cos(2 * Math.PI * task / 2200), ARM.w[1]];
    var down = span(t, PLACE, RELEASE), up = span(t, RELEASE + 200, RELEASE + 1200), back = span(t, RELEASE + 450, RELEASE + 2450);
    w = [w[0] + (TABLE[0] - w[0]) * down, w[1] + (TABLE[1] - w[1]) * down];
    return [w[0] + (AWAY[0] - w[0]) * back, w[1] + (AWAY[1] - w[1]) * up];
  }
  // Shoulder and forearm angles (radians) that put the wrist at w, elbow up.
  function reach(w) {
    var dx = w[0] - ARM.s[0], dy = w[1] - ARM.s[1], d = Math.sqrt(dx * dx + dy * dy);
    var a1 = Math.atan2(dy, dx) - Math.acos(clamp((ARM.l1 * ARM.l1 + d * d - ARM.l2 * ARM.l2) / (2 * ARM.l1 * d), -1, 1));
    var ex = ARM.s[0] + ARM.l1 * Math.cos(a1), ey = ARM.s[1] + ARM.l1 * Math.sin(a1);
    return [a1, Math.atan2(w[1] - ey, w[0] - ex)];
  }

  anims.phri = function (svg, t) {
    // The touches: hit, stroke, scratch, press.
    var phase = t < 3500 ? 0 : t < 6100 ? 1 : t < 8700 ? 2 : 3, u = t - [1300, 3500, 6100, 8700][phase];
    setStep(phase);
    var xc, off, dent = 0, tilt = 0, pose = POSES.open, wrist = 50, spread = 12, hold = 0, tau = 300, touchAt = 450;
    var level = function () { return 0; };

    if (phase === 0) {                                    // Hit: a fist strikes and bounces off
      xc = 52; pose = POSES.fist; wrist = 36; spread = 8; touchAt = 560;
      off = track(u, [[0, 1], [420, .4], [560, 0], [820, .34], [1700, 1]]);
      var age = u - 560;
      if (age >= 0) {
        dent = 5 * Math.exp(-age / 150);
        level = function (d) { return Math.exp(-age / 260) * gauss(d, 9) + 0.8 * Math.exp(-age / 520) * gauss(d - age * 0.06, 4); };
      }
      tau = 260;
    } else if (phase === 1) {                             // Stroke: the palm slides along the skin
      xc = track(u, [[0, 72], [450, 72], [1800, 32], [2150, 32]]);
      off = track(u, [[0, 1], [450, 0], [1800, 0], [2150, 1]]);
      pose = POSES.relaxed;
      var touch = span(u, 380, 460) * (1 - span(u, 1750, 1850));
      dent = 2 * touch;
      level = function (d) { return touch * 0.9 * gauss(d, 8); };
      tau = 480;
    } else if (phase === 2) {                             // Scratch: fingertips rake back and forth
      var on = span(u, 380, 460) * (1 - span(u, 1380, 1460)), wig = Math.sin(2 * Math.PI * (u - 450) / 200) * on;
      xc = 56 + 2.5 * wig;
      off = track(u, [[0, 1], [450, 0], [1400, 0], [1800, 1]]);
      pose = mixPose(POSES.claw, { f: POSES.claw.f.map(function (f) { return [f[0] + 9, f[1] + 12, f[2] + 6]; }), t: POSES.claw.t }, 0.5 + 0.5 * wig);
      tilt = -8; wrist = 62; spread = 5;
      dent = 1.2 * on;
      level = function (d) { return on * (0.5 + 0.5 * Math.abs(wig)) * gauss(d, 5); };
      tau = 140;
    } else {                                              // Press: the palm presses and holds
      xc = 48; touchAt = 550;
      off = track(u, [[0, 1], [100, 1], [550, 0], [1800, 0], [2200, 1]]);
      hold = span(u, 420, 600) * (1 - span(u, 1750, 1950));
      dent = 3.6 * hold;
      level = function (d) { return hold * (0.9 + 0.1 * Math.sin(u / 120)) * gauss(d, 13); };
      tau = 200;
    }

    // The robot: where its task has taken the wrist, plus a flinch from the
    // hit, a little give under the press, and a jolt as the brakes lock.
    var ang = reach(wristAt(t)), shake = 0.6 * hold;
    if (t >= HIT) shake += 2.4 * Math.exp(-(t - HIT) / 280) * Math.sin((t - HIT) / 55);
    if (t >= STOP) shake += 0.8 * Math.exp(-(t - STOP) / 120) * Math.sin((t - STOP) / 30);
    var a1 = ang[0] + shake * Math.PI / 180, a2 = ang[1] + shake * Math.PI / 180;
    var elbow = [ARM.s[0] + ARM.l1 * Math.cos(a1), ARM.s[1] + ARM.l1 * Math.sin(a1)];
    var wr = [elbow[0] + ARM.l2 * Math.cos(a2), elbow[1] + ARM.l2 * Math.sin(a2)];
    function deg(a) { return (Math.round(a * 18000 / Math.PI) / 100).toFixed(2); }
    $(svg, '.arm').setAttribute('transform', 'rotate(' + deg(a1 - ARM.a1) + ' 46 154)');
    $(svg, '.lower').setAttribute('transform', 'rotate(' + deg(a2 - a1 - ARM.a2 + ARM.a1) + ' 98 70)');
    $(svg, '.wrist').setAttribute('transform', 'rotate(' + deg(ARM.a2 - a2) + ' 192 88)');   // keeps the cup upright
    var cup = t < RELEASE ? wr : TABLE, open = 2.4 * span(t, RELEASE, RELEASE + 200);
    $(svg, '.cup-g').setAttribute('transform', 'translate(' + pt(cup[0] - ARM.w[0], cup[1] - ARM.w[1]) + ')');
    $$(svg, '.finger').forEach(function (f, i) { f.setAttribute('transform', 'translate(' + r1(i ? open : -open) + ' 0)'); });
    function onArm(x, y) {
      return [elbow[0] + x * Math.cos(a2) - y * Math.sin(a2), elbow[1] + x * Math.sin(a2) + y * Math.cos(a2)];
    }

    // The sleeve dents under the touch.
    function top(x) { return -16 + dent * gauss(x - xc, spread); }
    var d = 'M34 ' + r1(top(34));
    for (var x = 37; x <= 70; x += 3) d += 'L' + x + ' ' + r1(top(x));
    $(svg, '.sleeve').setAttribute('d', d + 'Q80 -16 80 -6V6Q80 16 70 16H34Q24 16 24 6V-6Q24 -16 34 ' + r1(top(34)) + 'Z');

    // The hand comes in from the upper right, touches, and leaves.
    var h = hand(svg), c = onArm(xc, -16 + dent * 0.9);
    drawHand(h, pose);
    placeHand(h, { angle: a2 * 180 / Math.PI + tilt, scale: 0.46, mirror: true, wrist: wrist, contact: [c[0] + off * 64, c[1] - off * 88] });
    if (u >= touchAt && once('touch' + phase)) {
      var r = onArm(xc, -16);
      ripple(svg, r[0], r[1], [1.2, 0.7, 0.6, 1][phase]);
    }
    lightTaxels(svg, t, tau, function (tx, ty) {
      return level(Math.sqrt((tx - xc) * (tx - xc) + 0.35 * (ty + 16) * (ty + 16)));
    });

    // The robot's reaction, on its status badge and base light.
    var i = STATES.length - 1;
    while (STATES[i][0] > t) i--;
    var st = STATES[i];
    if (memo.state !== st[1]) {
      memo.state = st[1];
      svg.setAttribute('data-state', st[1]);
      $(svg, '.status-icon').setAttribute('d', ICONS[st[1]]);
      var label = $(svg, '.status-v');
      label.textContent = st[2];
      try { var b = label.getBBox(); $(svg, '.status-box').setAttribute('width', r1(b.x + b.width - 3)); } catch (e) {}
    }
    var pop = i && !still ? 1 + 0.12 * (1 - span(t - st[0], 0, 300)) : 1;
    $(svg, '.status').setAttribute('transform', 'translate(10 21) scale(' + pop.toFixed(3) + ') translate(-10 -21)');
    var blink = st[1] === 'stop' && !still && Math.floor((t - STOP) / 320) % 2 === 1 ? 0.3 : 1;
    $(svg, '.status-icon').style.opacity = blink;
    $(svg, '.base-led').style.opacity = blink;
  };
  anims.phri.key = 10000;

  // Bio-signal interface: rest, then the grasp intention is detected from the
  // first muscle activity (EMG), then the hand moves with full muscle activity.
  var THRESHOLD = 13;
  function emgLevel(s) {
    if (s < 3250) return 0.7;
    if (s < 6000) return 0.7 + 15.3 * span(s, 3250, 4600) * (0.85 + 0.15 * Math.sin(s / 160));
    return 16 + 8 * span(s, 6000, 6400) * (0.8 + 0.2 * Math.sin(2 * Math.PI * s / 700));
  }
  function emg(s) {
    var k = Math.floor(s / 14);
    return emgLevel(s) * (0.65 * noise(k) + 0.35 * noise(k * 1.7 + 3));
  }
  var DETECT = (function () {
    for (var s = 3250; s < 6000; s += 14) if (Math.abs(emg(s)) > THRESHOLD) return s;
    return 4400;
  })();
  function grip(t) {
    return track(t, [[0, 0], [6150, 0], [6700, .36], [6900, .3], [7500, .72], [7700, .66], [8300, .95]]);
  }
  anims.biosignal = function (svg, t) {
    setStep(t < 3000 ? 0 : t < 6000 ? 1 : 2);
    drawHand(hand(svg), mixPose(POSES.relaxed, POSES.fist, grip(t)));

    var ghost = $(svg, '.ghost-hand');
    if (!memo.ghost) {
      memo.ghost = true;
      // The intended grip, shown by the index finger and thumb of a closed hand.
      var gs = $$(svg, '.h-ghost'), fist = digits(POSES.fist);
      gs[0].setAttribute('d', fist[3].d);
      gs[1].setAttribute('d', fist[4].d);
    }
    ghost.setAttribute('opacity', (0.9 * span(t, DETECT, DETECT + 400) * (1 - span(t, 6200, 7700))).toFixed(2));

    var level = clamp(emgLevel(t) / 24, 0, 1);
    $$(svg, '.electrode').forEach(function (e, i) {
      var a = clamp(level * (0.75 + 0.25 * noise(i + 1)) * (0.85 + 0.15 * noise(Math.floor(t / 60) + i)), 0, 1);
      e.style.fill = mix(BLUE, ACCENT, a);
      e.setAttribute('r', r1(1.8 + 0.7 * a));
    });

    var now = still ? 8800 : t;
    var tr = trace(400, 8800, now, 29, 231, function (s) { return 168 - emg(s); }, 14);
    $(svg, '.trace-emg').setAttribute('d', tr.d);
    $(svg, '.cursor').setAttribute('d', tr.d ? 'M' + r1(tr.x) + ' 132V194' : '');

    var shown = now >= DETECT;
    $(svg, '.detect').setAttribute('opacity', shown ? span(now, DETECT, DETECT + 250).toFixed(2) : 0);
    if (shown && !memo.marked) {
      memo.marked = true;
      var dx = 29 + 202 * (DETECT - 400) / 8400;
      $(svg, '.detect-line').setAttribute('d', 'M' + r1(dx) + ' 143V194');
      var dot = $(svg, '.detect-dot');
      dot.setAttribute('cx', r1(dx));
      dot.setAttribute('cy', r1(168 - emg(DETECT)));
      $(svg, '.detect-label').setAttribute('x', r1(dx + 4));
    }
    if (t >= DETECT && once('detect')) ripple(svg, 80, 78);
    if (t >= 6300 && once('move')) ripple(svg, 190, 80, 0.8);
  };
  anims.biosignal.key = 7600;

  // Join us.
  anims.join = function (svg, t) {
    // A dashed, empty place in the group fills in: a place for you.
    var filled = t >= 1300;
    $(svg, '.you').classList.toggle('is-filled', filled);
    if (filled && once('join')) ripple(svg, 130, 80);
  };
  anims.join.key = 2000;

  /* Scenes, timing, controls -------------------------------------------- */

  function duration(i) { return (parseFloat(scenes[i].getAttribute('data-seconds')) || 7) * 1000; }
  function art(i) { return scenes[i].querySelector('svg[data-anim]'); }
  function animate(t) {
    var svg = art(index);
    var fn = svg && anims[svg.getAttribute('data-anim')];
    if (fn) fn(svg, t);
  }
  function isPaused() { return userPaused || offscreen || document.hidden; }

  function show(n, asStill) {
    index = (n + scenes.length) % scenes.length;
    elapsed = 0;
    memo = {};
    scenes.forEach(function (scene, i) {
      var on = i === index;
      scene.classList.toggle('is-active', on);
      scene.classList.toggle('is-static', on && !!asStill);
      scene.setAttribute('aria-hidden', on ? 'false' : 'true');
      if ('inert' in scene) scene.inert = !on;
    });
    chapters.forEach(function (c, i) {
      if (i === index) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
    if (asStill) {
      var svg = art(index), fn = svg && anims[svg.getAttribute('data-anim')];
      still = true;
      if (fn) fn(svg, fn.key || 0);
      still = false;
    } else {
      animate(0);
    }
    updateBars();
  }

  function updateBars() {
    var d = duration(index);
    bars.forEach(function (bar, i) {
      var fill = i < index ? 1 : i === index ? Math.min(1, elapsed / d) : 0;
      bar.style.width = (fill * 100).toFixed(2) + '%';
    });
  }

  function frame(now) {
    // frameId stays set while this frame runs, so a ripple started here
    // doesn't schedule a second loop.
    var dt = lastFrame ? Math.min(now - lastFrame, 100) : 0;
    lastFrame = now;
    if (!isPaused()) {
      elapsed += dt;
      if (elapsed >= duration(index)) show(index + 1);
      else animate(elapsed);
      updateBars();
    }
    if (ripples.length) draw(now);
    frameId = 0;
    if (!isPaused() || ripples.length) frameId = requestAnimationFrame(frame);
    else lastFrame = 0;
  }

  function start() {
    root.classList.toggle('is-paused', isPaused());
    if (!frameId) { lastFrame = 0; frameId = requestAnimationFrame(frame); }
  }

  function setPaused(paused) {
    userPaused = paused;
    toggle.classList.toggle('is-paused', paused);
    toggle.setAttribute('aria-label', paused ? 'Play introduction' : 'Pause introduction');
    // A still frame restarts its scene from the beginning when playback resumes.
    if (!paused && scenes[index].classList.contains('is-static')) show(index);
    start();
  }

  toggle.addEventListener('click', function () { setPaused(!userPaused); });

  chapters.forEach(function (chapter, i) {
    chapter.addEventListener('click', function () {
      show(i, userPaused);
      start();
    });
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      offscreen = !entries[0].isIntersecting;
      start();
    }).observe(root);
  }
  document.addEventListener('visibilitychange', start);

  var onMotionChange = function () { if (reduceMotion.matches) { setPaused(true); show(index, true); } };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onMotionChange);
  else if (reduceMotion.addListener) reduceMotion.addListener(onMotionChange);

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(root);
  else window.addEventListener('resize', resize);

  // For checking a frame by hand in the browser console: hriIntro.frame(2, 3800)
  window.hriIntro = {
    frame: function (n, t) {
      setPaused(true);
      show(n, true);
      var svg = art(index), fn = svg && anims[svg.getAttribute('data-anim')];
      previewing = true;
      memo = {};
      if (fn) fn(svg, t);
      previewing = false;
    }
  };

  // Text-sized parts of a drawing (the status badge) are measured again once the web font is in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      memo.state = null;
      if (scenes[index].classList.contains('is-static')) show(index, true);
    });
  }

  show(0, userPaused);
  setPaused(userPaused);
  resize();
})();
