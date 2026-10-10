/**
 * Util.gs: small pure helpers shared by every server file.
 *
 * Calendar dates are 'yyyy-MM-dd' strings everywhere. Never parse one with
 * new Date('2026-10-05'): that is UTC midnight and can shift the day. Build
 * local dates with new Date(y, m - 1, d); the script time zone is Asia/Dubai.
 *
 * No file may call another module at load time. Each module is an IIFE that
 * only defines functions, so the order Apps Script loads files in never matters.
 */
var U = (function () {
  'use strict';

  var DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  function isYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return fromDate(toDate(s)) === s;
  }

  function toDate(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }

  function fromDate(d) { return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

  function addDays(s, n) {
    var d = toDate(s);
    d.setDate(d.getDate() + n);
    return fromDate(d);
  }

  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  function isoDow(s) {
    var j = toDate(s).getDay();
    return j === 0 ? 7 : j;
  }

  function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }

  /** Every date from a to b inclusive. Capped so a typo can never loop for ever. */
  function range(a, b) {
    var out = [];
    var c = a;
    while (c <= b && out.length < 800) {
      out.push(c);
      c = addDays(c, 1);
    }
    return out;
  }

  function weekStart(s) { return addDays(s, 1 - isoDow(s)); }

  function monthStart(s) { return s.slice(0, 8) + '01'; }

  function monthEnd(s) {
    var d = toDate(monthStart(s));
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return fromDate(d);
  }

  function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

  /** A sheet cell or CSV value as 'yyyy-MM-dd', or '' when it is not a date. */
  function normDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (isDate(v)) return isNaN(v.getTime()) ? '' : fromDate(v);
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return valid(ymd(+m[1], +m[2], +m[3]));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);       // PowerSchool exports MM/DD/YYYY
    if (m) return valid(ymd(+m[3], +m[1], +m[2]));
    return '';
  }

  function valid(s) { return isYmd(s) ? s : ''; }

  /**
   * A time as 'HH:mm', or ''. With schoolHours, a bare 1:00–6:59 means the
   * afternoon, because nobody writes bell times as "13:10" on a sign.
   */
  function normTime(v, schoolHours) {
    if (v === null || v === undefined || v === '') return '';
    var h, min;
    if (isDate(v)) {
      h = v.getHours();
      min = v.getMinutes();
    } else {
      var m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?$/i);
      if (!m) return '';
      h = +m[1];
      min = +m[2];
      if (m[3]) {
        if (/pm/i.test(m[3]) && h < 12) h += 12;
        if (/am/i.test(m[3]) && h === 12) h = 0;
      } else if (schoolHours && h >= 1 && h <= 6) {
        h += 12;
      }
    }
    if (h > 23 || min > 59) return '';
    return pad2(h) + ':' + pad2(min);
  }

  function minutes(hhmm) {
    if (!hhmm) return -1;
    return +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
  }

  /** 'Tue 27 Oct' */
  function human(s) {
    return DOW_SHORT[isoDow(s) - 1] + ' ' + (+s.slice(8, 10)) + ' ' + MON_SHORT[+s.slice(5, 7) - 1];
  }

  /** '1:10' style clock time for people, from 'HH:mm'. */
  function clock(hhmm) {
    if (!hhmm) return '';
    var h = +hhmm.slice(0, 2);
    return (h > 12 ? h - 12 : h) + ':' + hhmm.slice(3, 5);
  }

  function clean(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[\s ​]+/g, ' ').trim();
  }

  function normEmail(s) { return clean(s).toLowerCase(); }

  function splitList(s) {
    if (Array.isArray(s)) return s.map(clean).filter(Boolean);
    return clean(s).split(/[;,\s]+/).filter(Boolean);
  }

  function bool(v) {
    if (v === true || v === false) return v;
    var s = clean(v).toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  function uniq(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (x) {
      var k = typeof x + ':' + x;
      if (!seen[k]) {
        seen[k] = true;
        out.push(x);
      }
    });
    return out;
  }

  function toSet(arr) {
    var s = {};
    (arr || []).forEach(function (x) { s[x] = true; });
    return s;
  }

  function parseJson(s, fallback) {
    if (s === null || s === undefined || s === '') return fallback;
    if (typeof s === 'object') return s;
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
  }

  /** '9', '09', 'Grade 9', 9 → '9'. 'K', 'KG', '0' → 'K'. */
  function normGrade(v) {
    var s = clean(v).toUpperCase().replace(/^GRADE\s*/, '').replace(/^G(?=\d)/, '');
    if (s === 'K' || s === 'KG' || s === '0' || s === 'KG2') return 'K';
    if (/^-?\d+$/.test(s)) {
      var n = parseInt(s, 10);
      return n < 0 ? 'PK' : String(n);
    }
    return s;
  }

  function gradeRank(g) {
    if (g === 'PK') return -2;
    if (g === 'K') return -1;
    var n = parseInt(g, 10);
    return isNaN(n) ? 99 : n;
  }

  function sortGrades(arr) {
    return arr.slice().sort(function (a, b) { return gradeRank(a) - gradeRank(b); });
  }

  /** Strips HTML from calendar descriptions. */
  function stripHtml(s) {
    return clean(String(s || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"'));
  }

  /** An error the user may see. code is machine-readable, message is plain English. */
  function err(code, message, details) {
    var e = new Error(message);
    e.code = code;
    e.userMessage = message;
    if (details) e.details = details;
    return e;
  }

  return {
    pad2: pad2, ymd: ymd, isYmd: isYmd, toDate: toDate, fromDate: fromDate,
    addDays: addDays, isoDow: isoDow, daysBetween: daysBetween, range: range,
    weekStart: weekStart, monthStart: monthStart, monthEnd: monthEnd,
    isDate: isDate, normDate: normDate, normTime: normTime, minutes: minutes,
    human: human, clock: clock, clean: clean, normEmail: normEmail,
    splitList: splitList, bool: bool, uniq: uniq, toSet: toSet,
    parseJson: parseJson, uid: uid, normGrade: normGrade, gradeRank: gradeRank,
    sortGrades: sortGrades, stripHtml: stripHtml, err: err
  };
})();
