/* ============================================================
 * notes.js · 音名 / 频率 / 音分 换算工具
 * ============================================================ */
(function (global) {
  'use strict';

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var BLACK_PC = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };

  var A4_MIDI = 69;
  var A4_FREQ = 440;
  var MIDI_MIN = 21; // A0
  var MIDI_MAX = 108; // C8

  /** MIDI 音高 -> 频率 (Hz) */
  function midiToFreq(midi) {
    return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
  }

  /** 频率 (Hz) -> 浮点 MIDI 音高 */
  function freqToMidi(freq) {
    return A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
  }

  /** 频率比 -> 音分 */
  function freqToCents(freq, refFreq) {
    return 1200 * Math.log2(freq / refFreq);
  }

  /** MIDI 音高 -> 音名信息 */
  function midiToName(midi) {
    var m = Math.round(midi);
    var pc = ((m % 12) + 12) % 12;
    var octave = Math.floor(m / 12) - 1;
    var name = NOTE_NAMES[pc];
    return {
      midi: m,
      pc: pc,
      name: name,
      octave: octave,
      label: name + octave,
      isBlack: !!BLACK_PC[pc]
    };
  }

  /** 是否黑键 */
  function isBlackKey(midi) {
    return !!BLACK_PC[((midi % 12) + 12) % 12];
  }

  /** 音分格式化：+12.3¢ / -4.0¢ / 0.0¢ */
  function formatCents(cents) {
    if (!isFinite(cents)) return '— ¢';
    var sign = cents > 0.05 ? '+' : cents < -0.05 ? '' : '';
    return sign + cents.toFixed(1) + ' ¢';
  }

  /** 频率格式化 */
  function formatFreq(freq) {
    if (!isFinite(freq) || freq <= 0) return '— — — Hz';
    if (freq < 100) return freq.toFixed(2) + ' Hz';
    if (freq < 1000) return freq.toFixed(1) + ' Hz';
    return freq.toFixed(0) + ' Hz';
  }

  global.Notes = {
    NOTE_NAMES: NOTE_NAMES,
    A4_MIDI: A4_MIDI,
    A4_FREQ: A4_FREQ,
    MIDI_MIN: MIDI_MIN,
    MIDI_MAX: MIDI_MAX,
    midiToFreq: midiToFreq,
    freqToMidi: freqToMidi,
    freqToCents: freqToCents,
    midiToName: midiToName,
    isBlackKey: isBlackKey,
    formatCents: formatCents,
    formatFreq: formatFreq
  };
})(window);
