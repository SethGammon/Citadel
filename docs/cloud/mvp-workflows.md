# Citadel Cloud: MVP Workflows

> Date: 2026-04-06
> Source: .planning/citadel-cloud-mvp-workflows.md

## Scope

The MVP must support five core workflows. If a feature does not strengthen one
of these workflows, it should not enter MVP without explicit review.

## Workflow 1: Connect a Project

**Flow:**
1. Team signs up, creates an organization
2. User creates or connects a project in Cloud
3. OSS Citadel is configured with project/org credentials (`@citadel/client`)
4. First normalized events are sent to Cloud
5. Dashboard shows the project as active

**Success condition:** First real event visible in the dashboard.

**Implementation touchpoints:**
- `apps/web`: Org signup, project creation UI
- `packages/auth`: Authentication for org/project
- `packages/ingestion`: Envelope validation on first event
- OSS `@citadel/client`: Credential configuration, first emission

## Workflow 2: Review Activity

**Flow:**
1. Operator opens dashboard
2. Sees active campaigns, recent events, failures, and spend hints
3. Clicks into a campaign timeline/history detail
4. Understands what happened without reading raw logs

**Success condition:** A second human can understand a run without being the original operator.

**Implementation touchpoints:**
- `apps/web/src/features/dashboard/`: Event timeline, campaign views
- `apps/web/src/features/campaigns/`: Campaign detail and history browser
- `packages/db`: Query helpers for event and campaign data

## Workflow 3: Approval Request

**Flow:**
1. Local Citadel encounters a policy-triggered action
2. Client emits `approval.requested` event
3. Approval appears in Cloud queue
4. Human approves or denies
5. Decision is recorded and reflected in history

**Success condition:** End-to-end approval decision trace exists.

**Implementation touchpoints:**
- `apps/web/src/features/approvals/`: Approval queue UI
- `apps/worker/src/jobs/`: Approval notification delivery
- `packages/policy-engine`: Policy trigger evaluation
- OSS hooks: Emit `approval.requested` on policy match

## Workflow 4: Policy Management

**Flow:**
1. Admin creates or edits a policy in Cloud
2. Policy sync or config reaches the connected project
3. Relevant action triggers the policy
4. Result is visible in dashboard/history

**Success condition:** One policy works end-to-end with observable enforcement.

**Implementation touchpoints:**
- `apps/web/src/features/policies/`: Policy editor UI
- `packages/policy-engine`: Evaluation and enforcement
- `packages/db`: Policy persistence and versioning

## Workflow 5: Shared Campaign History

**Flow:**
1. Team member opens a completed or active campaign
2. Sees decisions, phase changes, failures, and approvals in one timeline
3. Uses that history to resume or review work

**Success condition:** Shared history is usable by multiple team members.

**Implementation touchpoints:**
- `apps/web/src/features/campaigns/`: Campaign timeline view
- `apps/web/src/features/memory/`: Decision and artifact history
- `packages/db`: Campaign record and event correlation queries
