'use strict';
const { IMPACTS } = require('./priority');
const CATEGORIES = Object.freeze(['Roads & potholes','Waste management','Streetlights','Drainage','Public safety','Other']);
function normalizeText(value) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }
function validateReport(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const title = normalizeText(body.title), category = normalizeText(body.category), location = normalizeText(body.location);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const impact = normalizeText(body.impact) || 'localized';
  const errors = {};
  if (title.length < 5 || title.length > 100) errors.title = 'Title must be between 5 and 100 characters.';
  if (!CATEGORIES.includes(category)) errors.category = 'Choose a valid civic issue category.';
  if (location.length < 3 || location.length > 160) errors.location = 'Location must be between 3 and 160 characters.';
  if (description.length < 10 || description.length > 1000) errors.description = 'Description must be between 10 and 1,000 characters.';
  if (!IMPACTS.includes(impact)) errors.impact = 'Choose a valid reported impact.';
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, value: { title, category, location, description, impact } };
}
module.exports = { CATEGORIES, validateReport };
