/**
 * An in-memory stand-in for the Sheet, with the same five methods as the
 * Sheet backend in apps_script/Store.gs. Used by the tests and the preview.
 * Every value is stored as a string, exactly as the real Sheet stores text.
 */
(function (root) {
  'use strict';

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function MemoryBackend(tables) {
    this.db = {};
    var self = this;
    Object.keys(tables || {}).forEach(function (name) {
      var t = tables[name];
      self.db[name] = { headers: t.headers.slice(), rows: t.rows.map(function (r) { return r.map(str); }) };
    });
  }

  MemoryBackend.prototype.read = function (name) {
    var t = this.db[name];
    if (!t) return { exists: false, headers: [], rows: [] };
    return { exists: true, headers: t.headers.slice(), rows: t.rows.map(function (r) { return r.slice(); }) };
  };

  MemoryBackend.prototype.append = function (name, rows) {
    var t = this.db[name] || (this.db[name] = { headers: [], rows: [] });
    rows.forEach(function (r) { t.rows.push(r.map(str)); });
  };

  MemoryBackend.prototype.write = function (name, index, values) {
    this.db[name].rows[index] = values.map(str);
  };

  MemoryBackend.prototype.replace = function (name, headers, rows) {
    this.db[name] = { headers: headers.slice(), rows: rows.map(function (r) { return r.map(str); }) };
  };

  MemoryBackend.prototype.ensure = function (name, headers) {
    var t = this.db[name];
    var created = false;
    if (!t) {
      t = this.db[name] = { headers: [], rows: [] };
      created = true;
    }
    headers.forEach(function (h) {
      if (t.headers.indexOf(h) >= 0) return;
      t.headers.push(h);
      t.rows.forEach(function (r) { r.push(''); });
    });
    return created;
  };

  /** Rows of a table as objects, for assertions. */
  MemoryBackend.prototype.objects = function (name) {
    var t = this.db[name];
    if (!t) return [];
    return t.rows.map(function (r) {
      var o = {};
      t.headers.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i]; });
      return o;
    });
  };

  /** Builds a backend from { tableName: [objects] } using the given schemas. */
  MemoryBackend.fromObjects = function (schemas, data) {
    var tables = {};
    Object.keys(data).forEach(function (name) {
      var headers = (schemas[name] && schemas[name].length) ? schemas[name] : Object.keys(data[name][0] || {});
      tables[name] = {
        headers: headers,
        rows: data[name].map(function (o) { return headers.map(function (h) { return str(o[h]); }); })
      };
    });
    return new MemoryBackend(tables);
  };

  root.MemoryBackend = MemoryBackend;
})(typeof globalThis !== 'undefined' ? globalThis : this);
