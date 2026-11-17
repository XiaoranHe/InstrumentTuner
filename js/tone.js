/* ============================================================
 * tone.js · 参考音合成（按下钢琴键发声）
 * ============================================================ */
(function (global) {
  'use strict';

  function TonePlayer(options) {
    options = options || {};
    this.ctx = options.ctx || null;
    this.enabled = options.enabled !== false;
    this.volume = options.volume || 0.3;
    this._master = null;
    this._voice = null;
    this._playing = null;
    this._ownsCtx = false;
  }

  /** 绑定 / 创建 AudioContext */
  TonePlayer.prototype.setContext = function (ctx) {
    this.stopImmediate();

    var old = this.ctx;
    var owned = this._ownsCtx;

    this.ctx = ctx || null;
    this._ownsCtx = false;
    this._master = null;
    this._voice = null;
    this._playing = null;

    // 自己创建的临时上下文，切换时回收
    if (owned && old && old !== ctx && old.state !== 'closed') {
      try { old.close(); } catch (e) { /* ignore */ }
    }
  };

  TonePlayer.prototype._ensure = function () {
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this._ownsCtx = true;
    }
    if (!this._master) {
      this._master = this.ctx.createGain();
      this._master.gain.value = 1;
      this._master.connect(this.ctx.destination);
    }
    return this.ctx;
  };

  /** 播放指定 MIDI 音高的持续参考音 */
  TonePlayer.prototype.play = function (midi) {
    if (!this.enabled) return;
    if (this._playing === midi && this._voice) return;

    var ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();

    this.stopImmediate();

    var freq = global.Notes.midiToFreq(midi);
    var now = ctx.currentTime;

    var gain = ctx.createGain();
    var peak = this.volume * (midi < 36 ? 1.15 : 1);
    var sustain = peak * 0.34;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(sustain, now + 1.7);

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(11000, freq * 7 + 400), now);
    filter.Q.value = 0.6;

    var oscs = [];

    var o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(freq, now);
    o1.connect(filter);
    oscs.push(o1);

    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 2, now);
    var g2 = ctx.createGain();
    g2.gain.value = 0.24;
    o2.connect(g2);
    g2.connect(filter);
    oscs.push(o2);

    if (freq < 700) {
      var o3 = ctx.createOscillator();
      o3.type = 'sine';
      o3.frequency.setValueAtTime(freq * 3, now);
      var g3 = ctx.createGain();
      g3.gain.value = 0.1;
      o3.connect(g3);
      g3.connect(filter);
      oscs.push(o3);
    }

    filter.connect(gain);
    gain.connect(this._master);

    for (var i = 0; i < oscs.length; i++) oscs[i].start(now);

    this._voice = { gain: gain, oscs: oscs };
    this._playing = midi;
  };

  /** 停止当前参考音（带淡出） */
  TonePlayer.prototype.stop = function (fade) {
    var voice = this._voice;
    this._voice = null;
    this._playing = null;
    if (!voice || !this.ctx) return;

    var now = this.ctx.currentTime;
    var dur = (fade === undefined ? 0.07 : fade);
    var g = voice.gain.gain;

    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, 0.0001), now);
      g.exponentialRampToValueAtTime(0.0001, now + dur);
    } catch (e) { /* ignore */ }

    for (var i = 0; i < voice.oscs.length; i++) {
      try { voice.oscs[i].stop(now + dur + 0.02); } catch (e2) { /* ignore */ }
    }
    voice.gain.gain.onended = null;
  };

  TonePlayer.prototype.stopImmediate = function () {
    var voice = this._voice;
    this._voice = null;
    this._playing = null;
    if (!voice || !this.ctx) return;
    var now = this.ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(0.0001, now);
    } catch (e) { /* ignore */ }
    for (var i = 0; i < voice.oscs.length; i++) {
      try { voice.oscs[i].stop(now + 0.01); } catch (e2) { /* ignore */ }
    }
  };

  TonePlayer.prototype.isPlaying = function () {
    return this._playing !== null;
  };

  TonePlayer.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (!this.enabled) this.stop();
  };

  global.TonePlayer = TonePlayer;
})(window);
