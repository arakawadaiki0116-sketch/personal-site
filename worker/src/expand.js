// iCal（.ics）の文字列から、指定した期間に重なる予定を取り出す。
// 繰り返し予定（毎週の授業など）・除外日・1回だけ変更した回も展開する。
import ICAL from 'ical.js';

const MAX_STEPS = 5000; // 繰り返しの展開を打ち切る回数（無限ループよけ）

function toOut(time) {
  if (time.isDate) {
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${time.year}-${p(time.month)}-${p(time.day)}` };
  }
  return { dateTime: time.toJSDate().toISOString() };
}

// all-day は日付だけなので、日本時間の 0:00 として比べる
function toMs(time) {
  if (time.isDate) return Date.UTC(time.year, time.month - 1, time.day) - 9 * 3600e3;
  return time.toJSDate().getTime();
}

function isCancelled(comp) {
  return String(comp.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED';
}

/**
 * @param {string} icsText  .ics の中身
 * @param {number} fromMs   期間の始め（UTCミリ秒）
 * @param {number} toMs_    期間の終わり（UTCミリ秒、含まない）
 * @returns {{summary:string,start:object,end:object}[]}
 */
export function expandIcs(icsText, fromMs, toMs_) {
  const root = new ICAL.Component(ICAL.parse(icsText));

  // カレンダーに入っているタイムゾーン定義を登録（TZID=Asia/Tokyo などを正しく扱うため）
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* 二重登録などは無視 */ }
  }

  // 同じ UID の「元の予定」と「1回だけ変えた回（RECURRENCE-ID つき）」をまとめる
  const masters = new Map();
  const exceptions = [];
  for (const comp of root.getAllSubcomponents('vevent')) {
    const uid = comp.getFirstPropertyValue('uid') || Math.random().toString(36);
    if (comp.hasProperty('recurrence-id')) exceptions.push([uid, comp]);
    else masters.set(uid, new ICAL.Event(comp));
  }
  const orphans = [];
  for (const [uid, comp] of exceptions) {
    const master = masters.get(uid);
    if (master) master.relateException(comp);
    else orphans.push(new ICAL.Event(comp));
  }

  const out = [];
  const push = (summary, start, end, comp) => {
    if (isCancelled(comp)) return;
    const s = toMs(start), e = toMs(end || start);
    if (s < toMs_ && (e > fromMs || (e === s && s >= fromMs))) {
      out.push({ summary: summary || '', start: toOut(start), end: toOut(end || start) });
    }
  };

  for (const ev of [...masters.values(), ...orphans]) {
    if (isCancelled(ev.component)) continue;
    if (!ev.isRecurring()) {
      push(ev.summary, ev.startDate, ev.endDate, ev.component);
      continue;
    }
    const it = ev.iterator();
    for (let i = 0, next; i < MAX_STEPS && (next = it.next()); i++) {
      if (toMs(next) >= toMs_) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item.summary, d.startDate, d.endDate, d.item.component);
    }
  }

  out.sort((a, b) => (a.start.dateTime || a.start.date).localeCompare(b.start.dateTime || b.start.date));
  return out;
}
