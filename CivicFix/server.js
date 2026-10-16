'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createDatabase, insertReport, listReports, getReportById, updateReportStatus, getAnalytics } = require('./lib/database');
const { validateReport } = require('./lib/validation');
const { calculatePriority, IMPACTS, PRIORITIES } = require('./lib/priority');
const { findDuplicateCandidates } = require('./lib/duplicates');
const { STATUSES, validateStatusTransition } = require('./lib/status');
const {
  isAdminConfigured, safeStringEqual, createSessionToken, verifySessionToken,
  readCookie, sessionCookie, clearSessionCookie
} = require('./lib/admin-auth');
const { parsePort } = require('./lib/port');
const { LoginRateLimiter } = require('./lib/login-rate-limiter');


function createApp(options = {}) {
  const app = express();
  const db = options.db || createDatabase(options.databasePath);
  const adminPassword = options.adminPassword ?? process.env.CIVICFIX_ADMIN_PASSWORD ?? '';
  const sessionSecret = options.sessionSecret ?? process.env.CIVICFIX_SESSION_SECRET ?? '';
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const loginRateLimiter = options.loginRateLimiter || new LoginRateLimiter();
  app.locals.db = db;
  app.locals.loginRateLimiter = loginRateLimiter;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"] } } }));
  app.use(express.json({ limit: '20kb', strict: true }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  function isConfigured() { return isAdminConfigured(adminPassword, sessionSecret); }
  function isSameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return false;
    let expectedOrigin = process.env.CIVICFIX_PUBLIC_ORIGIN;
    if (!expectedOrigin) expectedOrigin = `${req.protocol}://${req.get('host') || ''}`;
    try { return new URL(origin).origin === new URL(expectedOrigin).origin && origin === new URL(origin).origin; }
    catch (_error) { return false; }
  }
  function requireSameOrigin(req, res, next) {
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified' });
    return next();
  }
  function isAuthenticated(req) {
    if (!isConfigured()) return false;
    return verifySessionToken(readCookie(req), sessionSecret);
  }
  function requireAdmin(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (!isConfigured()) return res.status(503).json({ error: 'Administrative access is not configured' });
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Administrator authentication required' });
    return next();
  }
  function rateLimitKey(req) { return req.socket?.remoteAddress || 'unknown'; }

  app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'civicfix', phase: 5, database: 'sqlite' }));
  // Public aggregate-only analytics: counts contain no report text, references, or locations.
  app.get('/api/analytics', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.status(200).json({ source: 'stored-reports', generatedAt: new Date().toISOString(), ...getAnalytics(db) }); }
    catch (error) { return next(error); }
  });
  app.get('/api/reports', (_req, res, next) => {
    try { return res.status(200).json({ reports: listReports(db), priorities: PRIORITIES, impacts: IMPACTS }); }
    catch (error) { return next(error); }
  });
  app.post('/api/reports', (req, res, next) => {
    const validation = validateReport(req.body);
    if (!validation.valid) return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    try {
      const existingReports = listReports(db);
      const duplicateCandidates = findDuplicateCandidates(validation.value, existingReports);
      const report = insertReport(db, validation.value);
      return res.status(201).json({ report, priority: calculatePriority(validation.value.impact), duplicateCandidates, duplicateNotice: duplicateCandidates.length ? 'Possible matches only. Review them manually; this report was saved and was not rejected.' : null });
    }
    catch (error) { return next(error); }
  });

  app.get('/api/admin/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ configured: isConfigured(), authenticated: isAuthenticated(req) });
  });
  app.post('/api/admin/session', requireSameOrigin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isConfigured()) return res.status(503).json({ error: 'Administrative access is not configured. Set CIVICFIX_ADMIN_PASSWORD and CIVICFIX_SESSION_SECRET.' });
    const key = rateLimitKey(req);
    const limit = loginRateLimiter.status(key);
    if (limit.blocked) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
      return res.status(429).json({ error: limit.capacityExceeded ? 'Sign-in temporarily unavailable due to rate-limit capacity. Try again later.' : 'Too many failed sign-in attempts. Try again later.' });
    }
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!safeStringEqual(password, adminPassword)) {
      const attempt = loginRateLimiter.recordFailure(key);
      if (attempt.blocked) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(attempt.retryAfterMs / 1000))));
        return res.status(429).json({ error: attempt.capacityExceeded ? 'Sign-in temporarily unavailable due to rate-limit capacity. Try again later.' : 'Too many failed sign-in attempts. Try again later.' });
      }
      return res.status(401).json({ error: 'Invalid administrator credentials' });
    }
    loginRateLimiter.reset(key);
    res.set('Set-Cookie', sessionCookie(createSessionToken(sessionSecret), secureCookies));
    return res.status(200).json({ authenticated: true, expiresInSeconds: 14400 });
  });
  app.delete('/api/admin/session', requireSameOrigin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Set-Cookie', clearSessionCookie(secureCookies));
    return res.status(200).json({ authenticated: false });
  });
  app.get('/api/admin/reports', requireAdmin, (_req, res, next) => {
    try { return res.status(200).json({ reports: listReports(db), allowedStatuses: STATUSES, priorities: PRIORITIES }); }
    catch (error) { return next(error); }
  });
  app.patch('/api/admin/reports/:id/status', requireSameOrigin, requireAdmin, (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Report ID must be a positive integer' });
    const report = getReportById(db, id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const requestedStatus = req.body && typeof req.body.status === 'string' ? req.body.status : '';
    const transition = validateStatusTransition(report.status, requestedStatus);
    if (!transition.valid) return res.status(409).json({ error: 'Invalid status transition', details: transition.reason });
    try {
      const updated = updateReportStatus(db, id, report.status, requestedStatus);
      if (!updated) return res.status(409).json({ error: 'Report status changed concurrently; reload and try again' });
      return res.status(200).json({ report: updated });
    } catch (error) { return next(error); }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), err => { if (err && !res.headersSent) res.status(404).type('text').send('Page not found'); });
  });
  app.use((error, req, res, _next) => {
    if (req.path.startsWith('/api')) {
      if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) return res.status(400).json({ error: 'Malformed JSON request body' });
      if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
      console.error('CivicFix API error:', error.message);
      return res.status(500).json({ error: 'The request could not be completed' });
    }
    return res.status(500).type('text').send('An unexpected server error occurred.');
  });
  app.locals.closeDatabase = () => db.close();
  return app;
}

function startServer() {
  const port = parsePort(process.env.PORT);
  const app = createApp();
  const server = app.listen(port, '0.0.0.0', () => console.log(`CivicFix Phase 5 listening on port ${port}`));
  server.on('error', error => {
    console.error(`CivicFix could not start: ${error.message}`);
    app.locals.closeDatabase();
    process.exitCode = 1;
  });
  const shutdown = () => server.close(() => { app.locals.closeDatabase(); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  try { startServer(); }
  catch (error) { console.error(`CivicFix startup failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { createApp, parsePort, startServer };
