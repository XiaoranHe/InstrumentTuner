/* ============================================================
 * chart.js · 音准曲线图（Canvas 2D）
 *  - 横轴：时间（最近 N 秒滚动）
 *  - 纵轴：固定音高轴 A0 → C8（低音在下，高音在上）
 *  - 按下钢琴键后，在对应音高高度绘制基准线
 * ============================================================ */
(function (global) {
  'use strict';

  var Notes = global.Notes;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function PitchChart(canvas, options) {
    options = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.windowMs = options.windowMs || 20000;

    this.samples = [];
    this.refMidi = null; // 用户选中的基准键（null = 自动跟随）
    this.live = null;
    this.statusText = '';

    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;

    this._raf = null;
    this._resize = this._resize.bind(this);

    this._observeSize();
    this._resize();
    this.start();
  }

  /* ---------------- 尺寸 ---------------- */

  PitchChart.prototype._observeSize = function () {
    var self = this;
    if (typeof global.ResizeObserver === 'function') {
      this._ro = new global.ResizeObserver(function () { self._resize(); });
      this._ro.observe(this.canvas);
    } else {
      global.addEventListener('resize', this._resize);
      global.addEventListener('orientationchange', this._resize);
    }
  };

  PitchChart.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 3);
    this.dpr = dpr;
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  /* ---------------- 数据 ---------------- */

  /** 写入一个检测点；m = 浮点 MIDI，ref = 该点使用的基准 MIDI */
  PitchChart.prototype.push = function (m, ref) {
    var t = (global.performance || Date).now();
    this.samples.push({ t: t, m: m, ref: ref });
    var cutoff = t - this.windowMs - 3000;
    var drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
    this.live = { t: t, m: m, ref: ref };
  };

  PitchChart.prototype.clear = function () {
    this.samples.length = 0;
    this.live = null;
    this.draw();
  };

  PitchChart.prototype.setRef = function (midi) {
    this.refMidi = (midi === undefined ? null : midi);
  };

  PitchChart.prototype.setStatus = function (text) {
    this.statusText = text || '';
  };

  PitchChart.prototype.hasData = function () {
    return this.samples.length > 0;
  };

  /* ---------------- 渲染循环 ---------------- */

  PitchChart.prototype.start = function () {
    var self = this;
    if (this._raf) return;
    var loop = function () {
      self.draw();
      self._raf = global.requestAnimationFrame(loop);
    };
    this._raf = global.requestAnimationFrame(loop);
  };

  PitchChart.prototype.stop = function () {
    if (this._raf) {
      global.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  };

  /* ---------------- 主绘制 ---------------- */

  PitchChart.prototype.draw = function () {
    var ctx = this.ctx;
    var W = this.cssW;
    var H = this.cssH;
    if (!W || !H) return;

    ctx.clearRect(0, 0, W, H);

    var padL = 34;
    var padR = 10;
    var padT = 10;
    var padB = 16;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    if (plotW < 20 || plotH < 20) return;

    // 纵轴固定为钢琴全音域 A0(21) → C8(108)：低音在下，高音在上
    var lo = Notes.MIDI_MIN;
    var hi = Notes.MIDI_MAX;
    var span = hi - lo;

    var now = (global.performance || Date).now();
    var t0 = now - this.windowMs;
    var pxPerMs = plotW / this.windowMs;

    var xOf = function (t) { return padL + (t - t0) * pxPerMs; };
    var yOf = function (m) { return padT + plotH * (1 - (clamp(m, lo, hi) - lo) / span); };

    /* --- 1. 半音纹理（空间够时才画，避免小屏上过密） --- */
    if (plotH / span >= 3.2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.022)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var m1 = lo; m1 <= hi; m1++) {
        var sy = Math.round(yOf(m1)) + 0.5;
        ctx.moveTo(padL, sy);
        ctx.lineTo(padL + plotW, sy);
      }
      ctx.stroke();
    }

    /* --- 2. 八度网格（每个 C 一条稍亮横线） --- */
    ctx.strokeStyle = 'rgba(255,255,255,0.085)';
    ctx.beginPath();
    for (var m2 = 24; m2 <= hi; m2 += 12) {
      var oy = Math.round(yOf(m2)) + 0.5;
      ctx.moveTo(padL, oy);
      ctx.lineTo(padL + plotW, oy);
    }
    ctx.stroke();

    /* --- 3. 纵向时间网格（每 5 秒） --- */
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (var s = 0; s <= this.windowMs; s += 5000) {
      var gx = Math.round(padL + s * pxPerMs) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + plotH);
      ctx.stroke();
    }

    /* --- 4. 纵轴音名刻度 --- */
    ctx.fillStyle = 'rgba(125,143,160,0.85)';
    ctx.font = '9px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var m3 = 24; m3 <= hi; m3 += 12) {
      var nm = Notes.midiToName(m3);
      ctx.fillText(nm.label, padL - 5, yOf(m3));
    }
    // A0 只在与 C1 拉开足够间距时标注，避免小屏重叠
    if (yOf(lo) - yOf(24) > 14) {
      ctx.fillText('A0', padL - 5, Math.min(yOf(lo), padT + plotH - 6));
    }

    /* --- 5. 基准线：画在选中键对应的音高高度 --- */
    var isKeyRef = this.refMidi !== null && this.refMidi !== undefined;

    if (isKeyRef) {
      var refY = yOf(this.refMidi);
      var refName = Notes.midiToName(this.refMidi);
      var refFreq = Notes.midiToFreq(this.refMidi);

      // 该键 ±50¢（半个半音）范围的准音带
      var halfH = Math.max(3, plotH / span / 2);
      var band = ctx.createLinearGradient(0, refY - halfH, 0, refY + halfH);
      band.addColorStop(0, 'rgba(67,226,191,0)');
      band.addColorStop(0.5, 'rgba(67,226,191,0.20)');
      band.addColorStop(1, 'rgba(67,226,191,0)');
      ctx.fillStyle = band;
      ctx.fillRect(padL, refY - halfH, plotW, halfH * 2);

      ctx.save();
      ctx.strokeStyle = 'rgba(67, 226, 191, 0.95)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = 'rgba(67, 226, 191, 0.85)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(padL, refY + 0.5);
      ctx.lineTo(padL + plotW, refY + 0.5);
      ctx.stroke();
      ctx.restore();

      // 基准线标签（靠近上下边缘时自动翻转，避免超出画布）
      var label = refName.label + ' · ' + Notes.formatFreq(refFreq);
      ctx.font = '600 10px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      var tw = ctx.measureText(label).width;
      var bx = padL + plotW - tw - 14;
      var by = refY - 9;
      if (by < padT + 8) by = refY + 9;
      if (by > padT + plotH - 8) by = refY - 9;
      ctx.fillStyle = 'rgba(67, 226, 191, 0.92)';
      roundRect(ctx, bx, by - 8, tw + 10, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#04120f';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 5, by + 0.5);
    }

    /* --- 6. 曲线（绝对音高 + 中点二次贝塞尔平滑） --- */
    var samples = this.samples;
    var first = 0;
    while (first < samples.length && samples[first].t < t0 - 1000) first++;

    if (samples.length - first > 1) {
      // 按时间断层切分：只在静音间隔过长处断开（绝对音高连续，无需按基准音断线）
      var segs = [];
      var pts = [];
      var lastX = -Infinity;

      for (var k = first; k < samples.length; k++) {
        var sp = samples[k];
        var x = xOf(sp.t);
        var y = yOf(sp.m);
        if (pts.length && x - lastX > 120) {
          segs.push(pts);
          pts = [];
        }
        pts.push({ x: x, y: y });
        lastX = x;
      }
      if (pts.length) segs.push(pts);

      var paths = [];
      for (var g = 0; g < segs.length; g++) paths.push(smoothPath(segs[g]));

      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT - 2, plotW, plotH + 4);
      ctx.clip();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // 底层光晕
      ctx.strokeStyle = 'rgba(67, 226, 191, 0.16)';
      ctx.lineWidth = 6;
      for (var a = 0; a < paths.length; a++) ctx.stroke(paths[a]);

      // 主曲线
      ctx.strokeStyle = 'rgba(67, 226, 191, 0.95)';
      ctx.lineWidth = 2;
      for (var b = 0; b < paths.length; b++) ctx.stroke(paths[b]);

      ctx.restore();

      /* --- 7. 当前值标记 --- */
      var live = this.live;
      if (live && now - live.t < 1200) {
        var lx = xOf(live.t);
        var ly = yOf(live.m);
        if (lx > padL && lx < padL + plotW) {
          var curDev = (live.m - Math.round(live.m)) * 100;
          var devAbs = Math.abs(curDev);
          var dotColor = devAbs <= 5 ? '#b9fff0' : devAbs <= 15 ? '#ffd977' : '#ff9b8a';
          var haloColor = devAbs <= 5 ? 'rgba(67, 226, 191, 0.20)' : 'rgba(255, 180, 120, 0.20)';

          ctx.save();
          ctx.beginPath();
          ctx.arc(lx, ly, 8, 0, Math.PI * 2);
          ctx.fillStyle = haloColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(lx, ly, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.shadowColor = dotColor;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.restore();
        }
      }
    }

    /* --- 8. 顶部信息 --- */
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    if (this.statusText) {
      ctx.font = '10px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(125, 143, 160, 0.9)';
      ctx.fillText(this.statusText, padL + 2, padT + 2);
    }

    // 实时音名 + 与本音的音分偏差（右上角）
    if (this.live && now - this.live.t < 1200) {
      var liveInfo = Notes.midiToName(this.live.m);
      var dev = (this.live.m - liveInfo.midi) * 100;
      var txt = liveInfo.label + '  ' + (dev >= 0 ? '+' : '') + dev.toFixed(0) + '¢';
      ctx.font = '600 11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = Math.abs(dev) <= 5 ? 'rgba(185, 255, 240, 0.95)'
        : Math.abs(dev) <= 15 ? 'rgba(255, 217, 119, 0.95)' : 'rgba(255, 155, 138, 0.95)';
      ctx.fillText(txt, padL + plotW - 2, padT + 2);
    }

    // 时间轴尾部
    ctx.font = '9px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(85, 99, 111, 0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('-' + Math.round(this.windowMs / 1000) + 's', padL + 2, padT + plotH + 7);
    ctx.textAlign = 'right';
    ctx.fillText('现在', padL + plotW - 2, padT + plotH + 7);
  };

  /** 用中点二次贝塞尔把折线平滑成曲线 */
  function smoothPath(pts) {
    var p = new Path2D();
    var n = pts.length;
    if (!n) return p;
    p.moveTo(pts[0].x, pts[0].y);
    if (n === 1) {
      p.lineTo(pts[0].x + 0.01, pts[0].y);
      return p;
    }
    if (n === 2) {
      p.lineTo(pts[1].x, pts[1].y);
      return p;
    }
    for (var i = 1; i < n - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2;
      var my = (pts[i].y + pts[i + 1].y) / 2;
      p.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    p.quadraticCurveTo(pts[n - 1].x, pts[n - 1].y, pts[n - 1].x, pts[n - 1].y);
    return p;
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  global.PitchChart = PitchChart;
})(window);
