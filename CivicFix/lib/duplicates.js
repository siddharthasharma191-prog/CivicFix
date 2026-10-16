'use strict';

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
    : '';
}

function tokens(value) {
  return new Set(normalizeText(value).split(' ').filter(token => token.length >= 3));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function compareReports(candidate, existing) {
  const categoryMatch = normalizeText(candidate.category) === normalizeText(existing.category);
  const candidateLocation = normalizeText(candidate.location);
  const existingLocation = normalizeText(existing.location);
  const locationMatch = Boolean(candidateLocation && existingLocation) && (
    candidateLocation === existingLocation || jaccard(tokens(candidateLocation), tokens(existingLocation)) >= 0.8
  );
  const candidateText = `${candidate.title || ''} ${candidate.description || ''}`;
  const existingText = `${existing.title || ''} ${existing.description || ''}`;
  const candidateTokens = tokens(candidateText);
  const existingTokens = tokens(existingText);
  const sharedTokenCount = [...candidateTokens].filter(token => existingTokens.has(token)).length;
  const textSimilarity = jaccard(candidateTokens, existingTokens);
  // Require at least two distinct shared terms as well as the ratio threshold; one generic word is insufficient.
  const isCandidate = categoryMatch && locationMatch && sharedTokenCount >= 2 && textSimilarity >= 0.35;
  if (!isCandidate) return null;
  const reasons = [];
  if (categoryMatch) reasons.push('same category');
  if (candidateLocation === existingLocation) reasons.push('same normalized location');
  else reasons.push('very similar location');
  reasons.push('similar title/description wording');
  return {
    id: existing.id,
    reference: existing.reference,
    title: existing.title,
    category: existing.category,
    location: existing.location,
    status: existing.status,
    isDemo: Boolean(existing.isDemo),
    similarity: Number(textSimilarity.toFixed(2)),
    sharedTerms: sharedTokenCount,
    reason: reasons.join('; ')
  };
}

function findDuplicateCandidates(candidate, reports, { limit = 5 } = {}) {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(reports)) return [];
  const found = reports.map(report => compareReports(candidate, report)).filter(Boolean);
  found.sort((a, b) => b.similarity - a.similarity || a.reference.localeCompare(b.reference));
  return found.slice(0, Math.max(0, Math.min(10, Number.isSafeInteger(limit) ? limit : 5)));
}

module.exports = { normalizeText, jaccard, compareReports, findDuplicateCandidates };
