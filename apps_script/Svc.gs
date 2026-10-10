/**
 * Svc.gs: the only file that talks to Google services other than Sheets.
 *
 * Everything here is replaced by fakes in the tests and the browser preview,
 * so the rest of the server code runs unchanged outside Apps Script. Keep each
 * method small and free of business rules.
 *
 * Calendar events are passed around as plain objects:
 *   { id, title, description, allDay, startDate, endDate, startTime, endTime, creators }
 * startDate/endDate are 'yyyy-MM-dd'. For all-day events endDate is EXCLUSIVE
 * (as Google stores it); startTime/endTime are 'HH:mm' and empty for all-day.
 */
var Svc = (function () {
  'use strict';

  var TZ = 'Asia/Dubai';

  function fmt(d, pattern) { return Utilities.formatDate(d, TZ, pattern); }

  function at(ymd, hhmm) {
    return new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10),
      +hhmm.slice(0, 2), +hhmm.slice(3, 5));
  }

  function calendar(id) {
    var cal = CalendarApp.getCalendarById(id);
    if (!cal) throw U.err('CALENDAR', 'The script cannot open calendar ' + id + '. Check that the account that deployed the app can see it.');
    return cal;
  }

  function plainEvent(e, withCreators) {
    var allDay = e.isAllDayEvent();
    var start = allDay ? e.getAllDayStartDate() : e.getStartTime();
    var end = allDay ? e.getAllDayEndDate() : e.getEndTime();
    var creators = [];
    if (withCreators) {
      try { creators = e.getCreators() || []; } catch (x) { creators = []; }
    }
    return {
      id: e.getId(),
      title: e.getTitle() || '',
      description: e.getDescription() || '',
      allDay: allDay,
      startDate: fmt(start, 'yyyy-MM-dd'),
      endDate: fmt(end, 'yyyy-MM-dd'),
      startTime: allDay ? '' : fmt(start, 'HH:mm'),
      endTime: allDay ? '' : fmt(end, 'HH:mm'),
      creators: creators
    };
  }

  return {
    userEmail: function () {
      return U.normEmail(Session.getActiveUser().getEmail());
    },

    /** The account the script runs as: the deployer for web app calls, the trigger owner for triggers. */
    effectiveEmail: function () {
      return U.normEmail(Session.getEffectiveUser().getEmail());
    },

    today: function () { return fmt(new Date(), 'yyyy-MM-dd'); },

    stamp: function () { return fmt(new Date(), "yyyy-MM-dd'T'HH:mm:ss"); },

    /** Runs fn while holding the script lock, so two saves can never interleave. */
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) {
        throw U.err('BUSY', 'The calendar is busy saving someone else\'s change. Please try again.');
      }
      try {
        return fn();
      } finally {
        lock.releaseLock();
      }
    },

    /** Calendar ID for a calendar name the deploying account subscribes to, or ''. */
    calendarIdByName: function (name) {
      var list = CalendarApp.getCalendarsByName(name) || [];
      return list.length ? list[0].getId() : '';
    },

    /** Events overlapping [fromYmd, toYmdExclusive). Creators are fetched only when asked for. */
    calendarEvents: function (calId, fromYmd, toYmdExclusive, withCreators) {
      return calendar(calId).getEvents(at(fromYmd, '00:00'), at(toYmdExclusive, '00:00'))
        .map(function (e) { return plainEvent(e, withCreators); });
    },

    /**
     * Creates or updates one event and returns its id.
     * spec = { title, description, date, allDay, start, end }
     */
    calendarUpsert: function (calId, eventId, spec) {
      var cal = calendar(calId);
      var ev = null;
      if (eventId) {
        try { ev = cal.getEventById(eventId); } catch (x) { ev = null; }
      }
      if (ev) {
        ev.setTitle(spec.title);
        ev.setDescription(spec.description);
        if (spec.allDay) ev.setAllDayDate(U.toDate(spec.date));
        else ev.setTime(at(spec.date, spec.start), at(spec.date, spec.end));
        return ev.getId();
      }
      ev = spec.allDay
        ? cal.createAllDayEvent(spec.title, U.toDate(spec.date), { description: spec.description })
        : cal.createEvent(spec.title, at(spec.date, spec.start), at(spec.date, spec.end), { description: spec.description });
      return ev.getId();
    },

    /** Deletes an event if it still exists. Returns true when something was deleted. */
    calendarDelete: function (calId, eventId) {
      var ev = null;
      try { ev = calendar(calId).getEventById(eventId); } catch (x) { ev = null; }
      if (!ev) return false;
      ev.deleteEvent();
      return true;
    },

    sendMail: function (msg) {
      var options = { to: msg.to, subject: msg.subject, body: msg.body, name: 'Assessment Calendar' };
      if (msg.replyTo) options.replyTo = msg.replyTo;
      MailApp.sendEmail(options);
    },

    appUrl: function () {
      try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
    },

    log: function (msg) { console.log(msg); }
  };
})();
