'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'civicfix_admin_session';
const SESSION_TTL_SECONDS = 4 * 60 * 60;

function isAdminConfigured(password, secret) {
  return typeof password === 'string' && password.length >= 12 &&
    typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32;
}

function safeStringEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b) && String(left) === String(right);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionToken(secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = Buffer.from(JSON.stringify({ sub: 'admin', exp: nowSeconds + SESSION_TTL_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = sign(parts[0], secret);
  const actualBuffer = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return payload.sub === 'admin' && Number.isInteger(payload.exp) && payload.exp > nowSeconds;
  } catch (_error) { return false; }
}

function readCookie(req, name = SESSION_COOKIE) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch (_error) { return ''; }
  }
  return '';
}

function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isAdminConfigured,
  safeStringEqual,
  createSessionToken,
  verifySessionToken,
  readCookie,
  sessionCookie,
  clearSessionCookie
};
