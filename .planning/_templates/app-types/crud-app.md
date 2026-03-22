---
template: crud-app
description: Standard CRUD application for any entity type
variables:
  - entity_name: "What are you managing? (recipes, tasks, bookmarks, etc.)"
  - multi_user: "Will multiple people use this? (yes/no)"
---

# PRD: {entity_name} Manager

> Description: A web application for creating, viewing, editing, and deleting {entity_name}
> Author: template
> Date: {ISO date}
> Status: template

## Problem
The user needs a simple way to manage a collection of {entity_name}. They want to
add new entries, browse existing ones, edit details, and remove entries they no longer need.

## Users
- Primary: the person managing their {entity_name} collection
- If multi_user=yes: multiple authenticated users, each with their own data

## Core Features
1. **List view**: Browse all {entity_name} with search and optional filtering
2. **Create form**: Add a new {entity_name} with relevant fields
3. **Detail view**: View full details of a single {entity_name}
4. **Edit**: Modify any field of an existing {entity_name}
5. **Delete**: Remove a {entity_name} with confirmation dialog

## Out of Scope (v1)
- Real-time updates / live collaboration
- Analytics or reporting dashboards
- Import/export (CSV, JSON)
- Tags or categories (unless specifically requested)
- Image or file uploads (unless specifically requested)

## Technical Decisions
- **Frontend**: Next.js + Tailwind CSS + shadcn/ui — because it's the most well-supported stack for LLM-assisted development, with excellent component library
- **Backend**: Next.js API routes — because keeping frontend and backend in one project reduces complexity for a CRUD app
- **Database**: SQLite via Prisma (single user) or PostgreSQL via Prisma (multi-user) — because Prisma provides type-safe database access and easy migrations
- **Auth**: None (single user) or NextAuth.js (multi-user) — because NextAuth handles session management with minimal configuration
- **Deployment**: Vercel — because it's the native deployment target for Next.js

## Architecture
Next.js app with API routes serving as the backend. Prisma ORM connects to the
database. The frontend uses server components for the list/detail views and client
components for forms. shadcn/ui provides the component library. All CRUD operations
go through API routes with proper validation.

## End Conditions (v1 Definition of Done)
- [ ] App renders at localhost:3000 without errors
- [ ] Can create a new {entity_name} via the form
- [ ] Created {entity_name} appears in the list view
- [ ] Can edit an existing {entity_name} and see changes persist
- [ ] Can delete a {entity_name} with confirmation
- [ ] Search/filter narrows the list view
- [ ] Responsive layout works on mobile viewport (375px)
- [ ] Typecheck passes with zero errors

## Open Questions
- What fields does a {entity_name} have? (name, description, date, etc.)
- Should the list view be a table, card grid, or simple list?
