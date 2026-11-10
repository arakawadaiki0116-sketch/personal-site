(function () {
  'use strict';

  var STORAGE_KEY = 'shiftMemo.v1';
  var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  // 8:00〜22:00 を30分単位（分で保持）
  var TIME_OPTIONS = [];
  for (var m = 8 * 60; m <= 22 * 60; m += 30) TIME_OPTIONS.push(m);

  function defaultState() {
    var starts = ['13:00', '12:00', '16:00', '13:00', '19:00', '19:00', '13:00'];
    return {
      weekStart: toISO(sundayOf(new Date())),
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
  function fromISO(s) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function fmtTime(min) { return Math.floor(min / 60) + ':' + pad2(min % 60); }

  // ---- 保存・復元 ----
  function load() {
    var s = defaultState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return s;
      var saved = JSON.parse(raw);
      if (typeof saved.calendarId === 'string') s.calendarId = saved.calendarId.trim();
      if (fromISO(saved.weekStart)) s.weekStart = toISO(sundayOf(fromISO(saved.weekStart)));
      var lim = parseInt(saved.limit, 10);
      if (lim >= 1 && lim <= 7) s.limit = lim;
      if (Array.isArray(saved.days)) {
        saved.days.slice(0, 7).forEach(function (d, i) {
          if (!d) return;
          s.days[i].off = !!d.off;
          if (validTime(d.start)) s.days[i].start = d.start;
          if (validTime(d.end)) s.days[i].end = d.end;
        });
      }
    } catch (e) { /* 壊れたデータは無視して既定値 */ }
    return s;
  }
  function validTime(t) {
    return TIME_OPTIONS.some(function (m) { return fmtTime(m) === t; });
  }
  // 入力が変わるたびに呼ぶ：保存して、文面を作り直す
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 保存不可でも動作は続ける */ }
    updatePreview();
  }

  var state = load();

  // ---- 画面 ----
  var $ = function (id) { return document.getElementById(id); };
  var daysEl = $('days');
  var rows = [];

  function makeTimeSelect(value, label) {
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', label);
    TIME_OPTIONS.forEach(function (min) {
      var o = document.createElement('option');
      o.value = o.textContent = fmtTime(min);
      sel.appendChild(o);
    });
    sel.value = value;
    return sel;
  }

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
    label.appendChild(dow);
    label.appendChild(dateSpan);

    var times = document.createElement('div');
    times.className = 'times';
    var start = makeTimeSelect(state.days[i].start, name + '曜の開始時刻');
    var end = makeTimeSelect(state.days[i].end, name + '曜の終了時刻');
    var sep = document.createElement('span');
    sep.className = 'sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '–';
    times.appendChild(start);
    times.appendChild(sep);
    times.appendChild(end);

    // 「不可」はチェックボックスのまま、見た目だけ押しボタン風にする
    var offLabel = document.createElement('label');
    offLabel.className = 'off-toggle';
    var off = document.createElement('input');
    off.type = 'checkbox';
    off.setAttribute('aria-label', name + '曜は不可');
    var offText = document.createElement('span');
    offText.textContent = '不可';
    offLabel.appendChild(off);
    offLabel.appendChild(offText);

    row.appendChild(label);
    row.appendChild(times);
    row.appendChild(offLabel);
    daysEl.appendChild(row);

    off.checked = state.days[i].off;
    off.addEventListener('change', function () { state.days[i].off = off.checked; applyOff(i); save(); });
    start.addEventListener('change', function () { state.days[i].start = start.value; save(); });
    end.addEventListener('change', function () { state.days[i].end = end.value; save(); });

    rows.push({ row: row, date: dateSpan, start: start, end: end });
    applyOff(i);
  });

  function applyOff(i) {
    var r = rows[i], isOff = state.days[i].off;
    r.start.disabled = r.end.disabled = isOff;
    r.row.classList.toggle('off', isOff);
  }

  var limitEl = $('limit');
  for (var n = 1; n <= 7; n++) {
    var o = document.createElement('option');
    o.value = o.textContent = String(n);
    limitEl.appendChild(o);
  }
  limitEl.value = String(state.limit);
  limitEl.addEventListener('change', function () { state.limit = parseInt(limitEl.value, 10); save(); });

  function setWeek(date) {
    state.weekStart = toISO(sundayOf(date));
    renderWeek();
    save();
  }
  function renderWeek() {
    var sun = fromISO(state.weekStart);
    $('weekStart').textContent = md(sun);
    $('weekEnd').textContent = md(addDays(sun, 6));
    $('datePicker').value = state.weekStart;
    // 今週・来週のどちらを選んでいるかをボタンに出す
    var thisSun = toISO(sundayOf(new Date()));
    var nextSun = toISO(addDays(sundayOf(new Date()), 7));
    $('thisWeek').setAttribute('aria-pressed', String(state.weekStart === thisSun));
    $('nextWeek').setAttribute('aria-pressed', String(state.weekStart === nextSun));
    rows.forEach(function (r, i) { r.date.textContent = md(addDays(sun, i)); });
    renderCalendar();
  }

  // ---- Googleカレンダー（埋め込み表示。ログイン中のブラウザなら自分の予定が出る） ----
  var calendarEl = $('calendar');
  var calendarIdEl = $('calendarId');
  var lastCalendarUrl = '';

  function compact(d) { return toISO(d).replace(/-/g, ''); }

  function renderCalendar() {
    var id = state.calendarId;
    $('calendarBox').hidden = !id;
    $('calendarSettings').open = !id;
    if (!id) return;
    var sun = fromISO(state.weekStart);
    var narrow = window.matchMedia('(max-width: 600px)').matches;
    var params = [
      'src=' + encodeURIComponent(id),
      'ctz=Asia%2FTokyo',
      'mode=' + (narrow ? 'AGENDA' : 'WEEK'),
      'wkst=1',
      'dates=' + compact(sun) + '%2F' + compact(addDays(sun, 7)),
      'showTitle=0', 'showPrint=0', 'showCalendars=0', 'showTz=0'
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
  window.matchMedia('(max-width: 600px)').addEventListener('change', renderCalendar);

  $('thisWeek').addEventListener('click', function () { setWeek(new Date()); });
  $('nextWeek').addEventListener('click', function () { setWeek(addDays(new Date(), 7)); });
  $('datePicker').addEventListener('change', function () {
    var d = fromISO($('datePicker').value);
    if (d) setWeek(d);
  });

  // ---- 文面 ----
  function buildText() {
    var lines = ['以下、' + md(fromISO(state.weekStart)) + '以降のシフトです。', ''];
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
    var done = function () { status.textContent = 'このブラウザは共有画面に対応していないため、文面をコピーしました。'; };
    var legacy = function () {
      var preview = $('preview');
      preview.removeAttribute('readonly');
      preview.select();
      try { document.execCommand('copy') ? done() : (status.textContent = '共有もコピーもできませんでした。文面を選んでコピーしてください。'); }
      catch (e) { status.textContent = '共有もコピーもできませんでした。文面を選んでコピーしてください。'; }
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

  renderWeek();
  save();
})();
