# Citadel independent product-proof trial

Citadel 1.1 needs evidence from people who did not build it. This protocol collects only the
minimum aggregate facts needed to test first value, dashboard comprehension, benchmark selection,
and return use. Do not post prompts, repository names, paths, command output, emails, or other
personal/project data.

Recruitment and public evidence live in [GitHub Discussion #182](https://github.com/SethGammon/Citadel/discussions/182).
Because 1.1 is still a release candidate, use the exact branch and installer instructions in that
discussion rather than installing from `main`.

## Who qualifies

- A first-time Citadel user who is not the maintainer and did not contribute to the trial tooling.
- An external benchmark reviewer may also participate, but must choose the scenario before any
  actual benchmark trial begins.
- Use a disposable or non-sensitive repository. Never expose employer or client material.

## Trial steps

1. Start a timer before following the current README install path.
2. Run `/do setup --express`, then route one real, safe task through `/do`.
3. Stop the first timer when the task is routed. Stop the handoff timer when its verification and
   HANDOFF are visible.
4. Open `citadel dashboard`. Within 60 seconds, identify the active goal, current phase, blocked
   item, and next action. Record only how many of those four were correct, not the answer text.
5. Comment on [the recruitment discussion](https://github.com/SethGammon/Citadel/discussions/182)
   using the JSON template below. Use a random opaque ID;
   do not use your username, email, or repository name in the record.
6. If you voluntarily use Citadel for a second real task at least 24 hours later and within 14
   days, edit or reply to your comment with `second_task_at`. No task content is requested.

## Participant record

```json
{"schema":1,"kind":"participant_trial","participant_id":"participant-0123abcd","evidence_url":"REPLACE_WITH_FINAL_COMMENT_URL","started_at":"2026-07-12T00:00:00.000Z","first_route_ms":0,"handoff_ms":0,"dashboard_explanation_ms":0,"dashboard_fields_correct":0,"install_success":false,"setup_success":false,"routed_task_success":false,"handoff_verified":false,"consent_aggregate":true,"second_task_at":null}
```

Post the record first with a placeholder evidence URL, then edit it once GitHub assigns the final
`#discussioncomment-...` URL. Failures are valuable and must remain in the cohort.

## External benchmark selection

Before actual benchmark runs, one independent reviewer posts exactly one selection record. The
`scenario_id` must exist in `benchmarks/product-proof-scenarios.json`, and `runner_commit` must be
the full frozen commit SHA.

```json
{"schema":1,"kind":"benchmark_selection","reviewer_id":"reviewer-0123abcd","evidence_url":"REPLACE_WITH_FINAL_COMMENT_URL","selected_at":"2026-07-12T00:00:00.000Z","scenario_id":"REPLACE_WITH_SCENARIO_ID","runner_commit":"REPLACE_WITH_40_CHARACTER_SHA"}
```

## Maintainer aggregation

Copy only the final JSON objects into an ignored local JSONL file, one record per line:

```bash
node scripts/product-proof-cohort.js --input .planning/product-proof/cohort.jsonl --json
node scripts/product-proof-cohort.js --input .planning/product-proof/cohort.jsonl --require-complete
```

The completion command fails closed until all gates pass: external selection before trials, ten
unique participants, at least 95% verified completion, median first route under 10 minutes, p90
verified handoff under 15 minutes, at least 8/10 complete dashboard explanations in 60 seconds,
and five second-task users within 14 days.
