/* ============================================================
 * keyboard.js · 纵向 88 键钢琴（A0 在下，C8 在上）
 * ============================================================ */
(function (global) {
  'use strict';

  function noop() {}

  function PianoKeyboard(opts) {
    this.container = opts.container;
    this.scrollEl = opts.scrollEl;
    this.whiteHeight = opts.whiteHeight || 44;
    this.blackRatio = 0.62;

    this.onSelect = opts.onSelect || noop;
    this.onPress = opts.onPress || noop;
    this.onRelease = opts.onRelease || noop;

    this.selected = null;
    this._els = {};
    this._pointers = {};
    this._pointersPrev = {};
    this._pressed = {};
    this._whiteCount = 0;

    this._build();
    this._bindEvents();
  }

  PianoKeyboard.prototype._build = function () {
    var Notes = global.Notes;
    var WH = this.whiteHeight;
    var frag = document.createDocumentFragment();

    var keys = [];
    var whiteIndex = 0;
    for (var midi = Notes.MIDI_MIN; midi <= Notes.MIDI_MAX; midi++) {
      if (Notes.isBlackKey(midi)) {
        // 黑键位于「后一个白键」的下边界处
        keys.push({ midi: midi, black: true, wi: whiteIndex });
      } else {
        keys.push({ midi: midi, black: false, wi: whiteIndex });
        whiteIndex++;
      }
    }
    this._whiteCount = whiteIndex;
    this.container.style.height = (whiteIndex * WH + 2) + 'px';

    var blackH = Math.round(WH * this.blackRatio);

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'pk ' + (k.black ? 'black' : 'white');
      el.setAttribute('data-midi', String(k.midi));
      el.setAttribute('aria-label', Notes.midiToName(k.midi).label);

      if (k.black) {
        el.style.height = blackH + 'px';
        el.style.bottom = (k.wi * WH - blackH / 2) + 'px';
      } else {
        el.style.height = (WH - 1) + 'px';
        el.style.bottom = (k.wi * WH) + 'px';

        var info = Notes.midiToName(k.midi);
        var span = document.createElement('span');
        span.className = 'pk-name';
        span.textContent = info.label;
        el.appendChild(span);
        if (info.name === 'C') el.classList.add('is-c');
      }

      this._els[k.midi] = el;
      frag.appendChild(el);
    }

    this.container.innerHTML = '';
    this.container.appendChild(frag);
  };

  PianoKeyboard.prototype._bindEvents = function () {
    var self = this;

    this.container.addEventListener('pointerdown', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.pk') : null;
      if (!el) return;
      var midi = parseInt(el.getAttribute('data-midi'), 10);
      if (!isFinite(midi)) return;

      // 记录按下前的选中状态：若浏览器把手势接管为滚动（pointercancel）则回滚
      self._pointersPrev[e.pointerId] = self.selected;
      self._pointers[e.pointerId] = midi;
      self._press(midi);
      try { self.container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    global.addEventListener('pointermove', function (e) {
      var cur = self._pointers[e.pointerId];
      if (cur === undefined) return;

      var over = document.elementFromPoint(e.clientX, e.clientY);
      var pk = over && over.closest ? over.closest('.pk') : null;
      if (!pk) return;

      var midi = parseInt(pk.getAttribute('data-midi'), 10);
      if (!isFinite(midi) || midi === cur) return;

      self._release(cur);
      self._pointers[e.pointerId] = midi;
      self._press(midi);
    });

    function endPointer(e, cancelled) {
      var cur = self._pointers[e.pointerId];
      var prev = self._pointersPrev[e.pointerId];
      delete self._pointersPrev[e.pointerId];
      if (cur === undefined) return;
      delete self._pointers[e.pointerId];
      self._release(cur);
      // 手势被浏览器接管为滚动：恢复按下前的选中状态
      if (cancelled && prev !== undefined) self.select(prev);
    }

    global.addEventListener('pointerup', function (e) { endPointer(e, false); });
    global.addEventListener('pointercancel', function (e) { endPointer(e, true); });
    global.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') endPointer(e, true);
    });
  };

  PianoKeyboard.prototype._press = function (midi) {
    var el = this._els[midi];
    if (el) el.classList.add('is-pressed');
    this._pressed[midi] = true;
    this.select(midi);
    this.onPress(midi);
  };

  PianoKeyboard.prototype._release = function (midi) {
    var el = this._els[midi];
    if (el) el.classList.remove('is-pressed');
    delete this._pressed[midi];
    this.onRelease(midi);
  };

  /** 选中某个键作为基准音（传入 null 取消选中） */
  PianoKeyboard.prototype.select = function (midi) {
    if (midi === this.selected) return;
    if (this.selected !== null && this._els[this.selected]) {
      this._els[this.selected].classList.remove('is-selected');
    }
    this.selected = midi;
    if (midi !== null && this._els[midi]) {
      this._els[midi].classList.add('is-selected');
    }
    this.onSelect(midi);
  };

  /** 当前是否有按下的琴键 */
  PianoKeyboard.prototype.hasPressed = function () {
    for (var k in this._pressed) {
      if (Object.prototype.hasOwnProperty.call(this._pressed, k)) return true;
    }
    return false;
  };

  /** 滚动到指定音（ratio 为在视口中的相对位置 0~1） */
  PianoKeyboard.prototype.scrollToMidi = function (midi, ratio) {
    var el = this._els[midi];
    if (!el || !this.scrollEl) return;
    var viewH = this.scrollEl.clientHeight;
    if (!viewH) return;
    var target = el.offsetTop + el.offsetHeight / 2 - viewH * (ratio === undefined ? 0.5 : ratio);
    var max = this.scrollEl.scrollHeight - viewH;
    this.scrollEl.scrollTop = Math.max(0, Math.min(max, target));
  };

  global.PianoKeyboard = PianoKeyboard;
})(window);
