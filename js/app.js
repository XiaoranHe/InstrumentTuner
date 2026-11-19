/* ============================================================
 * app.js · 主逻辑：麦克风采集 / 音高检测 / 曲线联动
 * ============================================================ */
(function (global) {
  'use strict';

  var Notes = global.Notes;

  var el = {
    stage: document.querySelector('.stage'),
    btnRun: document.getElementById('btnRun'),
    btnSound: document.getElementById('btnSound'),
    btnClear: document.getElementById('btnClear'),
    btnCollapse: document.getElementById('btnCollapse'),
    pianoScroll: document.getElementById('pianoScroll'),
    pianoKeys: document.getElementById('pianoKeys'),
    chart: document.getElementById('chart'),
    noteName: document.getElementById('noteName'),
    noteOctave: document.getElementById('noteOctave'),
    freq: document.getElementById('freq'),
    cents: document.getElementById('cents'),
    needle: document.getElementById('needle'),
    levelBar: document.getElementById('levelBar'),
    refChip: document.getElementById('refChip'),
    refChipValue: document.getElementById('refChipValue'),
    refChipX: document.getElementById('refChipX'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText')
  };

  var state = {
    running: false,
    starting: false,
    refMidi: null,      // 用户按下的基准键
    autoRef: null,      // 自动跟随的最近半音
    soundOn: true,
    toneStartAt: 0,
    lastDetectAt: 0
  };

  var audio = {
    ctx: null,
    stream: null,
    source: null,
    analyser: null,
    buf: null,
    timer: null,
    detector: null,
    smoother: null
  };

  var stopTimer = null;
  var keyboard = null;
  var chart = null;
  var tone = null;

  /* ------------------------------ 工具 ------------------------------ */

  function setStatus(text, mode) {
    el.statusText.textContent = text;
    el.statusDot.className = 'status-dot' + (mode ? ' is-' + mode : '');
  }

  function resetReadout() {
    el.noteName.textContent = '—';
    el.noteName.classList.add('is-none');
    el.noteOctave.textContent = '';
    el.freq.textContent = '— — — Hz';
    el.cents.textContent = '— ¢';
    el.cents.className = 'cents';
    el.needle.className = 'meter-needle';
    el.needle.style.left = '50%';
  }

  function updateReadout(midi, freq) {
    var nearest = Math.round(midi);
    var info = Notes.midiToName(nearest);
    var cents = (midi - nearest) * 100;

    el.noteName.textContent = info.name;
    el.noteName.classList.remove('is-none');
    el.noteOctave.textContent = String(info.octave);
    el.freq.textContent = Notes.formatFreq(freq);
    el.cents.textContent = Notes.formatCents(cents);

    var cls = Math.abs(cents) <= 5 ? 'is-good' : Math.abs(cents) <= 15 ? 'is-warn' : 'is-bad';
    el.cents.className = 'cents ' + cls;
    el.needle.className = 'meter-needle ' + cls;
    el.needle.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
  }

  function updateRefChip() {
    if (state.refMidi === null) {
      el.refChip.classList.remove('is-key');
      el.refChip.classList.add('is-auto');
      el.refChipValue.textContent = '自动';
      el.refChipX.hidden = true;
    } else {
      var info = Notes.midiToName(state.refMidi);
      el.refChip.classList.add('is-key');
      el.refChip.classList.remove('is-auto');
      el.refChipValue.textContent = info.label + ' · ' + Notes.formatFreq(Notes.midiToFreq(state.refMidi));
      el.refChipX.hidden = false;
    }
  }

  /* ------------------------------ 音频启动 ------------------------------ */

  function pickWhiteHeight() {
    var h = global.innerHeight || 700;
    if (h >= 820) return 46;
    if (h >= 700) return 42;
    if (h >= 600) return 38;
    return 34;
  }

  function syncToneContext() {
    if (!audio.ctx) return;
    tone.setContext(audio.ctx);
    tone.setEnabled(state.soundOn);
  }

  function start() {
    if (state.running || state.starting) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('当前环境不支持麦克风（需 HTTPS 或 localhost）', 'error');
      return;
    }

    state.starting = true;
    el.btnRun.disabled = true;
    el.btnRun.textContent = '启动中…';
    setStatus('正在请求麦克风权限…');

    var constraintsList = [
      {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        },
        video: false
      },
      { audio: true, video: false }
    ];

    function attempt(index) {
      if (index >= constraintsList.length) {
        onStartError(new Error('麦克风不可用'));
        return;
      }
      navigator.mediaDevices.getUserMedia(constraintsList[index]).then(onStream, function () {
        attempt(index + 1);
      });
    }

    attempt(0);
  }

  function onStream(stream) {
    audio.stream = stream;

    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) {
      onStartError(new Error('浏览器不支持 Web Audio'));
      return;
    }

    try {
      audio.ctx = new AC();
    } catch (e) {
      onStartError(e);
      return;
    }

    if (audio.ctx.state === 'suspended' && audio.ctx.resume) audio.ctx.resume();

    audio.source = audio.ctx.createMediaStreamSource(stream);
    audio.analyser = audio.ctx.createAnalyser();
    audio.analyser.fftSize = 8192;
    audio.analyser.smoothingTimeConstant = 0;
    audio.source.connect(audio.analyser);

    audio.buf = new Float32Array(audio.analyser.fftSize);
    audio.detector = new global.PitchDetector({
      sampleRate: audio.ctx.sampleRate,
      fmin: 27,
      fmax: 4500,
      threshold: 0.14,
      silenceRms: 0.0028
    });
    audio.smoother = new global.PitchSmoother(5);

    syncToneContext();

    state.running = true;
    state.starting = false;
    state.lastDetectAt = 0;

    scheduleTick(0);

    el.btnRun.disabled = false;
    el.btnRun.textContent = '停止调音';
    el.btnRun.classList.add('is-running');
    chart.setStatus('监听中 · 采样率 ' + Math.round(audio.ctx.sampleRate / 1000) + 'kHz');
    setStatus('麦克风已开启，等待声音…', 'live');
  }

  function onStartError(err) {
    state.starting = false;
    state.running = false;
    el.btnRun.disabled = false;
    el.btnRun.textContent = '开始调音';

    var msg = '麦克风启动失败';
    if (err && err.name === 'NotAllowedError') msg = '麦克风权限被拒绝，请在浏览器设置中允许';
    else if (err && err.name === 'NotFoundError') msg = '未找到麦克风设备';

    setStatus(msg, 'error');

    if (audio.stream) {
      audio.stream.getTracks().forEach(function (t) { t.stop(); });
      audio.stream = null;
    }
  }

  function stop() {
    if (audio.timer) {
      global.clearTimeout(audio.timer);
      audio.timer = null;
    }
    if (stopTimer) {
      global.clearTimeout(stopTimer);
      stopTimer = null;
    }
    tone.stop();
    if (audio.stream) {
      audio.stream.getTracks().forEach(function (t) { t.stop(); });
      audio.stream = null;
    }
    if (audio.source) {
      try { audio.source.disconnect(); } catch (e) { /* ignore */ }
      audio.source = null;
    }
    if (audio.ctx) {
      try { audio.ctx.close(); } catch (e2) { /* ignore */ }
      audio.ctx = null;
    }
    audio.analyser = null;
    audio.buf = null;
    audio.detector = null;
    audio.smoother = null;

    tone.setContext(null);

    state.running = false;
    state.autoRef = null;
    state.lastDetectAt = 0;

    el.btnRun.textContent = '开始调音';
    el.btnRun.classList.remove('is-running');
    el.levelBar.style.width = '0%';
    chart.setStatus('已停止');
    setStatus('未开始');
    resetReadout();
  }

  /* ------------------------------ 检测循环 ------------------------------ */

  /** 链式调度：根据单帧耗时自适应间隔，避免主线程堆积 */
  function scheduleTick(delay) {
    audio.timer = global.setTimeout(function () {
      if (!state.running || !audio.analyser) return;
      var t0 = (global.performance || Date).now();
      try {
        tick();
      } catch (e) {
        // 单帧异常不影响后续帧
      }
      var cost = (global.performance || Date).now() - t0;
      var next = Math.max(30, Math.min(120, Math.max(40, cost * 1.8)));
      scheduleTick(next);
    }, delay);
  }

  function tick() {
    if (!audio.analyser) return;

    audio.analyser.getFloatTimeDomainData(audio.buf);
    var res = audio.detector.detect(audio.buf);

    el.levelBar.style.width = Math.round(res.level * 100) + '%';

    // 参考音播放期间不采样，避免扬声器声音被麦克风回授
    if (tone.isPlaying()) {
      chart.setStatus('参考音播放中 · 已暂停采样');
      setStatus('参考音播放中…', 'live');
      return;
    }

    if (!res.valid) {
      var now = (global.performance || Date).now();
      if (state.lastDetectAt && now - state.lastDetectAt > 420) {
        resetReadout();
        setStatus('等待声音…', 'live');
        chart.setStatus('未检测到稳定音高');
      }
      return;
    }

    var midiRaw = Notes.freqToMidi(res.freq);
    var midi = audio.smoother.push(midiRaw);

    state.lastDetectAt = (global.performance || Date).now();

    // 基准音：用户选中的琴键优先，否则自动跟随最近半音（带滞回防抖）
    var ref;
    if (state.refMidi !== null) {
      ref = state.refMidi;
    } else {
      if (state.autoRef === null || Math.abs(midi - state.autoRef) > 0.58) {
        state.autoRef = Math.round(midi);
      }
      ref = state.autoRef;
    }

    chart.push(midi, ref);
    updateReadout(midi, res.freq);

    if (state.refMidi !== null) {
      var refInfo = Notes.midiToName(state.refMidi);
      var curInfo = Notes.midiToName(Math.round(midi));
      if (curInfo.midi !== refInfo.midi) {
        chart.setStatus('正在检测 ' + curInfo.label + ' · 基准 ' + refInfo.label);
      } else {
        chart.setStatus('正在检测 ' + curInfo.label + ' · 与基准对比中');
      }
    } else {
      chart.setStatus('自动跟随 · 未选择基准音');
    }
    setStatus('采集中', 'live');
  }

  /* ------------------------------ 参考音 ------------------------------ */

  function playTone(midi) {
    if (!state.soundOn) return;
    if (stopTimer) {
      global.clearTimeout(stopTimer);
      stopTimer = null;
    }
    state.toneStartAt = (global.performance || Date).now();
    tone.play(midi);
    chart.setStatus('参考音播放中 · 已暂停采样');
  }

  function releaseTone() {
    var now = (global.performance || Date).now();
    var elapsed = now - state.toneStartAt;
    var minDur = 900;

    if (!state.soundOn) return;
    if (stopTimer) {
      global.clearTimeout(stopTimer);
      stopTimer = null;
    }

    if (elapsed >= minDur) {
      tone.stop();
      return;
    }
    stopTimer = global.setTimeout(function () {
      stopTimer = null;
      if (!keyboard.hasPressed()) tone.stop();
    }, minDur - elapsed);
  }

  /* ------------------------------ 初始化 ------------------------------ */

  function initKeyboard() {
    keyboard = new global.PianoKeyboard({
      container: el.pianoKeys,
      scrollEl: el.pianoScroll,
      whiteHeight: pickWhiteHeight(),
      onSelect: function (midi) {
        state.refMidi = midi;
        chart.setRef(midi);
        updateRefChip();
        if (midi !== null) {
          var info = Notes.midiToName(midi);
          chart.setStatus('基准音 ' + info.label + ' · ' + Notes.formatFreq(Notes.midiToFreq(midi)));
        }
      },
      onPress: function (midi) {
        playTone(midi);
      },
      onRelease: function () {
        releaseTone();
      }
    });

    // 打开时定位到中央 C 附近（rAF + 延时兜底，避免布局未完成或后台 rAF 暂停）
    var initialScroll = function () {
      keyboard.scrollToMidi(keyboard.selected === null ? 60 : keyboard.selected, 0.5);
    };
    global.requestAnimationFrame(initialScroll);
    global.setTimeout(initialScroll, 200);
    global.setTimeout(initialScroll, 600);
  }

  function initChart() {
    chart = new global.PitchChart(el.chart, { windowMs: 20000 });
    chart.setStatus('等待开始');
  }

  function initControls() {
    el.btnRun.addEventListener('click', function () {
      if (state.running) stop();
      else start();
    });

    el.btnSound.addEventListener('click', function () {
      state.soundOn = !state.soundOn;
      el.btnSound.classList.toggle('is-on', state.soundOn);
      el.btnSound.setAttribute('aria-pressed', String(state.soundOn));
      tone.setEnabled(state.soundOn);
      if (!state.soundOn) tone.stop();
    });

    el.btnClear.addEventListener('click', function () {
      chart.clear();
      audio.smoother && audio.smoother.reset();
    });

    el.btnCollapse.addEventListener('click', function () {
      var collapsed = el.stage.classList.toggle('piano-collapsed');
      try { global.localStorage.setItem('mt.pianoCollapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
      global.setTimeout(function () {
        if (!collapsed) keyboard.scrollToMidi(keyboard.selected === null ? 60 : keyboard.selected, 0.5);
      }, 300);
    });

    el.refChip.addEventListener('click', function () {
      if (state.refMidi === null) return;
      keyboard.select(null);
      chart.setRef(null);
      updateRefChip();
      chart.setStatus('自动跟随 · 未选择基准音');
    });

    // 键盘快捷键（桌面调试）：空格开始/停止
    global.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        if (state.running) stop();
        else start();
      }
    });
  }

  function restorePrefs() {
    try {
      if (global.localStorage.getItem('mt.pianoCollapsed') === '1') {
        el.stage.classList.add('piano-collapsed');
      }
    } catch (e) { /* ignore */ }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
    });
  }

  function boot() {
    tone = new global.TonePlayer({ enabled: true });

    initChart();
    initKeyboard();
    initControls();
    restorePrefs();
    updateRefChip();
    resetReadout();
    registerSW();

    // 调试接口（便于自动化测试 / 控制台排查）
    global.__tuner = {
      state: state,
      audio: audio,
      keyboard: function () { return keyboard; },
      chart: function () { return chart; },
      tone: function () { return tone; },
      start: start,
      stop: stop
    };

    global.addEventListener('pagehide', function () {
      if (state.running) stop();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
