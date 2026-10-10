/**
 * Fake Google services with the same methods as apps_script/Svc.gs: a signed-in
 * user, a fixed "today", in-memory calendars and a mail outbox. Used by the
 * tests and the preview. Needs the server's U (Util.gs) to be loaded first.
 */
(function (root) {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function FakeServices(opts) {
    opts = opts || {};
    var state = {
      user: opts.user || '',
      today: opts.today || '2026-10-21',
      calendars: {},
      mail: [],
      logs: [],
      clock: 0,
      seq: 0
    };

    function cal(id) {
      var c = state.calendars[id];
      if (!c) {
        var e = new Error('The script cannot open calendar ' + id + '.');
        e.code = 'CALENDAR';
        e.userMessage = e.message;
        throw e;
      }
      return c;
    }

    function copy(ev) { return JSON.parse(JSON.stringify(ev)); }

    var svc = {
      state: state,

      userEmail: function () { return String(state.user || '').trim().toLowerCase(); },

      today: function () { return state.today; },

      stamp: function () {
        state.clock++;
        return state.today + 'T08:' + pad(Math.floor(state.clock / 60) % 60) + ':' + pad(state.clock % 60);
      },

      withLock: function (fn) { return fn(); },

      calendarIdByName: function (name) {
        var ids = Object.keys(state.calendars);
        for (var i = 0; i < ids.length; i++) if (state.calendars[ids[i]].name === name) return ids[i];
        return '';
      },

      calendarEvents: function (calId, from, toExclusive) {
        var c = cal(calId);
        return Object.keys(c.events).map(function (k) { return c.events[k]; }).filter(function (ev) {
          var endExcl = ev.allDay ? ev.endDate : root.U.addDays(ev.startDate, 1);
          return ev.startDate < toExclusive && endExcl > from;
        }).sort(function (a, b) {
          return (a.startDate + (a.startTime || '')) < (b.startDate + (b.startTime || '')) ? -1 : 1;
        }).map(copy);
      },

      calendarUpsert: function (calId, eventId, spec) {
        var c = cal(calId);
        var ev = eventId ? c.events[eventId] : null;
        if (!ev) {
          state.seq++;
          ev = { id: 'ev' + state.seq + '@fake', creators: ['app@school.example'] };
          c.events[ev.id] = ev;
        }
        ev.title = spec.title;
        ev.description = spec.description;
        ev.allDay = !!spec.allDay;
        ev.startDate = spec.date;
        ev.endDate = spec.allDay ? root.U.addDays(spec.date, 1) : spec.date;
        ev.startTime = spec.allDay ? '' : spec.start;
        ev.endTime = spec.allDay ? '' : spec.end;
        return ev.id;
      },

      calendarDelete: function (calId, eventId) {
        var c = cal(calId);
        if (!c.events[eventId]) return false;
        delete c.events[eventId];
        return true;
      },

      sendMail: function (msg) { state.mail.push(copy(msg)); },

      appUrl: function () { return 'https://script.google.com/a/macros/school.example/s/PREVIEW/exec'; },

      log: function (msg) { state.logs.push(String(msg)); }
    };

    /** events: [{ id?, title, description?, allDay, startDate, endDate, startTime?, endTime?, creators? }] */
    svc.addCalendar = function (id, name, events) {
      var c = state.calendars[id] = { name: name, events: {} };
      (events || []).forEach(function (ev) {
        state.seq++;
        var e = copy(ev);
        e.id = e.id || 'seed' + state.seq + '@fake';
        e.description = e.description || '';
        e.startTime = e.startTime || '';
        e.endTime = e.endTime || '';
        e.creators = e.creators || [];
        c.events[e.id] = e;
      });
      return c;
    };

    svc.events = function (calId) {
      var c = cal(calId);
      return Object.keys(c.events).map(function (k) { return copy(c.events[k]); });
    };

    return svc;
  }

  root.FakeServices = FakeServices;
})(typeof globalThis !== 'undefined' ? globalThis : this);
