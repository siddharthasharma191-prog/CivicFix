'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase, insertReport, listReports, getReportById, updateReportStatus } = require('../lib/database');
const { CATEGORIES, validateReport } = require('../lib/validation');
const { parsePort } = require('../lib/port');
const { STATUSES, NEXT_STATUS, validateStatusTransition } = require('../lib/status');
const { isAdminConfigured, safeStringEqual, createSessionToken, verifySessionToken, SESSION_TTL_SECONDS } = require('../lib/admin-auth');

function tempDbPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicfix-test-'));
  return { directory, file: path.join(directory, 'test.sqlite') };
}

test('database initializes schema and seeds clearly fictional sample reports only once', () => {
  const temp = tempDbPath();
  let db = createDatabase(temp.file);
  try {
    const reports = listReports(db);
    assert.equal(reports.length, 12);
    assert.ok(reports.every(report => report.isDemo === true));
    assert.ok(reports.some(report => report.category === 'Roads & potholes'));
    assert.ok(reports.some(report => report.category === 'Waste management'));
    assert.ok(reports.some(report => report.category === 'Streetlights'));
    assert.ok(reports.some(report => report.category === 'Drainage'));
  } finally { db.close(); }
  db = createDatabase(temp.file);
  try { assert.equal(listReports(db).length, 12); }
  finally { db.close(); fs.rmSync(temp.directory, { recursive: true, force: true }); }
});

test('valid report is inserted with generated reference and persists after database reopen', () => {
  const temp = tempDbPath();
  let db = createDatabase(temp.file);
  const input = { title: 'Broken streetlight by library', category: 'Streetlights', location: 'Library Road, Block 3', description: 'The streetlight has been out for three nights.' };
  let created;
  try {
    created = insertReport(db, input);
    assert.match(created.reference, /^CF-\d{6}$/);
    assert.equal(created.isDemo, false);
    assert.equal(created.status, 'submitted');
    assert.equal(created.priority, 'Medium');
    assert.equal(listReports(db).length, 13);
  } finally { db.close(); }
  db = createDatabase(temp.file);
  try {
    const found = listReports(db).find(report => report.reference === created.reference);
    assert.equal(found.title, input.title);
    assert.equal(found.description, input.description);
    assert.equal(found.isDemo, false);
  } finally { db.close(); fs.rmSync(temp.directory, { recursive: true, force: true }); }
});

test('server-side report validation accepts valid data and trims whitespace', () => {
  const result = validateReport({ title: '  Broken streetlight  ', category: 'Streetlights', location: '  Oak Street  ', description: '  The lamp is dark every evening.  ' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { title: 'Broken streetlight', category: 'Streetlights', location: 'Oak Street', description: 'The lamp is dark every evening.', impact: 'localized' });
  assert.equal(CATEGORIES.length, 6);
});

test('server-side report validation rejects missing, invalid and oversized fields', () => {
  const result = validateReport({ title: 'bad', category: 'Made up category', location: '', description: 'short' });
  assert.equal(result.valid, false);
  for (const field of ['title', 'category', 'location', 'description']) assert.ok(result.errors[field], `expected ${field} validation error`);
  const oversized = validateReport({ title: 'A'.repeat(101), category: 'Other', location: 'B'.repeat(161), description: 'C'.repeat(1001) });
  assert.equal(oversized.valid, false);
});

test('SQLite constraints reject invalid categories and statuses', () => {
  const temp = tempDbPath(); const db = createDatabase(temp.file);
  try {
    assert.throws(() => db.prepare(`INSERT INTO reports (reference,title,category,description,location,impact,priority,priority_reason,status,is_demo,created_at,updated_at) VALUES ('BAD-1','Invalid category report','Made up','This description is long enough.','Somewhere','localized','Medium','Legacy reason','submitted',0,?,?)`).run(new Date().toISOString(), new Date().toISOString()), /CHECK constraint failed/);
  } finally { db.close(); fs.rmSync(temp.directory, { recursive: true, force: true }); }
});

test('PORT parser accepts defaults and valid boundaries and rejects invalid values', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort('3001'), 3001);
  assert.equal(parsePort('1'), 1);
  assert.equal(parsePort('65535'), 65535);
  for (const invalid of ['abc', '3.5', '-1', '0', '65536', '1e3']) assert.throws(() => parsePort(invalid), /PORT must be an integer/);
});


test('status workflow permits only the documented forward transition', () => {
  assert.deepEqual(NEXT_STATUS, { submitted: 'under-review', 'under-review': 'in-progress', 'in-progress': 'resolved', resolved: null });
  assert.equal(STATUSES.length, 4);
  assert.equal(validateStatusTransition('submitted', 'under-review').valid, true);
  assert.equal(validateStatusTransition('under-review', 'in-progress').valid, true);
  assert.equal(validateStatusTransition('in-progress', 'resolved').valid, true);
  assert.equal(validateStatusTransition('submitted', 'resolved').valid, false);
  assert.equal(validateStatusTransition('resolved', 'in-progress').valid, false);
  assert.equal(validateStatusTransition('submitted', 'submitted').valid, false);
  assert.equal(validateStatusTransition('unknown', 'resolved').valid, false);
});

test('admin configuration requires a non-default-length password and strong session secret', () => {
  assert.equal(isAdminConfigured('', 'x'.repeat(40)), false);
  assert.equal(isAdminConfigured('short', 'x'.repeat(40)), false);
  assert.equal(isAdminConfigured('long-enough-admin-password', 'short-secret'), false);
  assert.equal(isAdminConfigured('long-enough-admin-password', 'x'.repeat(32)), true);
});

test('admin password comparison accepts only exact credentials', () => {
  assert.equal(safeStringEqual('right-password', 'right-password'), true);
  assert.equal(safeStringEqual('right-password', 'wrong-password'), false);
  assert.equal(safeStringEqual('', ''), true);
});

test('signed admin sessions validate signature, subject, and expiry', () => {
  const secret = 'unit-test-secret-that-is-long-enough-for-signing';
  const now = 2_000_000_000;
  const token = createSessionToken(secret, now);
  assert.equal(verifySessionToken(token, secret, now + 1), true);
  assert.equal(verifySessionToken(token, 'different-secret-that-is-also-long-enough', now + 1), false);
  assert.equal(verifySessionToken(`${token}tampered`, secret, now + 1), false);
  assert.equal(verifySessionToken(token, secret, now + SESSION_TTL_SECONDS), false);
  assert.equal(verifySessionToken('', secret, now), false);
});


test('conditional SQLite status updates persist and reject stale expected statuses', () => {
  const temp = tempDbPath();
  let db = createDatabase(temp.file);
  let report;
  try {
    report = listReports(db).find(item => item.status === 'submitted');
    assert.ok(report);
    const updated = updateReportStatus(db, report.id, 'submitted', 'under-review');
    assert.equal(updated.status, 'under-review');
    assert.equal(updateReportStatus(db, report.id, 'submitted', 'in-progress'), null);
  } finally { db.close(); }
  db = createDatabase(temp.file);
  try { assert.equal(getReportById(db, report.id).status, 'under-review'); }
  finally { db.close(); fs.rmSync(temp.directory, { recursive: true, force: true }); }
});

const { LoginRateLimiter } = require('../lib/login-rate-limiter');

test('login rate limiter counts failures and blocks on the fifth attempt for 15 minutes', () => {
  const limiter = new LoginRateLimiter(); const start = 1_000_000;
  for (let i = 1; i < 5; i++) assert.equal(limiter.recordFailure('addr-a', start + i).blocked, false);
  const fifth = limiter.recordFailure('addr-a', start + 5);
  assert.equal(fifth.blocked, true);
  assert.equal(fifth.retryAfterMs, 15 * 60 * 1000);
  assert.equal(limiter.status('addr-a', start + 6).blocked, true);
});

test('login limiter cleanup preserves active blocks and removes expired entries', () => {
  const limiter = new LoginRateLimiter({ windowMs: 1_000, maxFailures: 2, maxTrackedAddresses: 10 });
  limiter.recordFailure('active', 100);
  limiter.recordFailure('active', 101);
  limiter.recordFailure('ordinary', 100);
  limiter.cleanup(500);
  assert.equal(limiter.status('active', 500).blocked, true);
  assert.equal(limiter.entries.has('ordinary'), true);
  limiter.cleanup(1_102);
  assert.equal(limiter.entries.has('active'), false);
  assert.equal(limiter.entries.has('ordinary'), false);
});

test('login limiter storage remains bounded and fails closed at capacity', () => {
  const limiter = new LoginRateLimiter({ windowMs: 1_000, maxFailures: 2, maxTrackedAddresses: 3 });
  limiter.recordFailure('a', 10); limiter.recordFailure('b', 10); limiter.recordFailure('c', 10);
  const full = limiter.status('new-address', 11);
  assert.equal(full.blocked, true);
  assert.equal(full.capacityExceeded, true);
  assert.equal(limiter.size, 3);
  // Active blocks are not evicted to make room for a new address.
  limiter.recordFailure('a', 11);
  assert.equal(limiter.status('a', 12).blocked, true);
  assert.equal(limiter.size, 3);
});

test('expired login block is removed and next attempt starts a fresh count', () => {
  const limiter = new LoginRateLimiter({ windowMs: 100, maxFailures: 2, maxTrackedAddresses: 5 });
  limiter.recordFailure('addr', 1); limiter.recordFailure('addr', 2);
  assert.equal(limiter.status('addr', 103).blocked, false);
  assert.equal(limiter.entries.has('addr'), false);
  assert.equal(limiter.recordFailure('addr', 104).failures, 1);
});

test('successful login reset removes only that address entry', () => {
  const limiter = new LoginRateLimiter({ maxTrackedAddresses: 5 });
  limiter.recordFailure('good-address', 100); limiter.recordFailure('other-address', 100);
  limiter.reset('good-address');
  assert.equal(limiter.entries.has('good-address'), false);
  assert.equal(limiter.entries.has('other-address'), true);
});
