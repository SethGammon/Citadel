---
template: landing-page
description: Marketing or product landing page with hero, features, and CTA
variables:
  - product_name: "What's the name of the product or project?"
  - has_pricing: "Does it need a pricing section? (yes/no)"
---

# PRD: {product_name} Landing Page

> Description: A responsive marketing landing page for {product_name}
> Author: template
> Date: {ISO date}
> Status: template

## Problem
{product_name} needs a public-facing page that explains what it is, shows its key
features, and gives visitors a clear action to take (sign up, download, contact, etc.).

## Users
- Primary: potential users or customers visiting the page for the first time

## Core Features
1. **Hero section**: headline, subheadline, and primary CTA button
2. **Features section**: 3-6 feature cards with icons and descriptions
3. **Social proof**: testimonials, logos, or usage stats (placeholder content is fine for v1)
4. **CTA section**: clear call-to-action with signup form or link
5. **Responsive design**: works on desktop, tablet, and mobile

## Out of Scope (v1)
- Backend or API
- User accounts or authentication
- Dynamic content or CMS integration
- Blog or content pages
- Analytics tracking (can be added post-deploy)
- Animations beyond simple CSS transitions

## Technical Decisions
- **Frontend**: Next.js static export + Tailwind CSS + shadcn/ui — because static export produces a fast, deployable site with no server needed
- **Backend**: None — this is a static site
- **Database**: None
- **Auth**: None
- **Deployment**: Vercel or Netlify — because both handle static sites with zero configuration

## Architecture
A single Next.js page with section components. Each section (Hero, Features,
Pricing, CTA, Footer) is a separate component. All content is hardcoded in the
components for v1. Tailwind handles responsive breakpoints. No JavaScript
interactivity beyond the mobile menu toggle.

## End Conditions (v1 Definition of Done)
- [ ] Page renders at localhost:3000 without errors
- [ ] Hero section visible with headline and CTA button
- [ ] Features section shows at least 3 feature cards
- [ ] Page is responsive (renders correctly at 375px, 768px, and 1280px widths)
- [ ] Page loads in under 3 seconds on a simulated slow connection
- [ ] Typecheck passes with zero errors
- [ ] `next build` completes without errors

## Open Questions
- What is the primary CTA? (Sign up, Download, Contact, Book a demo)
- What are the key features to highlight?
- Any brand colors or existing design guidelines?
