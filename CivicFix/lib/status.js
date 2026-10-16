'use strict';

const STATUSES = Object.freeze(['submitted', 'under-review', 'in-progress', 'resolved']);
const NEXT_STATUS = Object.freeze({
  submitted: 'under-review',
  'under-review': 'in-progress',
  'in-progress': 'resolved',
  resolved: null
});

function validateStatusTransition(currentStatus, nextStatus) {
  if (!STATUSES.includes(nextStatus)) {
    return { valid: false, reason: 'Choose a valid report status.' };
  }
  if (!STATUSES.includes(currentStatus)) {
    return { valid: false, reason: 'The report has an unsupported current status.' };
  }
  if (NEXT_STATUS[currentStatus] !== nextStatus) {
    return { valid: false, reason: `Status can only move from ${currentStatus} to ${NEXT_STATUS[currentStatus] || 'no further status'}.` };
  }
  return { valid: true };
}

module.exports = { STATUSES, NEXT_STATUS, validateStatusTransition };
