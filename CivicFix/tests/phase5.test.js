'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase, insertReport, getAnalytics } = require('../lib/database');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civicfix-phase5-'));
  return { dir, file: path.join(dir, 'analytics.sqlite') };
}

test('analytics aggregate actual seeded report records by status, category, and priority', () => {
  const temp = tempDb(); const db = createDatabase(temp.file);
  try {
    const analytics = getAnalytics(db);
    assert.equal(analytics.total, 12);
    assert.equal(analytics.statuses.reduce((sum, item) => sum + item.count, 0), analytics.total);
    assert.equal(analytics.categories.reduce((sum, item) => sum + item.count, 0), analytics.total);
    assert.equal(analytics.priorities.reduce((sum, item) => sum + item.count, 0), analytics.total);
    assert.ok(analytics.statuses.some(item => item.label === 'resolved' && item.count > 0));
    assert.ok(analytics.categories.some(item => item.label === 'Drainage' && item.count > 0));
  } finally { db.close(); fs.rmSync(temp.dir, { recursive: true, force: true }); }
});

test('analytics reports known groups with zero counts for an empty database', () => {
  const temp = tempDb(); const db = createDatabase(temp.file);
  try {
    db.exec('DELETE FROM reports');
    const analytics = getAnalytics(db);
    assert.equal(analytics.total, 0);
    for (const group of [analytics.statuses, analytics.categories, analytics.priorities]) {
      assert.ok(group.length > 0);
      assert.ok(group.every(item => item.count === 0));
    }
  } finally { db.close(); fs.rmSync(temp.dir, { recursive: true, force: true }); }
});

test('analytics reflects a newly inserted report and exposes aggregates only', () => {
  const temp = tempDb(); const db = createDatabase(temp.file);
  try {
    const before = getAnalytics(db);
    insertReport(db, { title: 'New road surface damage', category: 'Roads & potholes', location: 'Civic Hall Road', description: 'The road surface has broken near the crossing.', impact: 'minor' });
    const after = getAnalytics(db);
    assert.equal(after.total, before.total + 1);
    assert.equal(after.categories.find(item => item.label === 'Roads & potholes').count, before.categories.find(item => item.label === 'Roads & potholes').count + 1);
    assert.equal(Object.hasOwn(after, 'reports'), false);
    assert.equal(Object.hasOwn(after, 'locations'), false);
  } finally { db.close(); fs.rmSync(temp.dir, { recursive: true, force: true }); }
});

test('analytics UI renders labels and values with text APIs and distinct loading/error states', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(html, /id="analytics-heading"/);
  assert.match(html, /id="analytics-state" class="analytics-state" role="status" aria-live="polite"/);
  assert.match(html, /id="analytics-statuses"/); assert.match(html, /id="analytics-categories"/); assert.match(html, /id="analytics-priorities"/);
  assert.match(app, /fetch\('\/api\/analytics'/);
  assert.match(app, /No reports are currently stored/);
  assert.match(app, /analyticsState\.textContent = error\.message/);
  assert.match(app, /count\.textContent = String\(item\.count\)/);
  assert.doesNotMatch(app, /innerHTML\s*=/);
  assert.match(css, /analytics-distributions/); assert.match(css, /focus-visible/);
});
