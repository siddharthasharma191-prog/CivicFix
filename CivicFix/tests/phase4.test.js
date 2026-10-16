'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { calculatePriority, IMPACTS, PRIORITIES } = require('../lib/priority');
const { findDuplicateCandidates, normalizeText } = require('../lib/duplicates');
const { validateReport } = require('../lib/validation');
const { createDatabase, listReports, insertReport, updateReportStatus } = require('../lib/database');

function tempDb() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civicfix-phase4-')); return { dir, file: path.join(dir, 'db.sqlite') }; }

test('priority rules map each explicitly reported impact to a documented priority and reason', () => {
  assert.deepEqual(PRIORITIES, ['Low', 'Medium', 'High', 'Critical']);
  const expected = { minor: 'Low', localized: 'Medium', major_access: 'High', immediate_safety: 'Critical' };
  for (const impact of IMPACTS) { const result = calculatePriority(impact); assert.equal(result.valid, true); assert.equal(result.priority, expected[impact]); assert.ok(result.reason.length > 10); }
  assert.match(calculatePriority('immediate_safety').reason, /human review/i);
});

test('priority rejects invalid impact and does not infer Critical from arbitrary text', () => {
  assert.equal(calculatePriority('critical keyword in description').valid, false);
  const validation = validateReport({ title: 'Critical pothole wording', category: 'Roads & potholes', location: 'Main Road', description: 'The word critical appears but no impact was selected.' });
  assert.equal(validation.valid, true); assert.equal(calculatePriority(validation.value.impact).priority, 'Medium');
  assert.equal(validateReport({ title: 'Valid title here', category: 'Other', location: 'Main Road', description: 'This description is sufficiently long.', impact: 'invented' }).valid, false);
});

test('duplicate normalization handles case, whitespace, punctuation and Unicode normalization', () => {
  assert.equal(normalizeText('  OAK   STREET, Block-2  '), 'oak street block 2');
  assert.equal(normalizeText('Café'), normalizeText('Cafe\u0301'));
  assert.equal(normalizeText(null), '');
});

test('duplicate candidates require category, strong location and substantive text similarity', () => {
  const existing = [
    { id: 1, reference: 'CF-000001', title: 'Deep pothole near bus stop', category: 'Roads & potholes', location: 'Oak Street Block 2', description: 'A deep pothole is damaging vehicles near the bus stop.', status: 'submitted', isDemo: false },
    { id: 2, reference: 'CF-000002', title: 'Overflowing bin', category: 'Waste management', location: 'Oak Street Block 2', description: 'Waste collection has been missed for several days.', status: 'in-progress', isDemo: true },
    { id: 3, reference: 'CF-000003', title: 'Broken lamp', category: 'Roads & potholes', location: 'Faraway Avenue', description: 'The lamp is broken at this distant location.', status: 'submitted', isDemo: false }
  ];
  const candidate = { title: 'Pothole near the bus stop', category: 'Roads & potholes', location: ' OAK street   block 2 ', description: 'A deep pothole is damaging cars by the bus stop.' };
  const matches = findDuplicateCandidates(candidate, existing);
  assert.equal(matches.length, 1); assert.equal(matches[0].reference, 'CF-000001'); assert.match(matches[0].reason, /same category/); assert.equal(matches[0].isDemo, false);
  assert.deepEqual(findDuplicateCandidates({ ...candidate, location: '' }, existing), []);
  assert.deepEqual(findDuplicateCandidates(candidate, []), []);
});

test('duplicate matching requires at least two distinct shared terms, not one common word', () => {
  const existing = [{ id: 1, reference: 'CF-000001', title: 'Pothole near crossing', category: 'Roads & potholes', location: 'Oak Street Block 2', description: 'Pothole near the pedestrian crossing is damaging vehicles.', status: 'submitted', isDemo: false }];
  const oneSharedWord = { title: 'Pothole problem', category: 'Roads & potholes', location: 'Oak Street Block 2', description: 'Pothole pothole pothole.' };
  assert.deepEqual(findDuplicateCandidates(oneSharedWord, existing), []);

  const genuinelySimilar = { title: 'Pothole near crossing', category: 'Roads & potholes', location: 'Oak Street Block 2', description: 'Pothole near the pedestrian crossing is damaging vehicles.' };
  const matches = findDuplicateCandidates(genuinelySimilar, existing);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].sharedTerms >= 2);
});

test('priority is calculated by server and persisted with reason; status update refreshes updatedAt', () => {
  const temp = tempDb(); const db = createDatabase(temp.file);
  try {
    const report = insertReport(db, { title: 'Damaged access ramp', category: 'Public safety', location: 'Civic Hall Entrance', description: 'The ramp is blocked and wheelchair access is disrupted.', impact: 'major_access', priority: 'Low' });
    assert.equal(report.priority, 'High'); assert.match(report.priorityReason, /major access/i); assert.equal(report.impact, 'major_access');
    const updated = updateReportStatus(db, report.id, 'submitted', 'under-review');
    assert.equal(updated.status, 'under-review'); assert.ok(updated.updatedAt); assert.equal(updateReportStatus(db, report.id, 'submitted', 'in-progress'), null);
  } finally { db.close(); fs.rmSync(temp.dir, { recursive: true, force: true }); }
});

test('repeatable migration preserves Phase 3 records and does not reseed nonempty databases', () => {
  const temp = tempDb(); const { DatabaseSync } = require('node:sqlite');
  let old = new DatabaseSync(temp.file);
  old.exec(`CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 100), category TEXT NOT NULL CHECK(category IN ('Roads & potholes','Waste management','Streetlights','Drainage','Public safety','Other')), description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 1000), location TEXT NOT NULL CHECK(length(location) BETWEEN 3 AND 160), priority TEXT NOT NULL CHECK(priority IN ('Low','Medium','High')), status TEXT NOT NULL CHECK(status IN ('submitted','under-review','in-progress','resolved')), is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)), created_at TEXT NOT NULL);
    INSERT INTO reports(reference,title,category,description,location,priority,status,is_demo,created_at) VALUES ('KEEP-1','Existing report title','Other','Existing report description.','Existing Street','Medium','submitted',0,'2026-01-01T00:00:00.000Z');`);
  old.close();
  let db = createDatabase(temp.file);
  try { const reports = listReports(db); assert.equal(reports.length, 1); assert.equal(reports[0].reference, 'KEEP-1'); assert.equal(reports[0].priority, 'Medium'); assert.equal(reports[0].updatedAt, reports[0].createdAt); assert.match(reports[0].priorityReason, /retained during migration/); }
  finally { db.close(); }
  db = createDatabase(temp.file);
  try { assert.equal(listReports(db).length, 1); }
  finally { db.close(); fs.rmSync(temp.dir, { recursive: true, force: true }); }
});

test('frontend renders priority explanations and human-review duplicate suggestions with safe text APIs', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="report-impact"/); assert.match(html, /id="duplicate-candidates"/); assert.match(html, /Possible similar reports|duplicate/i);
  assert.match(app, /priorityReason/); assert.match(app, /createElement\('li'\)/); assert.match(app, /item\.textContent =/); assert.doesNotMatch(app, /innerHTML\s*=/);
});
