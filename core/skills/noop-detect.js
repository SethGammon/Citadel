'use strict';

/**
 * noop-detect.js - Static no-op detector for SKILL.md instructions.
 *
 * A "no-op" is an instruction aimed at the agent's own disposition or effort
 * that carries no specific, checkable criterion. Per Pocock's test: delete the
 * line and the agent's behavior does not change ("be thorough", "make it
 * high-quality", "write clean code"). Agents already attempt these by default,
 * so the line burns tokens and dilutes the load-bearing instructions around it.
 *
 * This is Tier 1 of the no-op pipeline: a cheap, deterministic, no-LLM
 * heuristic that produces CANDIDATES, not verdicts. It is calibrated and
 * regression-tested against core/skills/noop-calibration.json by
 * scripts/test-noop-detect.js. Tier 2 (LLM judge) and Tier 3 (ablation)
 * adjudicate the candidates this layer surfaces.
 *
 * Design rule, in priority order, for whether a line is a candidate:
 *   1. It must contain a no-op vocabulary hit (disposition/effort filler).
 *   2. It must have NO concrete anchor (inline code, file path, command,
 *      numeric threshold, or a `site:` search example). An anchor means the
 *      line carries a checkable instruction despite the filler word.
 *   3. It must NOT be a fringe guard (if/when/missing/unavailable/gracefully/
 *      fallback). This is the most important exemption: a false positive here
 *      would flag a real safeguard for deletion. We bias hard toward keeping
 *      guards.
 *   4. It must NOT be a rubric/example label (PASS:, e.g., a search query).
 *
 * The detector flags at LINE granularity. A line may be wholly inert (delete)
 * or load-bearing with a trimmable adverb (trim); distinguishing those two is
 * the judge's job, not this layer's.
 */

// ── No-op vocabulary ──────────────────────────────────────────────────────────
// Disposition/effort words and unmeasurable-quality adjectives. A hit here is
// necessary but not sufficient to flag (anchors and guards can still exempt).
const NOOP_VOCAB = [
  /\bbe thorough\b/i,
  /\bthorough(?:ly|ness)?\b/i,
  /\bbe careful\b/i,
  /\bcareful(?:ly)?\b/i,
  /\btake care\b/i,
  /\bpay attention\b/i,
  /\b(?:keep|bear) in mind\b/i,
  /\bmake sure\b/i,
  /\bbe sure to\b/i,
  /\bensure (?:you|that|the|to|all|it|your)\b/i,
  /\bhigh[- ]quality\b/i,
  /\btop[- ]quality\b/i,
  /\bproduction[- ](?:grade|ready|quality)\b/i,
  /\benterprise[- ]grade\b/i,
  /\bworld[- ]class\b/i,
  /\bbest practices\b/i,
  /\bindustry standards?\b/i,
  /\bcomprehensive(?:ly)?\b/i,
  /\bexhaustive(?:ly)?\b/i,
  /\brobust(?:ness)?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bsmooth(?:ly)?\b/i,
  /\bintuitive(?:ly)?\b/i,
  /\bproperly\b/i,
  /\bcorrectly\b/i,
  /\bappropriately\b/i,
  /\bmaintainable\b/i,
  /\bwell[- ](?:structured|documented|organized|designed|written)\b/i,
  /\bclean and\b/i,
  /\beasy to (?:read|follow|understand|maintain|use|navigate|reason about)\b/i,
  /\bvery detailed\b/i,
  /\b(?:make|keep|write|produce)\b[^.;:]*\bdetailed\b/i,
  /\bremember to\b/i,
  /\bdon'?t forget to\b/i,
  /\bit'?s important\b/i,
  /\bstrive to\b/i,
  /\baim to\b/i,
  /\b(?:try|do) your best\b/i,
  /\bmake every effort\b/i,
  /\bas \w+ as possible\b/i,
];

// ── Anchors ───────────────────────────────────────────────────────────────────
// Concrete, checkable elements. Their presence exempts a vocab hit: the line
// carries a real instruction, so the filler word is incidental.
const ANCHOR_INLINE_CODE = /`[^`]+`/;
const ANCHOR_FILE = /\b[\w./@-]+\.(?:js|ts|tsx|jsx|mjs|cjs|md|json|jsonl|css|scss|html|sh|ya?ml|toml|png|svg|lock)\b/i;
const ANCHOR_DOTFILE = /(?:^|\s)\.(?:env|gitignore|planning|claude|citadel)\b/i;
// Note: `make` is intentionally excluded - it collides with the imperative
// verb "Make" / "make sure" / "make it" that opens many no-op sentences.
// Makefile commands appear as `make build` in backticks, caught by the inline-
// code anchor instead.
const ANCHOR_COMMAND = /\b(?:node|npm|npx|git|gh|curl|pnpm|yarn|docker|tsc|bash)\s+[\w.-]/i;
const ANCHOR_NUMERIC = /\b\d+(?:\.\d+)?\+?\s*(?:lines?|minutes?|min|words?|ms|seconds?|sec|%|percent|chars?|characters?|px|tests?|bullets?|sessions?|releases?|days?|hours?|kb|mb|x|files?|phases?|agents?|sources?|queries|questions|results?|steps?|iterations?|attempts?|rounds?|candidates?|scenarios?|examples?)\b/i;
const ANCHOR_SITE = /\bsite:/i;

// ── Negation / anti-example ───────────────────────────────────────────────────
// A vocab hit cited under a negation is the OPPOSITE of an instruction:
// `(not "be more careful")`, `not exhaustive - focused`. We exempt a hit when a
// negation/contrast token appears shortly before it.
const NEGATION_BEFORE = /\b(?:not|never|avoid|avoids?|without|rather than|instead of|isn'?t|aren'?t|don'?t|do not|doesn'?t|no longer)\b/i;
const NEGATION_WINDOW = 24; // chars before the hit to scan for a negation

// ── Fringe-guard signals ──────────────────────────────────────────────────────
// Markers of a missing/absent/error condition the agent must handle. Lines
// matching these are safeguards and are NEVER flagged. Note: the noun "error"
// alone is intentionally excluded (it is usually the object being read, not a
// condition), while "fail/fails/failing/failure" ARE conditions.
const GUARD_ABSENCE = /\b(?:missing|absent|unavailable|not (?:found|installed|available|present|running|configured|set|authenticated)|doesn'?t exist|does not exist|don'?t exist|fall ?back|fallback|gracefully|treat (?:it |them )?as empty|fail(?:s|ing|ure)?\b)\b/i;
const GUARD_CONDITIONAL = /\b(?:if|when|unless|once|whenever|without)\b/i;
const GUARD_ABSENT_NOUN = /\bno\s+(?:\.?\w+|longer)\b/i; // "no UI", "no .planning", "no longer"

// ── Rubric / example labels ───────────────────────────────────────────────────
const RUBRIC_LABEL = /^(?:pass|fail|warn|info|skip|good|bad|ok|note|example|todo)\b\s*[:\-]/i;
const EXAMPLE_MARKER = /\b(?:e\.g\.|i\.e\.|for example|such as)\b/i;

/**
 * Normalize a raw line: strip leading list/heading markers and surrounding
 * emphasis, collapse whitespace. Inline-code content is preserved so anchor
 * detection can see it.
 */
function normalizeLine(raw) {
  let t = String(raw);
  t = t.replace(/^\s*>+\s*/, '');             // blockquote
  t = t.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''); // list marker
  t = t.replace(/^\s*#{1,6}\s+/, '');          // heading
  t = t.replace(/\*\*(.*?)\*\*/g, '$1');        // bold
  t = t.replace(/(^|\s)\*(?=\S)(.*?)\*/g, '$1$2'); // italic (leave bullets alone)
  return t.trim();
}

function countAnchors(text) {
  let n = 0;
  if (ANCHOR_INLINE_CODE.test(text)) n++;
  if (ANCHOR_FILE.test(text)) n++;
  if (ANCHOR_DOTFILE.test(text)) n++;
  if (ANCHOR_COMMAND.test(text)) n++;
  if (ANCHOR_NUMERIC.test(text)) n++;
  if (ANCHOR_SITE.test(text)) n++;
  return n;
}

function isFringeGuard(text) {
  if (GUARD_ABSENCE.test(text)) return true;
  if (GUARD_ABSENT_NOUN.test(text)) return true;
  // A bare conditional only counts as a guard when paired with a negation -
  // "if not", "when ... n't" - so plain "when you run X" is not exempted.
  if (GUARD_CONDITIONAL.test(text) && /\bnot\b|n'?t\b/i.test(text)) return true;
  return false;
}

function isRubricOrExample(text) {
  if (RUBRIC_LABEL.test(text)) return true;
  // An example marker plus a quoted string is an illustration, not an order.
  if (EXAMPLE_MARKER.test(text) && /["'`]/.test(text)) return true;
  return false;
}

/**
 * Match no-op vocabulary, returning only "live" hits - those NOT cited under a
 * negation. A line where every hit is negated carries no disposition directive.
 */
function matchVocab(text) {
  const hits = [];
  for (const re of NOOP_VOCAB) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const gre = new RegExp(re.source, flags);
    let m;
    while ((m = gre.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - NEGATION_WINDOW), m.index);
      if (!NEGATION_BEFORE.test(before)) hits.push(m[0].trim());
      if (m.index === gre.lastIndex) gre.lastIndex++; // avoid zero-width loop
    }
  }
  return hits;
}

/**
 * Analyze a single line of instruction prose.
 * @param {string} raw
 * @returns {{
 *   text: string, noopHits: string[], anchors: number, fringeGuard: boolean,
 *   rubric: boolean, isCandidate: boolean, suspicion: number, reason: string
 * }}
 */
function analyzeLine(raw) {
  const text = normalizeLine(raw);
  const empty = {
    text, noopHits: [], anchors: 0, fringeGuard: false, rubric: false,
    isCandidate: false, suspicion: 0, reason: 'empty',
  };
  if (!text) return empty;

  const noopHits = matchVocab(text);
  if (noopHits.length === 0) {
    return { ...empty, reason: 'no no-op vocabulary' };
  }

  const anchors = countAnchors(text);
  const fringeGuard = isFringeGuard(text);
  const rubric = isRubricOrExample(text);

  let isCandidate = true;
  let reason = `no-op vocabulary: ${noopHits.join(', ')}`;
  if (anchors > 0) { isCandidate = false; reason = `exempt: ${anchors} concrete anchor(s)`; }
  else if (fringeGuard) { isCandidate = false; reason = 'exempt: fringe-case guard'; }
  else if (rubric) { isCandidate = false; reason = 'exempt: rubric/example label'; }

  return {
    text,
    noopHits,
    anchors,
    fringeGuard,
    rubric,
    isCandidate,
    suspicion: isCandidate ? noopHits.length : 0,
    reason,
  };
}

/**
 * Strip the YAML frontmatter block from a SKILL.md body.
 */
function stripFrontmatter(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : content;
}

/**
 * Scan a full SKILL.md body for no-op candidates. Skips fenced code blocks,
 * headings, table rows, and blank lines.
 * @param {string} content - full SKILL.md text (frontmatter stripped internally)
 * @returns {Array<{lineNo:number, text:string, noopHits:string[], suspicion:number, reason:string}>}
 */
function detectNoOps(content) {
  const body = stripFrontmatter(content);
  const lines = body.split(/\r?\n/);
  const candidates = [];
  let inFence = false;
  // Frontmatter was stripped, but the line numbers we report should map to the
  // original file. Count how many lines the frontmatter occupied.
  const fmOffset = content.length === body.length
    ? 0
    : content.slice(0, content.length - body.length).split(/\r?\n/).length - 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(?:```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;        // heading
    if (/^\|.*\|$/.test(trimmed)) continue;          // table row
    if (/^[-=|:\s]+$/.test(trimmed)) continue;       // table divider / hr

    const analysis = analyzeLine(line);
    if (analysis.isCandidate) {
      candidates.push({
        lineNo: fmOffset + i + 1,
        text: analysis.text,
        noopHits: analysis.noopHits,
        suspicion: analysis.suspicion,
        reason: analysis.reason,
      });
    }
  }
  return candidates;
}

module.exports = {
  analyzeLine,
  detectNoOps,
  stripFrontmatter,
  normalizeLine,
  NOOP_VOCAB,
};
