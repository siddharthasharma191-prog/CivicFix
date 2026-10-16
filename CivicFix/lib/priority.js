'use strict';

const IMPACTS = Object.freeze(['minor', 'localized', 'major_access', 'immediate_safety']);
const PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical']);
const IMPACT_LABELS = Object.freeze({
  minor: 'Minor inconvenience',
  localized: 'Localized disruption',
  major_access: 'Major access or essential service disruption',
  immediate_safety: 'Immediate safety hazard'
});

/** Deterministic rules based only on the impact explicitly selected by the reporter. */
function calculatePriority(impact) {
  if (!IMPACTS.includes(impact)) return { valid: false, error: 'Choose a valid reported impact.' };
  const rules = {
    minor: ['Low', 'The reporter selected minor inconvenience.'],
    localized: ['Medium', 'The reporter selected localized disruption.'],
    major_access: ['High', 'The reporter selected major access or essential service disruption.'],
    immediate_safety: ['Critical', 'The reporter explicitly selected immediate safety hazard; human review is required.']
  };
  const [priority, reason] = rules[impact];
  return { valid: true, impact, priority, reason };
}

module.exports = { IMPACTS, PRIORITIES, IMPACT_LABELS, calculatePriority };
