'use strict';

function parsePort(value) {
  if (value === undefined || value === null || value === '') return 3000;
  if (!/^\d+$/.test(String(value))) throw new Error('PORT must be an integer between 1 and 65535.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  return port;
}

module.exports = { parsePort };
