'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { calculatePriority, PRIORITIES } = require('./priority');
const { CATEGORIES } = require('./validation');
const { STATUSES } = require('./status');

const DEMO_REPORTS = Object.freeze([
  { title: 'Large pothole near Central Park', location: 'Maple Avenue, Block 04', category: 'Roads & potholes', priority: 'High', status: 'in-progress', reference: 'CX-1042', description: 'Fictional demonstration report.', createdAt: '2026-10-14T12:00:00.000Z', impact: 'major_access', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Overflowing public waste bin', location: 'Market Square, Zone 2', category: 'Waste management', priority: 'Medium', status: 'under-review', reference: 'CX-1041', description: 'Fictional demonstration report.', createdAt: '2026-10-14T10:00:00.000Z', impact: 'localized', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Streetlight not working', location: 'Oak Street, Junction 8', category: 'Streetlights', priority: 'Medium', status: 'submitted', reference: 'CX-1040', description: 'Fictional demonstration report.', createdAt: '2026-10-13T10:00:00.000Z', impact: 'localized', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Blocked storm drain after rainfall', location: 'Riverside Lane, Sector 1', category: 'Drainage', priority: 'High', status: 'in-progress', reference: 'CX-1039', description: 'Fictional demonstration report.', createdAt: '2026-10-12T10:00:00.000Z', impact: 'major_access', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Damaged bench in public park', location: 'Rose Garden, East Walk', category: 'Public safety', priority: 'Low', status: 'resolved', reference: 'CX-1038', description: 'Fictional demonstration report.', createdAt: '2026-10-11T10:00:00.000Z', impact: 'minor', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Uneven pavement near bus stop', location: 'Station Road, Stop 12', category: 'Roads & potholes', priority: 'Medium', status: 'under-review', reference: 'CX-1037', description: 'Fictional demonstration report.', createdAt: '2026-10-10T10:00:00.000Z', impact: 'localized', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Missed waste collection', location: 'Greenfield Lane, Block 7', category: 'Waste management', priority: 'Low', status: 'submitted', reference: 'CX-1036', description: 'Fictional demonstration report.', createdAt: '2026-10-09T10:00:00.000Z', impact: 'minor', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Flickering streetlamp', location: 'Willow Crescent, Pole 19', category: 'Streetlights', priority: 'Low', status: 'resolved', reference: 'CX-1035', description: 'Fictional demonstration report.', createdAt: '2026-10-08T10:00:00.000Z', impact: 'minor', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Water pooling on footpath', location: 'Lakeview Drive, North End', category: 'Drainage', priority: 'Medium', status: 'in-progress', reference: 'CX-1034', description: 'Fictional demonstration report.', createdAt: '2026-10-07T10:00:00.000Z', impact: 'localized', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Faded pedestrian crossing markings', location: 'School Road, Main Gate', category: 'Other', priority: 'Medium', status: 'submitted', reference: 'CX-1033', description: 'Fictional demonstration report.', createdAt: '2026-10-06T10:00:00.000Z', impact: 'localized', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Loose paving stones', location: 'Civic Square, West Walk', category: 'Roads & potholes', priority: 'Low', status: 'resolved', reference: 'CX-1032', description: 'Fictional demonstration report.', createdAt: '2026-10-05T10:00:00.000Z', impact: 'minor', priorityReason: 'Fictional seed priority retained for demonstration.' },
  { title: 'Damaged public notice board', location: 'Library Corner, District 3', category: 'Public safety', priority: 'Low', status: 'under-review', reference: 'CX-1031', description: 'Fictional demonstration report.', createdAt: '2026-10-04T10:00:00.000Z', impact: 'minor', priorityReason: 'Fictional seed priority retained for demonstration.' }
]);

const TABLE_SQL = `CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 100),
  category TEXT NOT NULL CHECK(category IN ('Roads & potholes','Waste management','Streetlights','Drainage','Public safety','Other')),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 1000),
  location TEXT NOT NULL CHECK(length(location) BETWEEN 3 AND 160),
  impact TEXT NOT NULL DEFAULT 'localized' CHECK(impact IN ('minor','localized','major_access','immediate_safety')),
  priority TEXT NOT NULL CHECK(priority IN ('Low','Medium','High','Critical')),
  priority_reason TEXT NOT NULL DEFAULT 'Existing priority retained during migration; not recalculated automatically.',
  status TEXT NOT NULL CHECK(status IN ('submitted','under-review','in-progress','resolved')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const SELECT_COLUMNS = 'id, reference, title, category, description, location, impact, priority, priority_reason, status, is_demo, created_at, updated_at';

function ensureSchema(db) {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reports'").get();
  if (!existing) {
    db.exec(TABLE_SQL);
  } else if (!existing.sql.includes("'Critical'")) {
    // Rebuild the old Phase 2/3 table transactionally to expand the priority CHECK and add tracking fields.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(TABLE_SQL.replace('CREATE TABLE reports', 'CREATE TABLE reports_phase4_new'));
      const columns = new Set(db.prepare('PRAGMA table_info(reports)').all().map(column => column.name));
      const impactExpr = columns.has('impact') ? "COALESCE(impact, 'localized')" : "'localized'";
      const reasonExpr = columns.has('priority_reason') ? "COALESCE(priority_reason, 'Existing priority retained during migration; not recalculated automatically.')" : "'Existing priority retained during migration; not recalculated automatically.'";
      const updatedExpr = columns.has('updated_at') ? 'COALESCE(updated_at, created_at)' : 'created_at';
      db.exec(`INSERT INTO reports_phase4_new (id, reference, title, category, description, location, impact, priority, priority_reason, status, is_demo, created_at, updated_at)
        SELECT id, reference, title, category, description, location, ${impactExpr}, priority, ${reasonExpr}, status, is_demo, created_at, ${updatedExpr} FROM reports`);
      db.exec('DROP TABLE reports');
      db.exec('ALTER TABLE reports_phase4_new RENAME TO reports');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } else {
    const columns = new Set(db.prepare('PRAGMA table_info(reports)').all().map(column => column.name));
    if (!columns.has('impact')) db.exec("ALTER TABLE reports ADD COLUMN impact TEXT NOT NULL DEFAULT 'localized' CHECK(impact IN ('minor','localized','major_access','immediate_safety'))");
    if (!columns.has('priority_reason')) db.exec("ALTER TABLE reports ADD COLUMN priority_reason TEXT NOT NULL DEFAULT 'Existing priority retained during migration; not recalculated automatically.'");
    if (!columns.has('updated_at')) db.exec("ALTER TABLE reports ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE reports SET updated_at = created_at WHERE updated_at = ''");
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_priority ON reports(priority);
    CREATE INDEX IF NOT EXISTS idx_reports_updated_at ON reports(updated_at DESC);`);
}

function createDatabase(databasePath = process.env.CIVICFIX_DB_PATH || path.join(__dirname, '..', 'data', 'civicfix.sqlite')) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  ensureSchema(db);
  const existing = db.prepare('SELECT COUNT(*) AS count FROM reports').get();
  if (existing.count === 0) {
    const insert = db.prepare(`INSERT INTO reports (reference,title,category,description,location,impact,priority,priority_reason,status,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.exec('BEGIN');
    try {
      for (const report of DEMO_REPORTS) insert.run(report.reference, report.title, report.category, report.description, report.location, report.impact, report.priority, report.priorityReason, report.status, 1, report.createdAt, report.createdAt);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  return db;
}

function publicReport(row) {
  return { id: row.id, reference: row.reference, title: row.title, category: row.category, description: row.description, location: row.location, impact: row.impact, priority: row.priority, priorityReason: row.priority_reason, status: row.status, isDemo: Boolean(row.is_demo), createdAt: row.created_at, updatedAt: row.updated_at };
}
function listReports(db) { return db.prepare(`SELECT ${SELECT_COLUMNS} FROM reports ORDER BY is_demo DESC, created_at DESC, id DESC`).all().map(publicReport); }
/** Return aggregate counts only; no report text, references, locations, or identities are exposed. */
function getAnalytics(db) {
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM reports').get().count);
  const groupCounts = column => db.prepare(`SELECT ${column} AS label, COUNT(*) AS count FROM reports GROUP BY ${column}`).all();
  const toDistribution = (labels, records) => {
    const counts = new Map(records.map(record => [record.label, Number(record.count)]));
    const result = labels.map(label => ({ label, count: counts.get(label) || 0 }));
    const known = new Set(labels);
    const unknownCount = records.reduce((sum, record) => sum + (known.has(record.label) ? 0 : Number(record.count)), 0);
    if (unknownCount > 0) result.push({ label: 'Other / unknown', count: unknownCount });
    return result;
  };
  return {
    total,
    statuses: toDistribution(STATUSES, groupCounts('status')),
    categories: toDistribution(CATEGORIES, groupCounts('category')),
    priorities: toDistribution(PRIORITIES, groupCounts('priority'))
  };
}
function getReportById(db, id) { const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM reports WHERE id = ?`).get(id); return row ? publicReport(row) : null; }
function updateReportStatus(db, id, expectedStatus, nextStatus) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(nextStatus, now, id, expectedStatus);
  if (Number(result.changes) !== 1) return null;
  return getReportById(db, id);
}
function insertReport(db, report) {
  const createdAt = new Date().toISOString();
  const impact = report.impact || 'localized';
  const priority = calculatePriority(impact);
  if (!priority.valid) throw new TypeError('A validated report impact is required');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`INSERT INTO reports (reference,title,category,description,location,impact,priority,priority_reason,status,is_demo,created_at,updated_at) VALUES ('PENDING',?,?,?,?,?,?,?,'submitted',0,?,?)`).run(report.title, report.category, report.description, report.location, impact, priority.priority, priority.reason, createdAt, createdAt);
    const id = Number(result.lastInsertRowid);
    const reference = `CF-${String(id).padStart(6, '0')}`;
    db.prepare('UPDATE reports SET reference = ? WHERE id = ?').run(reference, id);
    const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM reports WHERE id = ?`).get(id);
    db.exec('COMMIT');
    return publicReport(row);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { DEMO_REPORTS, createDatabase, insertReport, listReports, getReportById, updateReportStatus, getAnalytics, ensureSchema };
