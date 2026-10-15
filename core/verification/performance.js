'use strict';

const TOKEN = Object.freeze({
  confirm: ['con', 'firm'].join(''),
  alert: ['al', 'ert'].join(''),
  prompt: ['pro', 'mpt'].join(''),
  transitionAll: ['transition', 'all'].join('-'),
});

function detectPerformance(file, content, builtInRules = ['no-confirm-alert', 'no-transition-all']) {
  const violations = [];

  if (builtInRules.includes('no-confirm-alert') && /\.(ts|tsx|js|jsx)$/.test(file)) {
    if (new RegExp(`\\b${TOKEN.confirm}\\s*\\(`).test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-confirm-alert', message: `Uses ${TOKEN.confirm}() — use an in-app modal` });
    }
    if (new RegExp(`\\b${TOKEN.alert}\\s*\\(`).test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-confirm-alert', message: `Uses ${TOKEN.alert}() — use an in-app notification` });
    }
  }

  if (builtInRules.includes('no-confirm-alert') && /\.(ts|tsx|js|jsx)$/.test(file)
      && new RegExp(`\\b${TOKEN.prompt}\\s*\\(`).test(content)) {
    violations.push({ file, lens: 'performance', rule: 'no-confirm-alert', message: `Uses ${TOKEN.prompt}() — use an in-app input` });
  }

  if (builtInRules.includes('no-transition-all') && /\.(ts|tsx|js|jsx|css|scss)$/.test(file)) {
    // A standalone class token, so rule IDs such as no-transition-all do not match.
    if (new RegExp(`(?<![\\w-])${TOKEN.transitionAll}(?![\\w-])`).test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-transition-all', message: `Uses ${TOKEN.transitionAll} — name specific properties (e.g., transition-[opacity,transform])` });
    }
  }

  if (builtInRules.includes('no-magic-intervals') && /\.(ts|tsx|js|jsx)$/.test(file)) {
    if (/setInterval\s*\([^,]+,\s*\d+\s*\)/.test(content)) {
      violations.push({ file, lens: 'performance', rule: 'no-magic-intervals', message: 'Hardcoded setInterval — use a named constant for the interval' });
    }
  }

  return violations;
}

module.exports = { detectPerformance };
