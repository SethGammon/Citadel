---
name: score-only
description: Tests --score-only mode with no rubric present
expected-behavior: Should detect missing rubric, prompt user or use default, output scores without making changes
skip-execute: true
---

User prompt: `/improve citadel --score-only`

## Setup
- No rubric file exists at `.planning/rubrics/`

## Expected
- Skill detects no rubric
- Either creates a default rubric or asks user
- Outputs scores per axis
- Makes no code changes
