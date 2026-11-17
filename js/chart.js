/* ============================================================
 * chart.js · 音准曲线图（Canvas 2D）
 *  - 横轴：时间（最近 N 秒滚动）
 *  - 纵轴：音分偏差 ±50¢
 *  - 按下钢琴键后，绘制对应的基准线
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
    this.rangeCents = options.rangeCents || 50;

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

    var padL = 30;
    var padR = 10;
    var padT = 10;
    var padB = 16;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    if (plotW < 20 || plotH < 20) return;

    var yMid = padT + plotH / 2;
    var pxPerCent = plotH / (this.rangeCents * 2);
    var range = this.rangeCents;

    var now = (global.performance || Date).now();
    var t0 = now - this.windowMs;
    var pxPerMs = plotW / this.windowMs;

    var xOf = function (t) { return padL + (t - t0) * pxPerMs; };
    var yOf = function (cents) { return yMid - clamp(cents, -range, range) * pxPerCent; };

    /* --- 1. 容差带（±5¢） --- */
    ctx.fillStyle = 'rgba(67, 226, 191, 0.10)';
    ctx.fillRect(padL, yOf(-5), plotW, yOf(5) - yOf(-5));

    /* --- 2. 横向网格（每 10¢） --- */
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    for (var c = -50; c <= 50; c += 10) {
      if (c === 0) continue;
      var y = yOf(c);
      ctx.beginPath();
      ctx.moveTo(padL, y + 0.5);
      ctx.lineTo(padL + plotW, y + 0.5);
      ctx.stroke();
    }

    /* --- 3. 纵向时间网格（每 5 秒） --- */
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (var s = 0; s <= this.windowMs; s += 5000) {
      var gx = Math.round(padL + s * pxPerMs) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + plotH);
      ctx.stroke();
    }

    /* --- 4. 纵轴刻度 --- */
    ctx.fillStyle = 'rgba(125,143,160,0.85)';
    ctx.font = '9px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var ticks = [50, 25, 0, -25, -50];
    for (var i = 0; i < ticks.length; i++) {
      var tv = ticks[i];
      ctx.fillText(tv > 0 ? '+' + tv : String(tv), padL - 6, yOf(tv));
    }

    /* --- 5. 零线与基准线 --- */
    var isKeyRef = this.refMidi !== null && this.refMidi !== undefined;

    if (isKeyRef) {
      var refName = Notes.midiToName(this.refMidi);
      var refFreq = Notes.midiToFreq(this.refMidi);

      // 发光基准带
      var glow = ctx.createLinearGradient(0, yMid - 14, 0, yMid + 14);
      glow.addColorStop(0, 'rgba(67,226,191,0)');
      glow.addColorStop(0.5, 'rgba(67,226,191,0.16)');
      glow.addColorStop(1, 'rgba(67,226,191,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(padL, yMid - 14, plotW, 28);

      ctx.save();
      ctx.strokeStyle = 'rgba(67, 226, 191, 0.95)';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = 'rgba(67, 226, 191, 0.85)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(padL, yMid + 0.5);
      ctx.lineTo(padL + plotW, yMid + 0.5);
      ctx.stroke();
      ctx.restore();

      // 基准线标签
      var label = refName.label + ' · ' + Notes.formatFreq(refFreq);
      ctx.font = '600 10px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      var tw = ctx.measureText(label).width;
      var bx = padL + plotW - tw - 14;
      var by = yMid - 9;
      ctx.fillStyle = 'rgba(67, 226, 191, 0.92)';
      roundRect(ctx, bx, by - 8, tw + 10, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#04120f';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 5, by + 0.5);
    } else {
      // 自动模式：中性零线（虚线）
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, yMid + 0.5);
      ctx.lineTo(padL + plotW, yMid + 0.5);
      ctx.stroke();
      ctx.restore();
    }

    /* --- 6. 曲线 --- */
    var samples = this.samples;
    var first = 0;
    while (first < samples.length && samples[first].t < t0 - 1000) first++;

    if (samples.length - first > 1) {
      var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0.00, 'rgba(255, 107, 107, 0.95)');
      grad.addColorStop(0.30, 'rgba(255, 200, 87, 0.95)');
      grad.addColorStop(0.44, 'rgba(67, 226, 191, 1)');
      grad.addColorStop(0.56, 'rgba(67, 226, 191, 1)');
      grad.addColorStop(0.70, 'rgba(255, 200, 87, 0.95)');
      grad.addColorStop(1.00, 'rgba(255, 107, 107, 0.95)');

      // 先构建分段路径（基准音变化处断开），再双层描边：底层象光晕，顶层主曲线
      var paths = [];
      var cur = null;
      var prevRef = null;
      var lastX = -Infinity;

      for (var k = first; k < samples.length; k++) {
        var sp = samples[k];
        var x = xOf(sp.t);
        var cents = (sp.m - sp.ref) * 100;
        var y2 = yOf(cents);

        if (!cur || sp.ref !== prevRef || x - lastX > 120) {
          cur = new Path2D();
          cur.moveTo(x, y2);
          paths.push(cur);
        } else {
          cur.lineTo(x, y2);
        }
        prevRef = sp.ref;
        lastX = x;
      }

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
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      for (var b = 0; b < paths.length; b++) ctx.stroke(paths[b]);

      ctx.restore();

      /* --- 7. 当前值标记 --- */
      var live = this.live;
      if (live && now - live.t < 1200) {
        var lx = xOf(live.t);
        var ly = yOf((live.m - live.ref) * 100);
        if (lx > padL && lx < padL + plotW) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(lx, ly, 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(67, 226, 191, 0.18)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(lx, ly, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = '#b9fff0';
          ctx.shadowColor = 'rgba(67, 226, 191, 0.95)';
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

    // 实时音名（右上角）
    if (this.live && now - this.live.t < 1200) {
      var cur = Notes.midiToName(this.live.m);
      var dev = (this.live.m - this.live.ref) * 100;
      var txt = cur.label + '  ' + (dev >= 0 ? '+' : '') + dev.toFixed(0) + '¢';
      ctx.font = '600 11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      var over = Math.abs(dev) > range;
      ctx.fillStyle = over ? 'rgba(255,200,87,0.95)' : 'rgba(185, 255, 240, 0.95)';
      ctx.fillText(txt, padL + plotW - 2, padT + 2);
      if (over) {
        ctx.font = '9px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(255, 200, 87, 0.7)';
        ctx.fillText('超出显示范围', padL + plotW - 2, padT + 15);
      }
    }

    // 时间轴尾部
    ctx.font = '9px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(85, 99, 111, 0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('-' + Math.round(this.windowMs / 1000) + 's', padL + 2, padT + plotH + 7);
    ctx.textAlign = 'right';
    ctx.fillText('现在', padL + plotW - 2, padT + plotH + 7);
  };

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
