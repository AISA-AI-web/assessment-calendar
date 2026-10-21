'use strict';

// The real Sheet backend in Store.gs, run against a fake Sheet: the other tests
// use the in-memory backend, so this is the only check of how the app writes
// to Google Sheets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** A tab whose rule cells reject any value but 'OK'. A table's rules can't be cleared. */
function fakeTab(name, opts) {
  const cells = {};
  const rules = {};
  (opts.rules || []).forEach((k) => { rules[k] = true; });
  const at = (r, c) => r + ':' + c;
  let lastRow = 0;
  let lastCol = 0;
  return {
    rules,
    getName: () => name,
    getLastRow: () => lastRow,
    getLastColumn: () => lastCol,
    clearContents() { Object.keys(cells).forEach((k) => delete cells[k]); lastRow = 0; lastCol = 0; },
    setFrozenRows() {},
    value: (r, c) => cells[at(r, c)],
    getRange(row, col, rows, cols) {
      rows = rows || 1;
      cols = cols || 1;
      const each = (fn) => { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) fn(row + i, col + j, i, j); };
      return {
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
        getValues() {
          const out = [];
          for (let i = 0; i < rows; i++) out.push(Array.from({ length: cols }, (_, j) => cells[at(row + i, col + j)] ?? ''));
          return out;
        },
        clearDataValidations() { if (!opts.table) each((r, c) => delete rules[at(r, c)]); },
        setValues(v) {
          each((r, c, i, j) => {
            if (rules[at(r, c)] && v[i][j] !== 'OK') {
              throw new Error('The data you entered in cell ' + String.fromCharCode(64 + c) + r + ' violates the data validation rules set on this cell.');
            }
          });
          each((r, c, i, j) => { cells[at(r, c)] = v[i][j]; });
          lastRow = Math.max(lastRow, row + rows - 1);
          lastCol = Math.max(lastCol, col + cols - 1);
        }
      };
    }
  };
}

function storeWith(tab) {
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === tab.getName() ? tab : null) }) }
  };
  vm.createContext(ctx);
  ['Util', 'Store'].forEach((f) => {
    const file = path.join(__dirname, '..', 'apps_script', f + '.gs');
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  });
  return vm.runInContext('Store', ctx);
}

const SECTION = { section_id: '9101', course_number: 'G09ENG', course_name: 'English 9' };

test("a dropdown someone added to one of the app's tabs no longer blocks writing to it", () => {
  const tab = fakeTab('Sections', { rules: ['2:2', '9:9'] });
  storeWith(tab).replaceAll('Sections', [SECTION]);
  assert.equal(tab.value(1, 2), 'course_number');
  assert.equal(tab.value(2, 2), 'G09ENG');
  assert.deepEqual(Object.keys(tab.rules), ['9:9'], 'only the rule in the way is removed');
});

test('a rule that cannot be removed is reported with the tab it is on', () => {
  const tab = fakeTab('Sections', { rules: ['2:2'], table: true });
  assert.throws(() => storeWith(tab).replaceAll('Sections', [SECTION]), (e) => {
    assert.match(e.userMessage, /^Could not write to the Sections tab: The data you entered in cell B2/);
    assert.match(e.userMessage, /Data validation → Remove all/);
    return true;
  });
});
