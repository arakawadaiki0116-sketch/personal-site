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
      hours: 6,
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
      var hrs = parseInt(saved.hours, 10);
      if (hrs >= 1 && hrs <= 12) s.hours = hrs;
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

  var UPDATED_KEY = 'shiftMemo.updatedAt';
  function readUpdatedAt() {
    try { return parseInt(localStorage.getItem(UPDATED_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function writeLocal(updatedAt) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ limit: state.limit, hours: state.hours, days: state.days }));
      localStorage.setItem(UPDATED_KEY, String(updatedAt));
    } catch (e) { /* 保存不可でも動作は続ける */ }
  }

  // 入力が変わるたびに呼ぶ：このブラウザに保存し、ログイン中ならほかの端末とも共有する
  function save() {
    writeLocal(Date.now());
    updatePreview();
    schedulePush();
  }

  var state = load();

  // ほかの端末で入れた内容を画面に反映する
  function applyRemote(data, updatedAt) {
    var fresh = defaultState();
    var lim = parseInt(data && data.limit, 10);
    fresh.limit = lim >= 1 && lim <= 7 ? lim : state.limit;
    fresh.days = state.days.map(function (d, i) {
      var r = data && Array.isArray(data.days) ? data.days[i] : null;
      if (!r) return d;
      return {
        off: !!r.off,
        start: TIME_LABELS.indexOf(r.start) >= 0 ? r.start : d.start,
        end: TIME_LABELS.indexOf(r.end) >= 0 ? r.end : d.end
      };
    });
    var hrs = parseInt(data && data.hours, 10);
    state.hours = hrs >= 1 && hrs <= 12 ? hrs : state.hours;
    state.limit = fresh.limit;
    state.days = fresh.days;
    rows.forEach(function (r, i) {
      r.start.setValue(state.days[i].start);
      r.end.setValue(state.days[i].end);
      r.off.checked = state.days[i].off;
      applyOff(i);
    });
    $('limit').value = String(state.limit);
    $('hours').value = String(state.hours);
    writeLocal(updatedAt);
    updatePreview();
  }

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
      // ほかの端末の内容を反映するとき（onChange は呼ばない）
      setValue: function (v) {
        var idx = TIME_LABELS.indexOf(v);
        if (idx < 0) return;
        index = idx;
        mark(idx);
        scroller.scrollTop = idx * ITEM_H;
      },
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

    // 予定と重なったときに出す一行（ふだんは隠す）
    var conflict = document.createElement('p');
    conflict.className = 'conflict';
    conflict.hidden = true;
    row.appendChild(conflict);

    rows.push({ row: row, start: start, end: end, off: off, conflict: conflict });
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

  // ---- 一日の勤務時間の上限 ----
  var hoursEl = $('hours');
  for (var h = 1; h <= 12; h++) {
    var oh = document.createElement('option');
    oh.value = oh.textContent = String(h);
    hoursEl.appendChild(oh);
  }
  hoursEl.value = String(state.hours);
  hoursEl.addEventListener('change', function () { state.hours = parseInt(hoursEl.value, 10); save(); });

  // ---- 見出しの期間 ----
  function mdw(d) { return md(d) + '(' + DAY_NAMES[d.getDay()] + ')'; }
  $('weekStart').textContent = mdw(weekStart);
  $('weekEnd').textContent = mdw(addDays(weekStart, 6));

  // ---- ログイン・予定・入力の共有 ----
  // Cloudflare の中継役（worker/）が、Google ログインの確認、来週の予定、入力内容の保存を受け持つ。
  // ログインは arakawadaiki0116@gmail.com だけが通る（許可するアドレスは中継役の秘密の設定にある）。
  var API = 'https://shift-calendar.arakawadaiki0116.workers.dev';
  var SESSION_KEY = 'shiftMemo.session';
  var OAUTH_KEY = 'shiftMemo.oauth';

  var calSection = $('calendarSection');
  var calBody = $('calendarBody');
  var dayGroups = []; // 曜日ごとの見出し要素（スクロール先）

  try { localStorage.removeItem('shiftMemo.calKey'); } catch (e) { /* 前の合言葉は使わない */ }

  function readSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && s.exp * 1000 > Date.now()) return s;
    } catch (e) { /* 無視 */ }
    return null;
  }
  function writeSession(s) {
    try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* 無視 */ }
  }
  function sessionEmail(s) {
    try {
      var body = s.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(body + '==='.slice((body.length + 3) % 4))).e || '';
    } catch (e) { return ''; }
  }

  function api(path, opt) {
    var s = readSession();
    opt = opt || {};
    var headers = opt.headers || {};
    if (s) headers.Authorization = 'Bearer ' + s.token;
    return fetch(API + path, { method: opt.method || 'GET', headers: headers, body: opt.body, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) { writeSession(null); showLoggedOut(); var e = new Error('login'); e.login = true; throw e; }
        return r;
      });
  }

  function randomHex() {
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // 「Googleでログイン」：Google のログイン画面へ移る（戻ってきたら finishLogin）
  function startLogin() {
    showMessage('Google のログイン画面へ移動しています…');
    fetch(API + '/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg.clientId) { showLoggedOut('ログインの準備がまだ終わっていません。'); return; }
      var st = randomHex(), nonce = randomHex();
      try { localStorage.setItem(OAUTH_KEY, JSON.stringify({ state: st, nonce: nonce })); } catch (e) { /* 無視 */ }
      var q = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: location.origin + location.pathname.replace(/index\.html$/, ''),
        response_type: 'id_token',
        scope: 'openid email',
        state: st,
        nonce: nonce,
        prompt: 'select_account'
      });
      location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
    }).catch(function () { showLoggedOut('通信できませんでした。もう一度試してください。'); });
  }

  // Google から戻ってきたとき：URL の # 以降の証明書を中継役に渡して、通行証をもらう
  function finishLogin() {
    if (!location.hash || location.hash.length < 2) return Promise.resolve(false);
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('id_token') && !p.get('error')) return Promise.resolve(false);
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(OAUTH_KEY) || 'null'); localStorage.removeItem(OAUTH_KEY); } catch (e) { /* 無視 */ }
    history.replaceState(null, '', location.pathname + location.search); // 証明書を URL に残さない
    if (p.get('error')) { showLoggedOut('ログインがキャンセルされました。'); return Promise.resolve(true); }
    if (!saved || p.get('state') !== saved.state) { showLoggedOut('ログインの確認に失敗しました。もう一度試してください。'); return Promise.resolve(true); }
    showMessage('ログインしています…');
    return fetch(API + '/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: p.get('id_token'), nonce: saved.nonce })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (r.ok && data.session) { writeSession({ token: data.session, exp: data.exp }); return true; }
        showLoggedOut(data.error === 'not_allowed' ? 'このアカウントでは使えません。' : 'ログインできませんでした。もう一度試してください。');
        return true;
      });
    }).catch(function () { showLoggedOut('通信できませんでした。もう一度試してください。'); return true; });
  }

  // ---- 入力内容の共有 ----
  var pushTimer = null;
  function schedulePush() {
    if (!readSession()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushState, 800);
  }
  function pushState() {
    var body = JSON.stringify({ data: { limit: state.limit, hours: state.hours, days: state.days }, updatedAt: readUpdatedAt() });
    api('/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) {
        if (r.status === 409) return r.json().then(function (cur) { applyRemote(cur.data, cur.updatedAt); });
      })
      .catch(function () { /* 通信できないときは、次に入力したときに送る */ });
  }
  function pullState() {
    if (!readSession()) return Promise.resolve();
    return api('/state').then(function (r) { return r.json(); }).then(function (remote) {
      var local = readUpdatedAt();
      if (remote && remote.data && remote.updatedAt > local) applyRemote(remote.data, remote.updatedAt);
      else if (local > ((remote && remote.updatedAt) || 0)) pushState();
    }).catch(function () { /* 通信できなければ、このブラウザの内容のまま */ });
  }

  function fetchWeekEvents() {
    return api('/events?start=' + toISO(weekStart) + '&days=7').then(function (r) {
      if (r.status === 503) { var n = new Error('setup'); n.setup = true; throw n; }
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) { return data.events || []; });
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
        it.li = li;
        ul.appendChild(li);
      });
      group.appendChild(ul);
      list.appendChild(group);
      dayGroups.push(group);
    });
    calBody.appendChild(list);
  }

  function showMessage(message) {
    calBody.textContent = '';
    var p = document.createElement('p');
    p.className = 'cal-loading';
    p.textContent = message;
    calBody.appendChild(p);
  }

  function showLoggedOut(message) {
    calSection.hidden = false;
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
    btn.textContent = 'Googleでログイン';
    btn.addEventListener('click', startLogin);
    box.appendChild(btn);
    calBody.appendChild(box);
    renderSettings();
  }

  function loadCalendar() {
    if (!readSession()) { showLoggedOut(); return; }
    calSection.hidden = false;
    renderSettings();
    showMessage('予定を読み込んでいます…');
    fetchWeekEvents()
      .then(function (events) { dayEvents = eventsByDay(events); renderEvents(dayEvents); checkConflicts(); })
      .catch(function (e) {
        if (e.login) return; // ログイン画面に戻した
        if (e.setup) showMessage('カレンダーの読み込み先がまだ設定されていません。');
        else showMessage('予定を読み込めませんでした。通信を確かめて、開き直してください。');
      });
  }

  // 曜日の行を触ったら、上の予定をその日まで送る
  function scrollAgendaTo(i) {
    var g = dayGroups[i];
    if (!g) return;
    calBody.scrollTo({ top: g.offsetTop, behavior: 'smooth' });
  }
  var followDay = -1;
  rows.forEach(function (r, i) {
    r.row.addEventListener('pointerdown', function () { followDay = i; scrollAgendaTo(i); });
    r.row.addEventListener('focusin', function () { followDay = i; scrollAgendaTo(i); });
  });

  // 画面を下げると予定は上に残る（CSS の sticky）。そのとき、すぐ下に見えている曜日まで予定を送る
  var scrollTicking = false;
  function onPageScroll() {
    scrollTicking = false;
    var secTop = calSection.getBoundingClientRect().top;
    var stuck = !calSection.hidden && secTop <= 0 && window.scrollY > 0;
    calSection.classList.toggle('is-stuck', stuck);
    var bottom = calSection.hidden ? 0 : calSection.getBoundingClientRect().bottom;
    document.documentElement.style.scrollPaddingTop = bottom + 'px'; // 選んだ行が予定の下に隠れないように
    if (!stuck) return;
    for (var i = 0; i < rows.length; i++) {
      var rect = rows[i].row.getBoundingClientRect();
      if (rect.bottom > bottom + rect.height * 0.4) {
        if (i !== followDay) { followDay = i; scrollAgendaTo(i); }
        return;
      }
    }
  }
  window.addEventListener('scroll', function () {
    if (!scrollTicking) { scrollTicking = true; setTimeout(onPageScroll, 60); }
  }, { passive: true });

  // 一番下の設定：ログインの状態とログアウト
  function renderSettings() {
    var box = $('calendarSettingsBody');
    box.textContent = '';
    var s = readSession();
    var p = document.createElement('p');
    p.textContent = s ? (sessionEmail(s) || 'Google') + ' でログイン中です。入力内容はほかの端末と共有されます。'
                      : 'ログインしていません。入力内容はこのブラウザの中だけに保存されます。';
    box.appendChild(p);
    if (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link';
      btn.textContent = 'この端末でログアウト';
      btn.addEventListener('click', function () { writeSession(null); showLoggedOut(); });
      box.appendChild(btn);
    }
  }

  function initAccount() {
    finishLogin().then(function () {
      if (!readSession()) { if (!calBody.childNodes.length) showLoggedOut(); else renderSettings(); return; }
      pullState();
      loadCalendar();
    });
    // ほかの端末で入れたあと、この画面に戻ってきたら取り直す
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pullState();
    });
  }

  // ---- メッセージ ----
  function buildText() {
    var lines = ['以下、' + md(weekStart) + '以降のシフトです。', ''];
    state.days.forEach(function (d, i) {
      var head = '(' + DAY_NAMES[i] + ') ';
      lines.push(d.off ? head + '不可' : head + d.start + 'から' + d.end);
    });
    lines.push('');
    lines.push('一日の勤務時間は' + state.hours + '時間以下。一週間の勤務回数は' + state.limit + '回以下でお願いします。');
    return lines.join('\n');
  }

  function updatePreview() {
    var preview = $('preview');
    if (!preview) return;
    preview.value = buildText();
    $('sendStatus').textContent = '';
    checkConflicts();
  }

  // ---- 希望時間と予定の重なり ----
  // 時刻つきの予定が、その日の希望時間と少しでも重なったら知らせる（終日の予定と「不可」の日は見ない）
  var dayEvents = null; // 曜日ごとの予定（読み込めたら入る）
  function minutesOf(label) {
    var p = label.split(':');
    return +p[0] * 60 + +p[1];
  }
  function checkConflicts() {
    if (!rows.length) return;
    var conflictDays = [];
    rows.forEach(function (r, i) {
      var d = state.days[i];
      var hits = [];
      var items = dayEvents ? dayEvents[i] : [];
      items.forEach(function (it) { if (it.li) it.li.classList.remove('is-conflict'); });
      if (dayEvents && !d.off) {
        var base = addDays(weekStart, i);
        var s0 = new Date(base.getTime()); s0.setMinutes(minutesOf(d.start));
        var e0 = new Date(base.getTime()); e0.setMinutes(minutesOf(d.end));
        items.forEach(function (it) {
          if (it.allDay) return;
          if (it.start < e0 && it.end > s0) {
            hits.push((it.fromPrev ? '' : hm(it.start)) + '–' + (it.toNext ? '' : hm(it.end)) + ' ' + it.title);
            if (it.li) it.li.classList.add('is-conflict');
          }
        });
      }
      r.row.classList.toggle('has-conflict', hits.length > 0);
      r.conflict.hidden = !hits.length;
      r.conflict.textContent = hits.length ? '予定と重なっています：' + hits.join('、') : '';
      if (hits.length) conflictDays.push(DAY_NAMES[i]);
    });
    var note = $('conflictNote');
    if (note) note.textContent = conflictDays.length ? conflictDays.join('・') + '曜が予定と重なっています' : '';
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

  updatePreview();
  initAccount();
})();
