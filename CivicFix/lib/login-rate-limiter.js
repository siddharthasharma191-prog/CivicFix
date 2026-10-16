'use strict';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_MAX_TRACKED_ADDRESSES = 10_000;

/**
 * Single-process login throttling with bounded storage.
 * When capacity is full and no expired unblocked entry can be reclaimed,
 * unknown addresses fail closed until an entry expires or is reset.
 */
class LoginRateLimiter {
  constructor({ windowMs = DEFAULT_WINDOW_MS, maxFailures = DEFAULT_MAX_FAILURES, maxTrackedAddresses = DEFAULT_MAX_TRACKED_ADDRESSES } = {}) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be a positive integer');
    if (!Number.isSafeInteger(maxFailures) || maxFailures <= 0) throw new TypeError('maxFailures must be a positive integer');
    if (!Number.isSafeInteger(maxTrackedAddresses) || maxTrackedAddresses <= 0) throw new TypeError('maxTrackedAddresses must be a positive integer');
    this.windowMs = windowMs;
    this.maxFailures = maxFailures;
    this.maxTrackedAddresses = maxTrackedAddresses;
    this.entries = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      // Never remove a currently active block. Unblocked entries age out after the window.
      if (entry.blockedUntil > now) continue;
      if (entry.blockedUntil !== 0 || now - entry.lastFailureAt >= this.windowMs) this.entries.delete(key);
    }
  }

  status(key, now = Date.now()) {
    this.cleanup(now);
    const entry = this.entries.get(key);
    if (entry && entry.blockedUntil > now) return { blocked: true, capacityExceeded: false, retryAfterMs: entry.blockedUntil - now };
    if (!entry && this.entries.size >= this.maxTrackedAddresses) {
      return { blocked: true, capacityExceeded: true, retryAfterMs: this.windowMs };
    }
    return { blocked: false, capacityExceeded: false, retryAfterMs: 0 };
  }

  recordFailure(key, now = Date.now()) {
    this.cleanup(now);
    const existing = this.entries.get(key);
    if (existing && existing.blockedUntil > now) {
      return { blocked: true, failures: existing.failures, retryAfterMs: existing.blockedUntil - now };
    }
    if (!existing && this.entries.size >= this.maxTrackedAddresses) {
      return { blocked: true, capacityExceeded: true, failures: 0, retryAfterMs: this.windowMs };
    }
    const failures = (existing?.failures || 0) + 1;
    const blockedUntil = failures >= this.maxFailures ? now + this.windowMs : 0;
    this.entries.set(key, { failures, blockedUntil, lastFailureAt: now });
    return { blocked: blockedUntil > now, capacityExceeded: false, failures, retryAfterMs: Math.max(0, blockedUntil - now) };
  }

  reset(key) {
    this.entries.delete(key);
  }

  get size() { return this.entries.size; }
}

module.exports = { LoginRateLimiter, DEFAULT_WINDOW_MS, DEFAULT_MAX_FAILURES, DEFAULT_MAX_TRACKED_ADDRESSES };
