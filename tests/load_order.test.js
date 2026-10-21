'use strict';

// Apps Script runs the project's files one after another, in the order clasp
// pushed them (alphabetical), every time any function is called. A file that
// uses another module while it loads breaks the whole app if that module comes
// later, so each file must load on its own.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'apps_script');
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.gs')).sort();

function loadInOrder(files) {
  const ctx = vm.createContext({ console });
  files.forEach((f) => {
    try {
      vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
    } catch (e) {
      throw new Error(f + ' fails to load when it comes after ' + (files.slice(0, files.indexOf(f)).join(', ') || 'nothing') + ': ' + e.message);
    }
  });
}

test('the server files load in alphabetical order, as Apps Script runs them', () => {
  assert.doesNotThrow(() => loadInOrder(FILES));
});

test('and in reverse order: no file uses another while it loads', () => {
  assert.doesNotThrow(() => loadInOrder(FILES.slice().reverse()));
});
