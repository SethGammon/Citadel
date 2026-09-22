'use strict';

const LEGACY_PACKAGE_NAMES = new Set([
  'package',
  'review',
  'package for review',
  'review package',
  'delivery package',
]);

function phaseLabel(phase) {
  return `phase ${phase.number ?? '?'} (${phase.name || phase.type || 'unnamed'})`;
}

function selectPackagePhase(phases = []) {
  const typed = phases.filter(
    (phase) => String(phase.type || '').trim().toLowerCase() === 'package',
  );
  if (typed.length > 1) {
    throw new Error(`Campaign declares multiple package phases: ${typed.map(phaseLabel).join(', ')}`);
  }
  if (typed.length === 1) return typed[0];

  const legacy = phases.filter((phase) =>
    LEGACY_PACKAGE_NAMES.has(String(phase.name || '').trim().toLowerCase()));
  if (legacy.length > 1) {
    throw new Error(`Campaign has multiple legacy package phase candidates: ${legacy.map(phaseLabel).join(', ')}`);
  }
  return legacy[0] || null;
}

module.exports = Object.freeze({
  LEGACY_PACKAGE_NAMES,
  selectPackagePhase,
});
