---
version: 1
id: "{uuid}"
status: active
started: "{ISO timestamp}"
completed_at: null
direction: "{one-line summary}"
wave_count: 0
current_wave: 1
agents_total: 0
agents_complete: 0
---
<!-- FRONTMATTER GUIDE
  version:         Do not change. Schema version for UI compatibility.
  id:              Stable UUID. Set once at creation. Never change — used by UI for entity tracking across renames.
  status:          Keep in sync with the "Status:" line below. Values: active | completed | needs-continue | failed
  started:         Set once at creation. ISO timestamp.
  completed_at:    Set when status changes to completed or failed. ISO timestamp. null while active.
  direction:       Single-line summary of the fleet session goal. No newlines.
  wave_count:      Update when adding waves. Total number of waves planned.
  current_wave:    Update as waves advance. Wave number currently executing.
  agents_total:    Update when adding agents to the Work Queue. Total agents across all waves.
  agents_complete: Increment as agents finish. Used for progress tracking.
-->

# Fleet Session: {Session Name}

Status: active
Started: {ISO timestamp}
Direction: {Original direction}

## Work Queue
| # | Campaign | Scope | Deps | Status | Wave | Agent |
|---|----------|-------|------|--------|------|-------|
| 1 | {name} | {directories} | none | pending | 1 | builder |
| 2 | {name} | {directories} | none | pending | 1 | builder |
| 3 | {name} | {directories} | 1,2 | pending | 2 | wirer |

## Wave 1 Results
<!-- Filled after Wave 1 completes. Example below. -->

## Shared Context (Discovery Relay)
<!-- Accumulated discoveries that inform future waves. Example below. -->

## Continuation State
<!-- Update frontmatter fields when advancing waves:
     - current_wave when moving to the next wave
     - agents_complete as each agent finishes
     - status when the session ends
-->
Next wave: 1
Blocked items: none
Context usage: ~100K tokens
Auto-continue: true

---

## Example: E-Commerce Platform Overhaul

Below is a completed fleet session for reference. Delete this section when creating your own.

```markdown
# Fleet Session: ecommerce-overhaul

Status: completed
Started: 2026-03-18T14:00:00Z
Direction: "Rebuild checkout flow, add inventory service, update product catalog UI"

## Work Queue
| # | Campaign | Scope | Deps | Status | Wave | Agent |
|---|----------|-------|------|--------|------|-------|
| 1 | checkout-api | src/api/checkout/ | none | done | 1 | builder |
| 2 | inventory-service | src/services/inventory/ | none | done | 1 | builder |
| 3 | product-ui | src/ui/products/ | none | done | 1 | builder |
| 4 | checkout-ui | src/ui/checkout/ | 1 | done | 2 | builder |
| 5 | integration-tests | tests/integration/ | 1,2,3 | done | 2 | tester |
| 6 | e2e-wiring | src/app/routes/ | 4,5 | done | 3 | wirer |

## Wave 1 Results

### Agent: checkout-api-builder
**Status:** complete
**Built:** Checkout endpoint with cart validation, Stripe payment intent creation, order persistence
**Decisions:** Used Stripe PaymentIntents (not Charges) for SCA compliance. Orders stored in existing Postgres, not a new table.
**Discoveries:** Stripe SDK requires API version 2024-12-18+. Cart validation rejects items with 0 stock.
**Files:** src/api/checkout/route.ts, src/api/checkout/validate.ts, src/api/checkout/stripe.ts

### Agent: inventory-service-builder
**Status:** complete
**Built:** Real-time inventory tracking with optimistic locking to prevent oversell
**Decisions:** Used SELECT FOR UPDATE instead of application-level locking. Added 30s reservation hold on checkout start.
**Discoveries:** Product table has no `reserved_qty` column — added migration. Existing stock values are stale (some negative).
**Files:** src/services/inventory/index.ts, src/services/inventory/reservation.ts, migrations/add-reserved-qty.sql

### Agent: product-ui-builder
**Status:** complete
**Built:** Product catalog grid with real-time stock badges, skeleton loading, infinite scroll
**Decisions:** Used Intersection Observer for infinite scroll (not pagination). Stock badges poll every 10s.
**Discoveries:** Existing ProductCard component expects `price` as string, not number — kept the string convention.
**Files:** src/ui/products/CatalogGrid.tsx, src/ui/products/StockBadge.tsx, src/ui/products/useProducts.ts

## Wave 2 Results

### Agent: checkout-ui-builder
**Status:** complete
**Built:** Multi-step checkout form (cart review → shipping → payment → confirmation)
**Decisions:** Used Stripe Elements for PCI compliance. Form state via useDraft hook, committed on successful payment.
**Discoveries:** Stripe Elements requires the PaymentIntent client_secret from Wave 1's checkout API. Used /api/checkout/intent endpoint.
**Files:** src/ui/checkout/CheckoutWizard.tsx, src/ui/checkout/PaymentStep.tsx, src/ui/checkout/useCheckout.ts

### Agent: integration-tester
**Status:** partial
**Built:** 14 integration tests covering checkout flow, inventory reservation, and stock badge updates
**Failures:** 2 tests flaky — inventory reservation timeout test depends on 30s wait, runs slowly in CI
**Files:** tests/integration/checkout.test.ts, tests/integration/inventory.test.ts

## Shared Context (Discovery Relay)

- Stripe SDK requires API version 2024-12-18+ (inform all agents touching payments)
- Product table `price` is stored as string, not number (inform UI agents)
- `reserved_qty` column added by migration — run migrations before Wave 2 tests
- Cart validation rejects 0-stock items — checkout UI should disable "Add to Cart" when stock is 0
- Existing ProductCard expects string prices — don't refactor this mid-session

## Continuation State
Next wave: completed
Blocked items: 2 flaky integration tests (inventory reservation timeout)
Context usage: ~580K tokens
Auto-continue: false
```
