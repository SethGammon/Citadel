---
name: cost
description: >-
  Deep cost exploration and transparency. Shows real token usage, session costs,
  campaign spend, burn rates, and model breakdown. Reads Claude Code's native
  session data for exact numbers. Complements /dashboard with focused cost views.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-30
---

# /cost -- Session & Campaign Cost Explorer

## Identity

/cost gives you the full cost picture. It reads real token data from Claude
Code's session files and combines it with Citadel's campaign attribution to
answer: how much did this cost, where did the money go, and is it worth it?

## When to Use

- `/cost` -- current session cost and burn rate
- `/cost today` -- today's total spend
- `/cost week` -- this week's spend
- `/cost campaign {slug}` -- total spend for a specific campaign
- `/cost all` -- lifetime cost summary
- When /do routes "how much", "what's the cost", "spending", "tokens", "burn rate"

## Inputs

Optional arguments parsed from user message:
- `today` -- filter to today's sessions
- `week` -- filter to last 7 days
- `campaign {slug}` -- filter to a specific campaign
- `all` -- show all-time data
- No argument -- show current session

## Protocol

### Step 1: READ REAL DATA

Run the session-tokens.js script to get real token data:

```bash
node scripts/session-tokens.js              # current/latest session
node scripts/session-tokens.js --today      # today's sessions
node scripts/session-tokens.js --all        # all sessions (use for week/all/campaign)
```

Also read:
- `.planning/telemetry/cost-tracker-state.json` for live burn rate
- `.planning/telemetry/session-costs.jsonl` for campaign attribution
- `scripts/pricing.json` to show which pricing is being used

If `session-tokens.js` is not available or fails, fall back to session-costs.jsonl
data and clearly mark output as "(estimated)".

### Step 2: RENDER BASED ON SCOPE

**Current session (`/cost` with no args):**

```
=== Session Cost Report ===
Session: {sessionId (first 8 chars)}
Started: {relative time} ({absolute time})
Duration: {minutes} min

Tokens:
  Input:          {N} tokens
  Output:         {N} tokens
  Cache creation: {N} tokens
  Cache read:     {N} tokens
  Total:          {N} tokens

Cost: ${total}
Burn rate: ${rate}/min
Messages: {N} ({N} main + {N} across {N} subagents)

Model breakdown:
  claude-opus-4-6:         {N} messages (${cost}, {pct}% of spend)
  claude-haiku-4-5:        {N} messages (${cost}, {pct}% of spend)

Cache efficiency: {pct}% of input tokens served from cache
  (Higher = more cost-efficient. Cache reads cost 10x less than fresh input.)

Pricing source: scripts/pricing.json (version {version})
```

**Today / Week / All (`/cost today`, `/cost week`, `/cost all`):**

```
=== Cost Report: {Today / This Week / All Time} ===

Summary:
  Sessions: {N}
  Total cost: ${total}
  Subagents spawned: {N}
  Total messages: {N}

Top 5 sessions by cost:
  ${cost}  {duration}min  {agents} agents  {msgs} msgs  {date}
  ${cost}  {duration}min  {agents} agents  {msgs} msgs  {date}
  ...

By campaign (from session-costs.jsonl):
  {slug}: ${cost} across {N} sessions
  _unattached: ${cost} across {N} sessions

Average session: ${avg_cost} | ${avg_rate}/min | {avg_duration} min

For historical charts and billing-window views: npx ccusage
```

**Campaign (`/cost campaign {slug}`):**

```
=== Campaign Cost: {slug} ===

Total: ${cost} across {N} sessions ({N} agents, {N} min)
Average session: ${avg}

Sessions:
  {date}: ${cost} ({duration} min, {agents} agents, {msgs} msgs)
  {date}: ${cost} ({duration} min, {agents} agents, {msgs} msgs)
  ...
```

### Step 3: ADD CONTEXT

After the cost data, add one of these contextual lines based on the numbers:

- If burn rate > $2/min: "Burn rate is high. Consider whether subagent-heavy work
  could be restructured into smaller focused sessions."
- If cache hit rate < 50%: "Low cache hit rate. Long conversations with many tool
  results tend to have lower cache efficiency."
- If no real data available: "Cost data is estimated. Real token data becomes
  available when sessions complete and Claude Code writes session JSONL files."
- Otherwise: no extra context needed.

### Step 4: FRINGE CASES

**If scripts/session-tokens.js does not exist:**
Fall back to session-costs.jsonl data. Show estimated costs with "(est)" marker.

**If no session data exists:**
```
No session data found. Cost tracking requires Claude Code session files
at ~/.claude/projects/. These are created automatically by Claude Code.
```

**If pricing.json is missing or unreadable:**
Use hardcoded pricing in session-tokens.js. Note: "Using built-in pricing (pricing.json not found)."

**If user asks about Pro/Max subscription costs:**
```
Note: Pro/Max subscribers pay a flat monthly fee, not per-token.
The token counts shown here represent your usage volume, not billing.
For rate limit awareness, token throughput matters more than dollar cost.
```

## Fringe Cases

- **Telemetry directory missing**: `.planning/telemetry/` does not exist — output: "No telemetry data found. Run any skill first to generate session data, then re-run /cost."
- **Malformed telemetry JSON**: a `session-*.json` file fails to parse — output: "Telemetry file is corrupted. Delete `.planning/telemetry/session-*.json` and re-run the skill that generated it." Skip the bad file and continue with the rest.
- **MCP cost API returns no data**: Claude Code is not tracking this session — output: "Session cost unavailable from MCP. Check that Claude Code is running with cost tracking enabled. Showing telemetry file data only." Fall back to session-costs.jsonl.
- **All session files are from a different project**: project paths in the files do not match the current working directory — warn: "Session files found belong to a different project. You may be in the wrong directory." List the project paths found in the session files.

## Quality Gates

- Always show real data when available, estimated when not
- Always label data source: (real) vs (est)
- Never claim specific dollar savings from Citadel -- show raw hook facts instead
- Suggest ccusage for features we don't replicate (charts, billing windows)
- Round costs to 2 decimal places, tokens to nearest K/M
- Total output must fit on one screen for current-session view

## Exit Protocol

/cost does not produce a HANDOFF block. It is a read-only cost exploration tool.
After displaying the report, wait for the next user command.
