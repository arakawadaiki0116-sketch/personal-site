(function () {
  'use strict';

  var STORAGE_KEY = 'shiftMemo.v1';
  var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  var ITEM_H = 34; // ダイヤル1目盛りの高さ（style.css の --item と合わせる）

  // 8:00〜22:00 を30分単位（分で保持）
  var TIME_OPTIONS = [];
  for (var m = 8 * 60; m <= 22 * 60; m += 30) TIME_OPTIONS.push(m);
  var TIME_LABELS = TIME_OPTIONS.map(fmtTime);

  function defaultState() {
    var starts = ['13:00', '12:00', '16:00', '13:00', '19:00', '19:00', '13:00'];
    return {
      limit: 5,
      calendarId: '',
      days: DAY_NAMES.map(function (_, i) {
        return { off: i === 6, start: starts[i], end: '22:00' };
      })
    };
  }

  // ---- 日付ユーティリティ ----
  function sundayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - d.getDay());
    return d;
  }
  function addDays(date, n) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function fmtTime(min) { return Math.floor(min / 60) + ':' + pad2(min % 60); }

  // 対象はいつも「来週」（次の日曜〜土曜）
  var weekStart = addDays(sundayOf(new Date()), 7);

  // ---- 保存・復元（このブラウザの中に保存） ----
  function load() {
    var s = defaultState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return s;
      var saved = JSON.parse(raw);
      if (typeof saved.calendarId === 'string') s.calendarId = saved.calendarId.trim();
      var lim = parseInt(saved.limit, 10);
      if (lim >= 1 && lim <= 7) s.limit = lim;
      if (Array.isArray(saved.days)) {
        saved.days.slice(0, 7).forEach(function (d, i) {
          if (!d) return;
          s.days[i].off = !!d.off;
          if (TIME_LABELS.indexOf(d.start) >= 0) s.days[i].start = d.start;
          if (TIME_LABELS.indexOf(d.end) >= 0) s.days[i].end = d.end;
        });
      }
    } catch (e) { /* 壊れたデータは無視して既定値 */ }
    return s;
  }

  // 入力が変わるたびに呼ぶ：保存して、メッセージを作り直す
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 保存不可でも動作は続ける */ }
    updatePreview();
  }

  var state = load();

  // ブラウザが保存内容を勝手に消さないよう頼む（対応ブラウザのみ）
  if (navigator.storage && navigator.storage.persist) {
    try { navigator.storage.persist(); } catch (e) { /* 無視 */ }
  }

  var $ = function (id) { return document.getElementById(id); };

  // ---- 時刻ダイヤル ----
  // 上下にスワイプ（PCはホイール・矢印キー）で回す。真ん中の値が選ばれる。
  function makeDial(value, label, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'dial';

    var scroller = document.createElement('div');
    scroller.className = 'dial-scroll';
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'spinbutton');
    scroller.setAttribute('aria-label', label);

    var track = document.createElement('div');
    track.className = 'dial-track';
    var items = TIME_LABELS.map(function (t, idx) {
      var it = document.createElement('div');
      it.className = 'dial-item';
      it.textContent = t;
      it.addEventListener('click', function () { goTo(idx, true); });
      track.appendChild(it);
      return it;
    });
    scroller.appendChild(track);
    wrap.appendChild(scroller);

    var index = Math.max(0, TIME_LABELS.indexOf(value));
    var settleTimer = null;

    function mark(idx) {
      items.forEach(function (it, k) { it.classList.toggle('is-selected', k === idx); });
      scroller.setAttribute('aria-valuenow', String(idx));
      scroller.setAttribute('aria-valuetext', TIME_LABELS[idx]);
    }
    function goTo(idx, smooth) {
      idx = Math.min(TIME_LABELS.length - 1, Math.max(0, idx));
      scroller.scrollTo({ top: idx * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
      if (!smooth) settle();
    }
    function settle() {
      var idx = Math.min(TIME_LABELS.length - 1, Math.max(0, Math.round(scroller.scrollTop / ITEM_H)));
      mark(idx);
      if (idx !== index) {
        index = idx;
        onChange(TIME_LABELS[idx]);
      }
    }

    scroller.addEventListener('scroll', function () {
      mark(Math.min(TIME_LABELS.length - 1, Math.max(0, Math.round(scroller.scrollTop / ITEM_H))));
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 120);
    }, { passive: true });

    scroller.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { e.preventDefault(); goTo(index - 1, true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); goTo(index + 1, true); }
    });

    mark(index);
    return {
      el: wrap,
      // 画面に置いたあとで呼ぶ（置く前は位置を合わせられない）
      place: function () { scroller.scrollTop = index * ITEM_H; },
      setDisabled: function (dis) {
        wrap.classList.toggle('is-disabled', dis);
        scroller.tabIndex = dis ? -1 : 0;
        scroller.setAttribute('aria-disabled', String(dis));
      }
    };
  }

  // ---- 曜日の行 ----
  var daysEl = $('days');
  var rows = [];

  DAY_NAMES.forEach(function (name, i) {
    var row = document.createElement('div');
    row.className = 'day-row';

    var label = document.createElement('div');
    label.className = 'day-name' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    var dow = document.createElement('span');
    dow.className = 'dow';
    dow.textContent = name;
    var dateSpan = document.createElement('span');
    dateSpan.className = 'date';
    dateSpan.textContent = md(addDays(weekStart, i));
    label.appendChild(dow);
    label.appendChild(dateSpan);

    var times = document.createElement('div');
    times.className = 'times';
    var start = makeDial(state.days[i].start, name + '曜の開始時刻', function (v) { state.days[i].start = v; save(); });
    var end = makeDial(state.days[i].end, name + '曜の終了時刻', function (v) { state.days[i].end = v; save(); });
    var sep = document.createElement('span');
    sep.className = 'sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '–';
    times.appendChild(start.el);
    times.appendChild(sep);
    times.appendChild(end.el);

    // 「不可」はチェックボックスのまま、見た目だけ押しボタン風にする
    var offLabel = document.createElement('label');
    offLabel.className = 'off-toggle';
    var off = document.createElement('input');
    off.type = 'checkbox';
    off.checked = state.days[i].off;
    off.setAttribute('aria-label', name + '曜は不可');
    var offText = document.createElement('span');
    offText.textContent = '不可';
    offLabel.appendChild(off);
    offLabel.appendChild(offText);
    off.addEventListener('change', function () { state.days[i].off = off.checked; applyOff(i); save(); });

    row.appendChild(label);
    row.appendChild(times);
    row.appendChild(offLabel);
    daysEl.appendChild(row);

    rows.push({ row: row, start: start, end: end });
    start.place();
    end.place();
    applyOff(i);
  });

  function applyOff(i) {
    var r = rows[i], isOff = state.days[i].off;
    r.start.setDisabled(isOff);
    r.end.setDisabled(isOff);
    r.row.classList.toggle('off', isOff);
  }

  // ---- 回数上限 ----
  var limitEl = $('limit');
  for (var n = 1; n <= 7; n++) {
    var o = document.createElement('option');
    o.value = o.textContent = String(n);
    limitEl.appendChild(o);
  }
  limitEl.value = String(state.limit);
  limitEl.addEventListener('change', function () { state.limit = parseInt(limitEl.value, 10); save(); });

  // ---- 見出しの期間 ----
  function mdw(d) { return md(d) + '(' + DAY_NAMES[d.getDay()] + ')'; }
  $('weekStart').textContent = mdw(weekStart);
  $('weekEnd').textContent = mdw(addDays(weekStart, 6));

  // ---- Googleカレンダー（埋め込み表示。ログイン中のブラウザなら自分の予定が出る） ----
  var calendarEl = $('calendar');
  var calendarIdEl = $('calendarId');
  var lastCalendarUrl = '';

  function compact(d) { return toISO(d).replace(/-/g, ''); }

  function renderCalendar() {
    var id = state.calendarId;
    $('calendarSection').hidden = !id;
    if (!id) return;
    var params = [
      'src=' + encodeURIComponent(id),
      'ctz=Asia%2FTokyo',
      'hl=ja',
      'mode=AGENDA',
      'wkst=1',
      'dates=' + compact(weekStart) + '%2F' + compact(addDays(weekStart, 7)),
      'showTitle=0', 'showPrint=0', 'showCalendars=0', 'showTz=0', 'showTabs=0'
    ];
    var url = 'https://calendar.google.com/calendar/embed?' + params.join('&');
    if (url !== lastCalendarUrl) {
      lastCalendarUrl = url;
      calendarEl.src = url;
    }
  }

  calendarIdEl.value = state.calendarId;
  calendarIdEl.addEventListener('change', function () {
    state.calendarId = calendarIdEl.value.trim();
    renderCalendar();
    save();
  });

  // ---- メッセージ ----
  function buildText() {
    var lines = ['以下、' + md(weekStart) + '以降のシフトです。', ''];
    state.days.forEach(function (d, i) {
      var head = '(' + DAY_NAMES[i] + ') ';
      lines.push(d.off ? head + '不可' : head + d.start + 'から' + d.end);
    });
    lines.push('');
    lines.push('一日の勤務時間は6時間以下。一週間の勤務回数は' + state.limit + '回以下でお願いします。');
    return lines.join('\n');
  }

  function updatePreview() {
    var preview = $('preview');
    if (!preview) return;
    preview.value = buildText();
    $('sendStatus').textContent = '';
  }

  // 「送信」：OS の共有画面を開く。共有画面が使えないブラウザではクリップボードにコピーする
  function copyFallback(text) {
    var status = $('sendStatus');
    var done = function () { status.textContent = '共有画面に対応していないため、メッセージをコピーしました。'; };
    var fail = function () { status.textContent = '共有もコピーもできませんでした。メッセージを選んでコピーしてください。'; };
    var legacy = function () {
      var preview = $('preview');
      preview.removeAttribute('readonly');
      preview.select();
      try { document.execCommand('copy') ? done() : fail(); } catch (e) { fail(); }
      preview.setAttribute('readonly', '');
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, legacy);
    } else {
      legacy();
    }
  }

  $('send').addEventListener('click', function () {
    var text = buildText();
    $('sendStatus').textContent = '';
    if (navigator.share) {
      navigator.share({ text: text }).catch(function (err) {
        if (err && err.name === 'AbortError') return; // 共有画面を閉じただけ
        copyFallback(text);
      });
    } else {
      copyFallback(text);
    }
  });

  renderCalendar();
  save();
})();
