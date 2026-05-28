# LLM Wiki Live Docs Proof

Status: local proof complete, pending push/PR/merge/live GitHub Pages verification.

## Scope

Citadel already had the `skills/wiki/SKILL.md` implementation for the LLM-native markdown wiki, but the public demo surface did not expose `/wiki` in the Skills panel and did not route `llm wiki` phrasing to `/wiki` in the live demo router.

This slice makes the LLM Wiki visible and routable in the shipped Citadel docs site.

## Product Contract

- The public docs/demo lists `/wiki` in the Skills panel with a concise LLM Wiki description.
- The live demo router maps `wiki`, `llm wiki`, `knowledge base`, `project wiki`, `knowledge management`, and `karpathy wiki` phrasing to `/wiki` at Tier 2.
- The quickstart/docs copy reports the current 45 installed skills count.
- The existing `skills/wiki/SKILL.md` remains lint-clean.

## Proof Run

```bash
node scripts/test-all.js
```

Result: all checks pass. Key coverage:

- Skill lint: `wiki` passes; 45 skills clean.
- Demo routing check: 45 checks pass, including the new `build an llm wiki` -> `/wiki` regression.
- Hook, security, runtime, installer, campaign, discovery, policy, bootstrap, backward compatibility, and cost-tracker checks all pass.

```bash
node scripts/test-demo.js
```

Result: 45 checks pass, 0 fail.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --dump-dom file:///Users/wilhorneff/Projects/Citadel/docs/index.html | rg -n "LLM-native markdown knowledge base|/wiki|Skills - 45 installed"
```

Rendered DOM proof found the Skills panel title, `/wiki`, the LLM Wiki description, and the `/wiki` router rule in the browser-rendered page.

## Live Verification Required After Merge

After PR merge and GitHub Pages deployment, verify:

```bash
curl -fsSL https://sethgammon.github.io/Citadel/ | rg -n "LLM-native markdown knowledge base|/wiki|Skills . 45 installed"
```

Then check the latest `pages-build-deployment` workflow run for success.

## False-Done Guard

False completion would be the skill existing only in `skills/wiki/SKILL.md` while the public site still hides it or routes `llm wiki` to another tool. The demo route regression and rendered DOM proof catch that failure mode.
