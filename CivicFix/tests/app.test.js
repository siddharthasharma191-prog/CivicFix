'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let runtimeDependencyIssue = '';
try { require.resolve('express'); require.resolve('helmet'); }
catch (error) { runtimeDependencyIssue = `Express/Helmet integration blocked: ${error.code || error.message}`; }
const runtimeTestOptions = runtimeDependencyIssue ? { skip: runtimeDependencyIssue } : {};

async function withTestServer(run, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'civicfix-http-'));
  const { createApp } = require('../server');
  const app = createApp({ ...options, databasePath: path.join(directory, 'http.sqlite') });
  const server = app.listen(0, '127.0.0.1');
  try { await new Promise(resolve => server.once('listening', resolve)); await run(`http://127.0.0.1:${server.address().port}`, app); }
  finally {
    await new Promise(resolve => server.close(resolve));
    app.locals.closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('health endpoint returns Phase 5 status and security headers', runtimeTestOptions, async () => withTestServer(async base => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'civicfix', phase: 5, database: 'sqlite' });
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.ok(response.headers.get('x-content-type-options'));
  assert.ok(response.headers.get('content-security-policy'));
}));

test('unknown API routes return a JSON 404', runtimeTestOptions, async () => withTestServer(async base => {
  const response = await fetch(`${base}/api/no-such-route`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { error: 'API endpoint not found' });
}));

test('home page and CSS are served and unknown pages return HTML 404', runtimeTestOptions, async () => withTestServer(async base => {
  const home = await fetch(`${base}/`); assert.equal(home.status, 200); assert.match(await home.text(), /CivicFix — Civic Operations/);
  const css = await fetch(`${base}/styles.css`); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  const missing = await fetch(`${base}/this-page-does-not-exist`); assert.equal(missing.status, 404); assert.match(await missing.text(), /Page not found|This path isn't on the map/);
}));

test('GET /api/reports returns fictional seed reports', runtimeTestOptions, async () => withTestServer(async base => {
  const response = await fetch(`${base}/api/reports`); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.reports.length, 12); assert.ok(payload.reports.every(report => report.isDemo));
}));

test('POST /api/reports validates, creates, and returns a persistent report', runtimeTestOptions, async () => withTestServer(async (base, app) => {
  const report = { title: 'Pothole by the community hall', category: 'Roads & potholes', location: 'Community Hall Road', description: 'A large pothole is causing trouble for cyclists.' };
  const response = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
  assert.equal(response.status, 201);
  const payload = await response.json(); assert.match(payload.report.reference, /^CF-\d{6}$/); assert.equal(payload.report.isDemo, false);
  const list = await (await fetch(`${base}/api/reports`)).json(); assert.ok(list.reports.some(item => item.reference === payload.report.reference));
}));

test('POST /api/reports rejects invalid input and malformed JSON safely', runtimeTestOptions, async () => withTestServer(async base => {
  const invalid = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'bad', category: 'unknown', location: '', description: 'tiny' }) });
  assert.equal(invalid.status, 400); assert.deepEqual(Object.keys((await invalid.json()).details).sort(), ['category', 'description', 'location', 'title']);
  const malformed = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'Malformed JSON request body' });
}));

test('dashboard clearly discloses fictional data and local-only reporting', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /Fictional sample reports/); assert.match(html, /No real civic authority or reporting service is connected/);
  assert.match(html, /stored in the local SQLite database/); assert.match(html, /Not a government service/);
  assert.match(html, /pothole/i); assert.match(html, /waste/i); assert.match(html, /streetlight/i); assert.match(html, /drain/i);
  for (const field of ['report-title', 'report-category', 'report-location', 'report-description']) assert.match(html, new RegExp(`id="${field}"`));
});

test('frontend search and status/category filtering updates visible rows', () => {
  const el = ({value='', dataset={}, textContent='', hidden=false}={}) => ({value,dataset,textContent,hidden,listeners:{},addEventListener(type,fn){this.listeners[type]=fn},focus(){},scrollIntoView(){},classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){}});
  const search = el({value:'pothole'}), status = el({value:'all'}), category = el({value:'all'}), empty = el({hidden:true}), count = el(), toast=el({hidden:true});
  const rows = [el({dataset:{status:'in-progress',category:'Roads & potholes',search:'large pothole maple avenue'},textContent:'Large pothole CX-1042'}),el({dataset:{status:'resolved',category:'Streetlights',search:'streetlight oak street'},textContent:'Streetlight CX-1035'})];
  const elements = {'#report-search':search,'#status-filter':status,'#category-filter':category,'#empty-state':empty,'#result-count':count,'#toast':toast,'#clear-filters':el(),'.banner-dismiss':el(),'.prototype-banner':el(),'#help-button':el(),'#category-info':el(),'#export-hint':el(),'#issue-tracker':el(),'#report-rows':{}};
  const nav = [el()]; nav[0].getAttribute=()=> '#overview'; nav[0].classList={add(){},remove(){}};
  const context = {document:{querySelector:selector=>elements[selector],querySelectorAll:selector=>selector==='#report-rows tr'?rows:selector==='.nav-link'?nav:[]},window:{},console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/app.js'),'utf8'),context);
  assert.equal(rows[0].hidden,false); assert.equal(rows[1].hidden,true); assert.match(count.textContent,/1 of 2/);
  search.value=''; status.value='resolved'; status.listeners.change(); assert.equal(rows[0].hidden,true); assert.equal(rows[1].hidden,false);
  category.value='Drainage'; category.listeners.change(); assert.equal(rows[1].hidden,true); assert.equal(empty.hidden,false); assert.match(count.textContent,/0 of 2/);
});

test('navigation, accessibility and security configuration are present', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const label of ['Overview','Issue Tracker','Report an Issue','Community Insights']) assert.ok(html.includes(label), `missing ${label}`);
  assert.match(html, /skip-link/); assert.match(html, /aria-live/); assert.match(html, /<label/); assert.match(css, /focus-visible/); assert.match(css, /max-width:760px/); assert.match(server, /helmet/); assert.match(server, /process\.env\.PORT/); assert.match(server, /express\.json/);
});


const TEST_ADMIN_PASSWORD = 'test-admin-password-123';
const TEST_SESSION_SECRET = 'test-session-secret-which-is-at-least-32-bytes';
const adminOptions = { adminPassword: TEST_ADMIN_PASSWORD, sessionSecret: TEST_SESSION_SECRET, secureCookies: false };

async function signIn(base) {
  const response = await fetch(`${base}/api/admin/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ password: TEST_ADMIN_PASSWORD })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';', 1)[0];
}

test('admin reports API rejects unauthenticated requests', runtimeTestOptions, async () => withTestServer(async base => {
  const response = await fetch(`${base}/api/admin/reports`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Administrator authentication required' });
}, adminOptions));

test('admin sign-in checks origin and credentials and issues a protected session cookie', runtimeTestOptions, async () => withTestServer(async base => {
  const noOrigin = await fetch(`${base}/api/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }) });
  assert.equal(noOrigin.status, 403);
  const wrong = await fetch(`${base}/api/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ password: 'incorrect-password' }) });
  assert.equal(wrong.status, 401);
  const correct = await fetch(`${base}/api/admin/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }) });
  assert.equal(correct.status, 200);
  const cookie = correct.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=14400/);
}, adminOptions));

test('admin status endpoint requires same-origin request and a valid session', runtimeTestOptions, async () => withTestServer(async base => {
  const reports = await (await fetch(`${base}/api/reports`)).json();
  const report = reports.reports.find(item => item.status === 'submitted');
  const noOrigin = await fetch(`${base}/api/admin/reports/${report.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'under-review' }) });
  assert.equal(noOrigin.status, 403);
  const unauthenticated = await fetch(`${base}/api/admin/reports/${report.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ status: 'under-review' }) });
  assert.equal(unauthenticated.status, 401);
}, adminOptions));

test('admin status endpoint rejects skipped or backward status transitions', runtimeTestOptions, async () => withTestServer(async base => {
  const cookie = await signIn(base);
  const payload = await (await fetch(`${base}/api/reports`)).json();
  const report = payload.reports.find(item => item.status === 'submitted');
  const response = await fetch(`${base}/api/admin/reports/${report.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify({ status: 'resolved' }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Invalid status transition');
}, adminOptions));

test('admin status endpoint advances a report and persists the new status', runtimeTestOptions, async () => withTestServer(async base => {
  const cookie = await signIn(base);
  const payload = await (await fetch(`${base}/api/reports`)).json();
  const report = payload.reports.find(item => item.status === 'submitted');
  const response = await fetch(`${base}/api/admin/reports/${report.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify({ status: 'under-review' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).report.status, 'under-review');
  const stored = await (await fetch(`${base}/api/reports`)).json();
  assert.equal(stored.reports.find(item => item.id === report.id).status, 'under-review');
}, adminOptions));

test('admin status endpoint rejects malformed JSON with a safe client error', runtimeTestOptions, async () => withTestServer(async base => {
  const cookie = await signIn(base);
  const payload = await (await fetch(`${base}/api/reports`)).json();
  const report = payload.reports.find(item => item.status === 'submitted');
  const response = await fetch(`${base}/api/admin/reports/${report.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: '{bad' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Malformed JSON request body' });
}, adminOptions));


test('dashboard fallback replaces rather than appends, labels demo rows, and uses accurate result counts', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.match(html, /id="result-count" aria-live="polite">Showing 12 of 12 reports/);
  assert.match(app, /reportBody\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(app, /reportBody\.appendChild\(fragment\)/);
  assert.match(app, /report\.isDemo === true/);
  assert.match(app, /demo\.textContent = 'DEMO'/);
  assert.match(app, /Showing \$\{visible\} of \$\{rows\.length\} reports/);
  assert.match(app, /The built-in fictional sample rows remain visible/);
});


test('POST /api/reports calculates priority server-side and returns review-only duplicate candidates', runtimeTestOptions, async () => withTestServer(async base => {
  const body = { title: 'Deep pothole beside bus stop', category: 'Roads & potholes', location: 'Maple Avenue, Block 04', description: 'A deep pothole is damaging cars near the bus stop and needs attention.', impact: 'major_access', priority: 'Low' };
  const response = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.report.priority, 'High');
  assert.match(result.report.priorityReason, /major access/i);
  assert.ok(Array.isArray(result.duplicateCandidates));
  assert.equal(result.report.reference.startsWith('CF-'), true);
  assert.equal(result.report.isDemo, false);
}));

test('POST /api/reports rejects invalid impact selection', runtimeTestOptions, async () => withTestServer(async base => {
  const response = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Valid report title', category: 'Other', location: 'Civic Square', description: 'A sufficiently detailed report description.', impact: 'made-up' }) });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).details.impact);
}));


test('public analytics endpoint returns aggregate counts without report details', runtimeTestOptions, async () => withTestServer(async base => {
  const response = await fetch(`${base}/api/analytics`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.source, 'stored-reports');
  assert.equal(payload.total, 12);
  assert.equal(payload.statuses.reduce((sum, item) => sum + item.count, 0), 12);
  assert.equal(payload.categories.reduce((sum, item) => sum + item.count, 0), 12);
  assert.equal(payload.priorities.reduce((sum, item) => sum + item.count, 0), 12);
  assert.equal(Object.hasOwn(payload, 'reports'), false);
  assert.equal(Object.hasOwn(payload, 'locations'), false);
}));

test('analytics endpoint returns zero counts for an empty stored dataset', runtimeTestOptions, async () => withTestServer(async (base, app) => {
  app.locals.db.exec('DELETE FROM reports');
  const response = await fetch(`${base}/api/analytics`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.total, 0);
  assert.ok([...payload.statuses, ...payload.categories, ...payload.priorities].every(item => item.count === 0));
}));
