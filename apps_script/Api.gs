/**
 * Api.gs: everything the browser can call through google.script.run.
 *
 * Every function returns an envelope and never throws:
 *   { ok: true,  data: …, meta: { ms, today } }
 *   { ok: false, error: { code, message, details } }
 * The signed-in person is always worked out on the server from their Google
 * account; nothing the browser sends can change who they are or what role
 * they have.
 */
var Api = (function () {
  'use strict';

  function currentUser() {
    var email = Svc.userEmail();
    if (!email) throw U.err('NO_ACCESS', 'Sign in with your AISA Google account to use the Assessment Calendar.');
    return Dir.userFor(email);
  }

  function run(fn) {
    var started = Date.now();
    try {
      var user = currentUser();
      if (user.role === 'NONE') {
        throw U.err('NO_ACCESS', 'Your account (' + user.email + ') does not have access to the Assessment Calendar yet.');
      }
      var data = fn(user);
      return JSON.parse(JSON.stringify({ ok: true, data: data, meta: { ms: Date.now() - started, today: Svc.today() } }));
    } catch (e) {
      var code = (e && e.code) || 'ERROR';
      if (code === 'ERROR') Svc.log('Unexpected error: ' + (e && e.stack ? e.stack : e));
      return JSON.parse(JSON.stringify({
        ok: false,
        error: {
          code: code,
          message: (e && e.userMessage) || 'Something went wrong on the server. Please try again.',
          details: (e && e.details) || null
        }
      }));
    }
  }

  function isStaff(u) { return u.role !== 'STUDENT'; }

  function projectSection(sec, u) {
    return {
      id: sec.id, courseNumber: sec.courseNumber, courseName: sec.courseName,
      sectionNumber: sec.sectionNumber, label: Dir.label(sec), department: sec.department,
      grades: sec.grades, term: sec.term, termStart: sec.termStart, termEnd: sec.termEnd,
      meetings: sec.meetings, students: sec.studentCount || 0,
      teachers: sec.teachers.map(function (t) { return { email: isStaff(u) ? t : '', name: Dir.teacherName(t) }; }),
      mine: u.sectionIds.indexOf(sec.id) >= 0
    };
  }

  /** Problems an admin should fix before the pilot, shown in a banner to SLT and admins. */
  function dataWarnings(s, d) {
    var out = [];
    if (!Object.keys(d.sections).length) out.push('No PowerSchool data yet: import the sections and enrolments exports.');
    if (!Store.all('InternalEvents').length) out.push('The Internal Calendar has not been synced yet.');
    var missing = s.grades.filter(function (g) { return !s.gradeCalendars[g]; });
    if (s.mirrorEnabled && missing.length) out.push('No grade calendar ID for grade ' + missing.join(', ') + ', so those entries are not copied.');
    return out;
  }

  function bootstrap(u) {
    var s = Config.get();
    var d = Dir.load();
    var staff = isStaff(u);
    var slt = u.role === 'SLT' || u.role === 'ADMIN';
    var ids = staff ? Object.keys(d.sections).filter(function (id) { return !d.sections[id].retired; }) : u.sectionIds;
    var sections = ids.map(function (id) { return d.sections[id]; }).filter(Boolean)
      .map(function (sec) { return projectSection(sec, u); })
      .sort(function (a, b) {
        return U.gradeRank(a.grades[0] || '') - U.gradeRank(b.grades[0] || '') ||
          (a.courseName < b.courseName ? -1 : a.courseName > b.courseName ? 1 : 0) ||
          (a.label < b.label ? -1 : 1);
      });
    return {
      user: {
        email: u.email, name: u.name, role: u.role, isStaff: staff,
        canBook: u.role === 'TEACHER' || slt, canOverride: slt,
        grade: u.grade || null, sectionIds: u.sectionIds
      },
      settings: {
        appTitle: s.appTitle, divisionLabel: s.divisionLabel, grades: s.grades,
        maxPerDay: s.maxPerDay, enforcement: s.enforcement, yearStart: s.yearStart, yearEnd: s.yearEnd,
        supportEmail: s.supportEmail, teachersBookAnySection: s.teachersBookAnySection,
        mirrorEnabled: s.mirrorEnabled
      },
      today: Svc.today(),
      categories: Config.CATEGORIES,
      counted: s.counted,
      formats: Config.FORMATS,
      sections: sections,
      calendar: Days.forClient(staff),
      counts: {
        pending: slt ? Entries.pendingCount() : 0,
        imports: staff ? Mirror.openImportCount(u) : 0
      },
      warnings: slt ? dataWarnings(s, d) : []
    };
  }

  function requireStaff(u) {
    if (!isStaff(u)) throw U.err('FORBIDDEN', 'Students can view the calendar but not change it.');
  }

  return {
    run: run, currentUser: currentUser, bootstrap: bootstrap, requireStaff: requireStaff
  };
})();

/* ---------------------------------------------------------------------
   The functions google.script.run can call. Keep them one line each.
   ------------------------------------------------------------------ */

function apiBootstrap() {
  return Api.run(function (u) { return Api.bootstrap(u); });
}

function apiGetRange(req) {
  return Api.run(function (u) { return Entries.listRange(req || {}, u); });
}

function apiEvaluate(draft) {
  return Api.run(function (u) {
    Api.requireStaff(u);
    var d = Entries.sanitize(draft, true);
    d.excludeIds = U.splitList((draft && draft.excludeIds) || []);
    return Rules.evaluate(d, u);
  });
}

function apiCreate(draft) {
  return Api.run(function (u) { return Entries.create(draft, u); });
}

function apiUpdate(req) {
  return Api.run(function (u) { return Entries.update(req, u); });
}

function apiDelete(req) {
  return Api.run(function (u) { return Entries.remove(req, u); });
}

function apiDecide(req) {
  return Api.run(function (u) { return Entries.decideRequest(req, u); });
}

function apiPending() {
  return Api.run(function (u) { return Entries.pending(u); });
}

function apiImports() {
  return Api.run(function (u) { Api.requireStaff(u); return Mirror.openImports(u); });
}

function apiIgnoreImport(req) {
  return Api.run(function (u) { Api.requireStaff(u); return Mirror.ignore(req, u); });
}
