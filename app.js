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

  // ---- Googleカレンダー連携 ----
  // ブラウザだけで Google にログインし（OAuth の implicit フロー）、来週の予定を読み取って一覧にする。
  // 読み取り専用。受け取った鍵（アクセストークン）は1時間で切れ、このブラウザの中にだけ置く。
  var GOOGLE_CLIENT_ID = ''; // Google Cloud で作った「OAuth クライアントID」（公開してよい値）
  var SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  var TOKEN_KEY = 'shiftMemo.gtoken';
  var OAUTH_STATE_KEY = 'shiftMemo.oauthState';
  var API = 'https://www.googleapis.com/calendar/v3';

  var calSection = $('calendarSection');
  var calBody = $('calendarBody');
  var calStatus = $('calendarStatus');
  var dayGroups = []; // 曜日ごとの見出し要素（スクロール先）

  function redirectUri() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }
  function readToken() {
    try {
      var t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.token && t.exp > Date.now()) return t.token;
    } catch (e) { /* 無視 */ }
    return null;
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ }
  }

  // Google から戻ってきたとき：URL の # 以降から鍵を取り出す
  function takeTokenFromUrl() {
    if (!location.hash || location.hash.length < 2) return null;
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('access_token') && !p.get('error')) return null;
    var expected = null;
    try { expected = localStorage.getItem(OAUTH_STATE_KEY); localStorage.removeItem(OAUTH_STATE_KEY); } catch (e) { /* 無視 */ }
    history.replaceState(null, '', location.pathname + location.search); // 鍵を URL に残さない
    if (p.get('error')) return { error: p.get('error') === 'access_denied' ? '連携がキャンセルされました。' : 'Google との連携に失敗しました。' };
    if (!expected || p.get('state') !== expected) return { error: '連携の確認に失敗しました。もう一度読み込んでください。' };
    var sec = parseInt(p.get('expires_in'), 10) || 3600;
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: p.get('access_token'), exp: Date.now() + (sec - 60) * 1000 }));
    } catch (e) { /* 無視 */ }
    return { ok: true };
  }

  function connectGoogle() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var st = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { localStorage.setItem(OAUTH_STATE_KEY, st); } catch (e) { /* 無視 */ }
    var q = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      state: st,
      include_granted_scopes: 'true'
    });
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
  }

  function api(path, token) {
    return fetch(API + path, { headers: { Authorization: 'Bearer ' + token } }).then(function (r) {
      if (r.status === 401) { var e = new Error('auth'); e.auth = true; throw e; }
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  // 表示しているカレンダーをすべて読み、来週の予定を集める
  function fetchWeekEvents(token) {
    var timeMin = weekStart.toISOString();
    var timeMax = addDays(weekStart, 7).toISOString();
    return api('/users/me/calendarList?minAccessRole=reader&fields=items(id,backgroundColor,selected,hidden)', token)
      .then(function (list) {
        var cals = (list.items || []).filter(function (c) { return c.selected && !c.hidden; });
        return Promise.all(cals.map(function (c) {
          var q = new URLSearchParams({
            timeMin: timeMin, timeMax: timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
            fields: 'items(summary,start,end,status)'
          });
          return api('/calendars/' + encodeURIComponent(c.id) + '/events?' + q.toString(), token)
            .then(function (res) {
              return (res.items || []).filter(function (ev) { return ev.status !== 'cancelled'; })
                .map(function (ev) { ev.color = c.backgroundColor; return ev; });
            })
            .catch(function (e) { if (e.auth) throw e; return []; }); // 読めないカレンダーは飛ばす
        }));
      })
      .then(function (arrays) { return [].concat.apply([], arrays); });
  }

  // 予定を曜日ごとに振り分ける（日をまたぐ予定はその日の分だけ切り出す）
  function eventsByDay(events) {
    var days = DAY_NAMES.map(function () { return []; });
    events.forEach(function (ev) {
      var allDay = !!(ev.start && ev.start.date);
      var s = allDay ? parseDateOnly(ev.start.date) : new Date(ev.start.dateTime);
      var e = allDay ? parseDateOnly(ev.end.date) : new Date(ev.end.dateTime);
      for (var i = 0; i < 7; i++) {
        var d0 = addDays(weekStart, i), d1 = addDays(weekStart, i + 1);
        if (s < d1 && e > d0) {
          days[i].push({
            title: ev.summary || '（タイトルなし）',
            color: ev.color,
            allDay: allDay || (s <= d0 && e >= d1),
            start: s < d0 ? d0 : s,
            end: e > d1 ? d1 : e,
            fromPrev: s < d0,
            toNext: e > d1
          });
        }
      }
    });
    days.forEach(function (list) {
      list.sort(function (a, b) { return (b.allDay - a.allDay) || (a.start - b.start); });
    });
    return days;
  }
  function parseDateOnly(str) {
    var p = str.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function hm(d) { return d.getHours() + ':' + pad2(d.getMinutes()); }

  function renderEvents(days) {
    calBody.textContent = '';
    dayGroups = [];
    var list = document.createElement('div');
    list.className = 'agenda';
    days.forEach(function (items, i) {
      var date = addDays(weekStart, i);
      var group = document.createElement('div');
      group.className = 'agenda-day';
      var head = document.createElement('div');
      head.className = 'agenda-date' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
      head.textContent = md(date) + '(' + DAY_NAMES[i] + ')';
      group.appendChild(head);
      var ul = document.createElement('ul');
      if (!items.length) {
        var none = document.createElement('li');
        none.className = 'agenda-none';
        none.textContent = '予定なし';
        ul.appendChild(none);
      }
      items.forEach(function (it) {
        var li = document.createElement('li');
        var time = document.createElement('span');
        time.className = 'agenda-time';
        time.textContent = it.allDay ? '終日' : (it.fromPrev ? '' : hm(it.start)) + '–' + (it.toNext ? '' : hm(it.end));
        var dot = document.createElement('span');
        dot.className = 'agenda-dot';
        if (it.color) dot.style.background = it.color;
        var title = document.createElement('span');
        title.className = 'agenda-title';
        title.textContent = it.title;
        li.appendChild(time);
        li.appendChild(dot);
        li.appendChild(title);
        ul.appendChild(li);
      });
      group.appendChild(ul);
      list.appendChild(group);
      dayGroups.push(group);
    });
    calBody.appendChild(list);
  }

  function showConnect(message) {
    calBody.textContent = '';
    var box = document.createElement('div');
    box.className = 'cal-connect';
    if (message) {
      var p = document.createElement('p');
      p.textContent = message;
      box.appendChild(p);
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary';
    btn.textContent = 'Googleカレンダーの予定を読み込む';
    btn.addEventListener('click', connectGoogle);
    box.appendChild(btn);
    calBody.appendChild(box);
  }

  function loadCalendar() {
    var token = readToken();
    if (!token) { showConnect(); renderSettings(); return; }
    calBody.textContent = '';
    var loading = document.createElement('p');
    loading.className = 'cal-loading';
    loading.textContent = '予定を読み込んでいます…';
    calBody.appendChild(loading);
    fetchWeekEvents(token)
      .then(function (events) { renderEvents(eventsByDay(events)); renderSettings(); })
      .catch(function (e) {
        if (e.auth) { clearToken(); showConnect('連携の期限が切れました。もう一度読み込んでください。'); }
        else showConnect('予定を読み込めませんでした。通信を確かめて、もう一度試してください。');
        renderSettings();
      });
  }

  // 曜日の行を触ったら、上の予定をその日まで送る
  function scrollAgendaTo(i) {
    var g = dayGroups[i];
    if (!g) return;
    calBody.scrollTo({ top: g.offsetTop, behavior: 'smooth' });
  }
  rows.forEach(function (r, i) {
    r.row.addEventListener('pointerdown', function () { scrollAgendaTo(i); });
    r.row.addEventListener('focusin', function () { scrollAgendaTo(i); });
  });

  // 一番下の設定：連携の状態と解除
  function renderSettings() {
    var box = $('calendarSettingsBody');
    box.textContent = '';
    var p = document.createElement('p');
    if (!GOOGLE_CLIENT_ID) {
      p.textContent = 'Googleカレンダー連携は準備中です（クライアントIDが未設定）。';
      box.appendChild(p);
      return;
    }
    var token = readToken();
    p.textContent = token ? 'Googleカレンダーと連携中（読み取りのみ）。1時間たつと、もう一度読み込みが必要です。'
                          : 'Googleカレンダーとは、まだ連携していません。';
    box.appendChild(p);
    if (token) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link';
      btn.textContent = '連携を解除する';
      btn.addEventListener('click', function () {
        var t = readToken();
        clearToken();
        if (t) {
          fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST', mode: 'no-cors' }).catch(function () {});
        }
        showConnect('連携を解除しました。');
        renderSettings();
      });
      box.appendChild(btn);
    }
  }

  function initCalendar() {
    if (!GOOGLE_CLIENT_ID) { calSection.hidden = true; renderSettings(); return; }
    calSection.hidden = false;
    var back = takeTokenFromUrl();
    if (back && back.error) { showConnect(back.error); renderSettings(); return; }
    loadCalendar();
  }

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

  initCalendar();
  save();
})();
