# GitHub delivery and interest evidence

Observed on 2026-08-03 after pull request 245 merged to `main`. This record
separates public repository history, maintainer attribution, and owner-visible
traffic. None of these measures is a user, installation, retention, revenue, or
economic-impact count.

## Public repository record

| Measure | Observed value | Provenance |
|---|---:|---|
| Repository created | 2026-03-20 | GitHub repository API and first commit `6c043814f403ab34fac16ac81f5d37233b84358b` |
| Public age at observation | 136 days | Calendar difference through 2026-08-03 |
| Stars | 809 | GitHub repository API |
| Forks | 80 | GitHub repository API |
| Commits reachable from `main` | 542 | `git rev-list --count origin/main` |
| Commits attributed to Seth's Git identity | 518 | `git rev-list --count --author=gammon.seth@gmail.com origin/main` |
| Non-merge commits attributed to Seth's Git identity | 377 | `git rev-list --count --no-merges --author=gammon.seth@gmail.com origin/main` |

Git author attribution establishes repository history and delivery ownership;
it does not prove that every line was typed manually or without AI assistance.
The repository contains outside contributions and automated dependency work,
which remain credited to their recorded authors.

## Owner-visible 14-day traffic

GitHub's owner traffic endpoints reported the window from 2026-07-18 through
2026-07-31:

| Measure | Total | Unique |
|---|---:|---:|
| Repository clones | 1,237 | 524 |
| Repository views | 933 | 380 |

The traffic endpoints are visible to the repository owner and are not
independently queryable by a public reviewer. Automated tools may contribute to
clone traffic. The safe outward wording is **unique cloners in GitHub's latest
14-day window**, never installs, users, adoption, or successful setup.

## Shipped substrate

The current public package reports 49 workflows and 35 hook scripts across 29
lifecycle events. It includes Claude Code, Codex, Ollama, and Sentient ROMA
paths; Windows, Linux, and macOS verification; signed operation evidence; and
offline reconstruction. Those product facts remain subject to their named
repository tests and claim boundaries.

## Refresh commands

Run immediately before submission:

```powershell
gh repo view SethGammon/Citadel --json createdAt,stargazerCount,forkCount
gh api repos/SethGammon/Citadel/contributors?per_page=100
gh api repos/SethGammon/Citadel/traffic/clones
gh api repos/SethGammon/Citadel/traffic/views
git rev-list --count origin/main
git rev-list --count --no-merges --author=gammon.seth@gmail.com origin/main
```

If any value changes, update this file, the Typeform answer pack, submission
readiness, and the rendered supporting PDF together.
