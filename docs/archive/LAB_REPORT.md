# Citadel at 103 Days: A Lab Report

*July 1, 2026*

I started Citadel on March 20, 2026 to answer one question: can a single person run an engineering organization made of coding agents, on top of runtimes that change under you every month?

One hundred and three days later the honest answer is yes, with caveats, and the caveats turned out to be more interesting than the yes. This is the report I wish someone had handed me before the first commit: real numbers from real telemetry, what worked, what the platforms absorbed, what died, and what I would tell anyone building on top of a moving AI runtime in 2026.

## The numbers

Everything here comes from the repo and from the `.planning/telemetry/` files the harness writes while it runs, measured July 1, 2026.

| Measure | Value |
|---|---|
| Days since first commit | 103 |
| Commits | 367 |
| Skills | 49 |
| Lifecycle hook scripts | 35, across 29 hook events |
| Test scripts in the suite | about 60 |
| Sessions tracked since April 30 | 329 |
| Recorded session time | about 2,400 hours |
| API-equivalent usage tracked | about $12,300 |
| Output tokens | 181.5M |
| Cache-read tokens | 21.2B |
| Tool calls audited | 12,233 |
| Abnormal subagent stops caught | 95 |
| Hook errors self-logged | 1,477 |

Two of these need honest framing. Two months of wall clock cannot contain 2,400 hours unless sessions overlap, and they do: parallel fleets and overnight loops are the point of the thing. And the dollar figure is the metered-price equivalent recorded by the cost hooks, not necessarily cash out the door; the harness tracks both a dollar view and a plan-window view because API users and subscription users experience cost differently, and pretending those are the same number is how a dashboard ends up lying.

One more number, because it is the most honest one here: 241 commits in March, 25 in April, 5 in May, 96 in June. May is what drift looks like in a solo project. June is what coming back looks like. I keep the graph because it remembers that stretch more accurately than I do.

## The problem

In early 2026, coding agents were strong at local reasoning and bad at being an organization. Every session re-learned the project from scratch. Long work died with the context window. Two agents in the same repo raced each other into a mess. Quality depended on whatever discipline survived in the prompt. And nobody could say what any of it cost.

Citadel is the operations layer I built around that: `/do` routes plain English to the lightest tool that can handle it, campaign state persists in repo-local `.planning/` files and survives context resets, parallel agents work in isolated git worktrees and share discoveries, lifecycle hooks enforce quality gates and file protection, and telemetry records behavior and spend. It runs on both Claude Code and OpenAI Codex, through the same file contracts.

## Eleven days in, the ground moved

On March 31, eleven days after the first commit, I wrote a pivot memo. It was already clear the runtime vendors would ship orchestration, memory, scheduling, and background agents natively, because those are the first features every power user asks for. Any project whose entire value is "drive the runtime better" is on a countdown clock.

So the bet changed: away from being a Claude Code add-on, toward the layer vendors have little incentive to own. State that lives in your repo instead of their cloud. Verification the vendor cannot see. Cost telemetry that spans runtimes. Rules that travel with the project, not the tool. That decision aged well. Most of what looked novel in my March feature list is table stakes in the runtimes now. The parts I moved to are still mine.

The transferable lesson: on a fast platform you rent features, but you own operations. Feature novelty decays in months. Operational knowledge compounds.

## What the telemetry taught me

**Phases longer than about 35 minutes fail differently, not just more often.** Industry data (Morph, 2026) put the failure increase at roughly 4x past that boundary, and it matched what I kept seeing: past 35 minutes the failure mode shifts from wrong code to lost the plot. Citadel now treats 35 minutes as a hard phase budget, with a verifiable exit condition per phase.

**Binary exit criteria are force multipliers on autonomy.** An agent negotiating with a vague goal will eventually declare victory. Typecheck, tests, build, a script that exits nonzero: pass/fail signals are what turn "run unattended" from a gamble into a plan.

**Agent instructions rot like code, so they need tests like code.** Stale or vague skill docs do not just underperform; they actively degrade the agent. This surprised me enough that I built a no-op detector that audits my own skill files for instructions that provably change nothing. Its calibration set currently holds 48 cases and the detector runs at 100% precision and recall against it. I expected to feel clever. Mostly I felt embarrassed by what it found.

**A safety net that can skip silently is worse than no safety net.** Every Citadel gate is required to report "did not run" as loudly as "failed". There are 1,477 hook errors in my own logs, and that number is the instrument working. The scary version of that table is a clean zero because nothing was actually checking.

**Parallel agents fail in weird ways, and the harness has to absorb it.** The audit log shows 95 abnormal subagent stops: agents that died mid-thought, hit limits, or wandered off. Work survives because state lives in files rather than in anyone's context window, and orchestrators receive distilled findings, never raw transcripts.

**Live proof beats demos, every time.** In June there was a popular question going around: what happens if you tell 15 agents to ship at once? The honest answer is a merge stampede. One PR lands, the other 14 go stale against the new mainline, rebase, wait for CI, and repeat until the queue drowns. The fix is not smarter agents; it is one steward owning a serialized landing lane while everyone else just produces PRs.

I built that steward. Then, instead of recording a demo, I pointed a proof script at a real, public GitHub repository: 15 agent PRs, 15 serial merges, 15 deploys, 14 branch updates, 59 CI wait cycles, 0 repair tasks. The proof repo and the script that generated it are public, and the same scenario runs as a regression test in CI. Building the proof harness took about as long as building the feature. It was worth more than the feature.

## What died or got parked

A companion relay service: parked, the distribution cost outran the value. The premium domain: never bought, because a name is not a moat and premium domain pricing is a trap for exactly the people most excited to ship. The original eight-milestone ladder: superseded after four milestones shipped, with the rest absorbed into release tracks instead of pretending the plan survived contact. And several March features the runtimes later shipped natively: I stopped maintaining those paths rather than competing with the platform on its own roadmap.

## What this was actually for

For a stretch I measured Citadel by harness metrics: stars, installs, feature parity with the runtimes. That framing made every platform release feel like a loss, and it is the wrong frame. A harness is an engine, and engines are means. The right measure is cargo: the things it ships.

The steward proof was the first real cargo, and it felt different immediately. A demonstration answers a question people are already asking. A feature list asks people to care. Next on that road: a public, reproducible benchmark page, bare agent versus harnessed on long tasks with methodology and scripts published, and products built by the agent organization where Citadel is simply the invisible operations layer underneath.

## If you are building on an AI platform in 2026

1. **Assume absorption.** Write down which of your features the vendor will ship within six months. Put your identity in the remainder: repo-local state, verification, cross-runtime operations, taste.
2. **Keep receipts.** Telemetry turns "trust me" into "here is the log". It also turns your own drift into data; my May shows up as five commits, and I am glad something wrote that down.
3. **Test your instructions like code.** Prompts and skills rot. Audit them mechanically.
4. **Buy autonomy with binary gates.** Every unattended hour needs a pass/fail signal at the end of it.
5. **Point the machine at something outside itself.** A harness improving itself is a treadmill. The meaning is in what it ships.

---

*The numbers regenerate from the repo: `git log` for commit history, `node scripts/generate-doc-surfaces.js` for skill and hook counts, `.planning/telemetry/*.jsonl` for sessions, cost, and audit events, and `node scripts/test-deploy-steward.js` plus `scripts/live-github-steward-proof.js` for the steward claims.*
