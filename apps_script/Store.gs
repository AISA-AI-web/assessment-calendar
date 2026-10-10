/**
 * Store.gs: the Sheet as a set of tables.
 *
 * Every tab is a table whose first row holds the column names. Rows are read
 * as plain objects keyed by column name, so admins may reorder columns or add
 * their own without breaking anything. All values are written as plain text,
 * so Sheets never turns '2026-10-05' into a date or '3' into a number.
 *
 * The backend is swappable. In Apps Script it is the bound Sheet; tests and
 * the browser preview install an in-memory backend with the same five methods.
 * Rows are never deleted or moved, so a row's index (_i) stays valid for
 * updates. All writes to shared tables happen inside Svc.withLock.
 */
var Store = (function () {
  'use strict';

  var SCHEMAS = {
    Settings: ['key', 'value', 'notes'],
    Staff: ['email', 'name', 'role', 'notes'],
    Sections: ['section_id', 'course_number', 'course_name', 'section_number', 'teacher_emails',
      'teacher_names', 'expression', 'term', 'department', 'grades', 'student_count'],
    Enrolments: ['student_number', 'student_email', 'grade', 'section_id', 'date_enrolled', 'date_left'],
    Assessments: ['id', 'group_id', 'status', 'category', 'format', 'title', 'notes', 'section_id',
      'grade', 'date', 'periods', 'announced', 'teacher_email', 'created_by', 'created_at',
      'updated_by', 'updated_at', 'request_reason', 'override_reason', 'override_by',
      'decided_by', 'decided_at', 'decision_note', 'mirror', 'mirror_status', 'source', 'source_ref'],
    InternalEvents: ['event_id', 'start', 'end', 'all_day', 'start_time', 'end_time', 'title',
      'category', 'grades', 'override_category', 'override_grades', 'synced_at'],
    CalendarRules: ['pattern', 'category', 'notes'],
    Bells: ['schedule', 'from', 'to', 'weekdays', 'period', 'start', 'end'],
    ImportQueue: ['import_id', 'grade', 'event_id', 'title', 'date', 'end_date', 'start_time',
      'end_time', 'all_day', 'creator_email', 'guess_category', 'status', 'assessment_ids',
      'handled_by', 'handled_at'],
    Log: ['at', 'user', 'action', 'ref', 'details'],
    PS_Sections: [],
    PS_Enrolments: []
  };

  var backend = null;
  var memo = {};

  function setBackend(b) {
    backend = b;
    memo = {};
  }

  function be() {
    if (!backend) backend = sheetBackend();
    return backend;
  }

  /** Reads a table once per execution. Adds any schema column the tab is missing. */
  function table(name) {
    if (memo[name]) return memo[name];
    var t = be().read(name);
    var schema = SCHEMAS[name] || [];
    var missing = schema.filter(function (h) { return t.headers.indexOf(h) < 0; });
    if (missing.length && t.exists && t.headers.length) {
      be().ensure(name, schema);
      t = be().read(name);
    }
    var headers = t.headers;
    var rows = [];
    t.rows.forEach(function (row, i) {
      var o = { _i: i };
      var blank = true;
      headers.forEach(function (h, c) {
        if (!h) return;
        var v = row[c];
        if (v !== '' && v !== null && v !== undefined) blank = false;
        o[h] = v === null || v === undefined ? '' : v;
      });
      if (!blank) rows.push(o);
    });
    memo[name] = {
      exists: !!t.exists && headers.length > 0,
      headers: headers.length ? headers : schema.slice(),
      rows: rows,
      count: t.rows.length
    };
    return memo[name];
  }

  /** The table, creating the tab and its header row first if they are missing. */
  function writable(name) {
    var t = table(name);
    if (t.exists) return t;
    be().ensure(name, SCHEMAS[name] || []);
    delete memo[name];
    return table(name);
  }

  function all(name) { return table(name).rows; }

  function headers(name) { return table(name).headers; }

  function cell(v) {
    if (v === null || v === undefined) return '';
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    if (typeof v === 'object' && !U.isDate(v)) return JSON.stringify(v);
    return String(v);
  }

  function toRow(hdrs, obj) {
    return hdrs.map(function (h) { return h ? cell(obj[h]) : ''; });
  }

  function append(name, objs) {
    if (!objs.length) return;
    var t = writable(name);
    be().append(name, objs.map(function (o) { return toRow(t.headers, o); }));
    objs.forEach(function (o, k) {
      var copy = {};
      Object.keys(o).forEach(function (key) { copy[key] = o[key]; });
      copy._i = t.count + k;
      o._i = copy._i;
      t.rows.push(copy);
    });
    t.count += objs.length;
  }

  /** Writes obj back to its row. obj must carry the _i it was read with. */
  function update(name, obj) {
    if (typeof obj._i !== 'number') throw new Error('Store.update needs a row read from ' + name);
    var t = writable(name);
    be().write(name, obj._i, toRow(t.headers, obj));
    for (var i = 0; i < t.rows.length; i++) {
      if (t.rows[i]._i === obj._i) {
        var copy = {};
        Object.keys(obj).forEach(function (key) { copy[key] = obj[key]; });
        t.rows[i] = copy;
        break;
      }
    }
  }

  function replaceAll(name, objs) {
    var hdrs = (SCHEMAS[name] && SCHEMAS[name].length) ? SCHEMAS[name] : headers(name);
    be().replace(name, hdrs, objs.map(function (o) { return toRow(hdrs, o); }));
    delete memo[name];
  }

  /** Raw table for imported tabs with free-form headers. */
  function raw(name) { return be().read(name); }

  function ensure(name) {
    var created = be().ensure(name, SCHEMAS[name] || []);
    delete memo[name];
    return created;
  }

  function invalidate(name) {
    if (name) delete memo[name];
    else memo = {};
  }

  /* ---------------------------------------------------------------------
     The Sheet backend
     ------------------------------------------------------------------ */

  function sheetBackend() {
    var ss = null;

    function book() {
      if (ss) return ss;
      ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) {
        var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
        if (!id) throw U.err('CONFIG', 'The script is not bound to a Sheet and SPREADSHEET_ID is not set.');
        ss = SpreadsheetApp.openById(id);
      }
      return ss;
    }

    function sheet(name, create) {
      var sh = book().getSheetByName(name);
      if (!sh && create) sh = book().insertSheet(name);
      return sh;
    }

    function textRange(sh, row, col, rows, cols) {
      var r = sh.getRange(row, col, rows, cols);
      r.setNumberFormat('@');
      return r;
    }

    return {
      read: function (name) {
        var sh = sheet(name, false);
        if (!sh) return { exists: false, headers: [], rows: [] };
        var lastRow = sh.getLastRow();
        var lastCol = sh.getLastColumn();
        if (lastRow < 1 || lastCol < 1) return { exists: true, headers: [], rows: [] };
        var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
        return {
          exists: true,
          headers: values[0].map(function (h) { return String(h).trim(); }),
          rows: values.slice(1)
        };
      },
      append: function (name, rows) {
        var sh = sheet(name, true);
        textRange(sh, sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      },
      write: function (name, index, values) {
        var sh = sheet(name, true);
        textRange(sh, index + 2, 1, 1, values.length).setValues([values]);
      },
      replace: function (name, hdrs, rows) {
        var sh = sheet(name, true);
        sh.clearContents();
        var data = [hdrs].concat(rows);
        textRange(sh, 1, 1, data.length, hdrs.length).setValues(data);
      },
      ensure: function (name, hdrs) {
        var sh = sheet(name, false);
        var created = false;
        if (!sh) {
          sh = sheet(name, true);
          created = true;
        }
        if (!hdrs.length) return created;
        var lastCol = sh.getLastColumn();
        var current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
        var missing = hdrs.filter(function (h) { return current.indexOf(h) < 0; });
        if (missing.length) {
          var start = current.filter(function (h) { return h !== ''; }).length ? lastCol + 1 : 1;
          if (start === 1) missing = hdrs;
          textRange(sh, 1, start, 1, missing.length).setValues([missing]);
        }
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
        return created;
      }
    };
  }

  return {
    SCHEMAS: SCHEMAS, setBackend: setBackend, all: all, headers: headers, append: append,
    update: update, replaceAll: replaceAll, raw: raw, ensure: ensure, invalidate: invalidate
  };
})();
