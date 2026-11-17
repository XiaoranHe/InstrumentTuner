/* ============================================================
 * pitch.js · 音高检测（YIN 算法 + 中值平滑）
 * 参考: de Cheveigné & Kawahara (2002) YIN
 *   - 低频段在 2 倍降采样信号上计算，降低运算量
 *   - 高频段在原始采样率上局部重算，保证上限精度
 * ============================================================ */
(function (global) {
  'use strict';

  /**
   * 通用 YIN 估计（返回亚采样精度的周期长度）
   * @param {Float32Array} x        已去直流信号的样本
   * @param {number} tauMin         最小检测周期（样本）
   * @param {number} tauMax         最大检测周期（样本）
   * @param {number} threshold      绝对阈值
   * @param {number} fallback       兜底阈值（全局最小值）
   * @param {Object} scratch        复用的数组缓存
   */
  function yinTau(x, tauMin, tauMax, threshold, fallback, scratch) {
    var n = x.length;
    var W = n - tauMax;
    if (W < 64 || tauMax <= tauMin + 1) return null;

    var diff = scratch.diff;
    if (!diff || diff.length < tauMax + 2) diff = scratch.diff = new Float32Array(tauMax + 2);
    var cmnd = scratch.cmnd;
    if (!cmnd || cmnd.length < tauMax + 2) cmnd = scratch.cmnd = new Float32Array(tauMax + 2);

    var tau, j, v;
    for (tau = 0; tau <= tauMax; tau++) {
      var acc = 0;
      var off = tau;
      for (j = 0; j < W; j++) {
        v = x[j] - x[j + off];
        acc += v * v;
      }
      diff[tau] = acc;
    }

    cmnd[0] = 1;
    var running = 0;
    for (tau = 1; tau <= tauMax; tau++) {
      running += diff[tau];
      cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
    }

    var tauEst = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        tauEst = tau;
        break;
      }
    }

    if (tauEst < 0) {
      var best = Infinity;
      for (tau = tauMin; tau <= tauMax; tau++) {
        if (cmnd[tau] < best) {
          best = cmnd[tau];
          tauEst = tau;
        }
      }
      if (best > fallback) return null;
    }

    while (tauEst + 1 <= tauMax && cmnd[tauEst + 1] < cmnd[tauEst]) tauEst++;

    // 抛物线插值
    var betterTau = tauEst;
    if (tauEst > 1 && tauEst < tauMax) {
      var s0 = cmnd[tauEst - 1];
      var s1 = cmnd[tauEst];
      var s2 = cmnd[tauEst + 1];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (Math.abs(denom) > 1e-12) {
        var shift = (s2 - s0) / denom;
        if (shift > -1 && shift < 1) betterTau = tauEst + shift;
      }
    }

    return {
      tau: betterTau,
      clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst]))
    };
  }

  /**
   * @param {Object} options
   *  - sampleRate  实际采样率
   *  - fmin/fmax   检测频率范围 (Hz)
   *  - threshold   YIN 绝对阈值（越小越严格）
   *  - silenceRms  静音门限（RMS）
   */
  function PitchDetector(options) {
    options = options || {};
    this.sampleRate = options.sampleRate || 48000;
    this.fmin = options.fmin || 27;
    this.fmax = options.fmax || 4500;
    this.threshold = options.threshold || 0.14;
    this.fallbackThreshold = options.fallbackThreshold || 0.5;
    this.silenceRms = options.silenceRms || 0.0028;

    // 高频重算阈值：初检频率高于该值则用原始采样率精算
    this.hiRefreshFreq = options.hiRefreshFreq || 900;

    this._ds = null;
    this._scratchLo = { diff: null, cmnd: null };
    this._scratchHi = { diff: null, cmnd: null };
  }

  var INVALID = { valid: false, freq: 0, clarity: 0, rms: 0, level: 0 };

  /**
   * 在时域缓冲上检测基频
   * @param {Float32Array} buf 时域样本
   * @returns {{valid:boolean, freq:number, clarity:number, rms:number, level:number}}
   */
  PitchDetector.prototype.detect = function (buf) {
    var n = buf.length;
    if (!n) return INVALID;

    var i, v;
    var sum = 0;
    for (i = 0; i < n; i++) sum += buf[i];
    var mean = sum / n;

    var energy = 0;
    for (i = 0; i < n; i++) {
      v = buf[i] - mean;
      energy += v * v;
    }
    var rms = Math.sqrt(energy / n);
    var level = Math.min(1, Math.max(0, Math.log10(Math.max(rms, 1e-6) / 1e-4) / Math.log10(0.35 / 1e-4)));

    if (rms < this.silenceRms) {
      return { valid: false, freq: 0, clarity: 0, rms: rms, level: level };
    }

    // ---- 1. 2 倍降采样 ----
    var m = n >> 1;
    var srLo = this.sampleRate * 0.5;
    var ds = this._ds;
    if (!ds || ds.length !== m) ds = this._ds = new Float32Array(m);
    for (i = 0; i < m; i++) {
      ds[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5 - mean;
    }

    var tauMin = Math.max(3, Math.floor(srLo / this.fmax));
    var tauMax = Math.min(Math.floor(srLo / this.fmin), m - 8);

    var est = yinTau(ds, tauMin, tauMax, this.threshold, this.fallbackThreshold, this._scratchLo);
    if (!est || est.tau <= 0) {
      return { valid: false, freq: 0, clarity: 0, rms: rms, level: level };
    }

    var freq = srLo / est.tau;
    var clarity = est.clarity;

    // ---- 2. 高频段用原始采样率精算 ----
    if (freq > this.hiRefreshFreq) {
      var orig = this._orig;
      if (!orig || orig.length !== n) orig = this._orig = new Float32Array(n);
      for (i = 0; i < n; i++) orig[i] = buf[i] - mean;

      var srHi = this.sampleRate;
      var hiTauMin = Math.max(2, Math.floor(srHi / this.fmax));
      var hiTauMax = Math.min(Math.ceil(srHi / this.hiRefreshFreq), (n >> 1) - 8);

      var estHi = yinTau(orig, hiTauMin, hiTauMax, this.threshold, this.fallbackThreshold, this._scratchHi);
      if (estHi && estHi.tau > 0) {
        freq = srHi / estHi.tau;
        clarity = estHi.clarity;
      }
    }

    if (!isFinite(freq) || freq < this.fmin || freq > this.fmax) {
      return { valid: false, freq: 0, clarity: 0, rms: rms, level: level };
    }

    return {
      valid: clarity > 0.5,
      freq: freq,
      clarity: clarity,
      rms: rms,
      level: level
    };
  };

  /**
   * 中值平滑器：抑制八度跳变和瞬时毛刺
   */
  function PitchSmoother(size) {
    this.size = size || 5;
    this.values = [];
    this.last = null;
  }

  PitchSmoother.prototype.push = function (midi) {
    if (this.last !== null && Math.abs(midi - this.last) > 1.0) {
      this.values.length = 0;
    }
    this.values.push(midi);
    if (this.values.length > this.size) this.values.shift();
    this.last = midi;

    if (this.values.length < 3) return midi;

    var sorted = this.values.slice().sort(function (a, b) { return a - b; });
    return sorted[sorted.length >> 1];
  };

  PitchSmoother.prototype.reset = function () {
    this.values.length = 0;
    this.last = null;
  };

  global.PitchDetector = PitchDetector;
  global.PitchSmoother = PitchSmoother;
})(window);
