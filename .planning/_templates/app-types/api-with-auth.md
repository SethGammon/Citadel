---
template: api-with-auth
description: REST API with JWT authentication and one resource CRUD
variables:
  - resource_name: "What resource does the API manage? (posts, products, items, etc.)"
  - language: "Preferred language? (typescript/python)"
---

# PRD: {resource_name} API

> Description: A REST API with JWT authentication and CRUD endpoints for {resource_name}
> Author: template
> Date: {ISO date}
> Status: template

## Problem
Need a backend API that handles user registration, login, and authenticated CRUD
operations on {resource_name}. This is the backend that a frontend or mobile app
will consume.

## Users
- Primary: frontend or mobile developers consuming the API
- End users: people who register, log in, and manage their {resource_name}

## Core Features
1. **User registration**: POST /api/auth/register with email + password
2. **User login**: POST /api/auth/login returns JWT access token
3. **Protected routes**: middleware that validates JWT on protected endpoints
4. **Resource CRUD**: GET/POST/PUT/DELETE /api/{resource_name} (authenticated)
5. **Input validation**: request body validation on all endpoints

## Out of Scope (v1)
- Frontend or UI
- OAuth / social login (Google, GitHub, etc.)
- Email verification or password reset
- Rate limiting
- File uploads
- Pagination (acceptable to add if simple)
- WebSocket or real-time features

## Technical Decisions
- **Frontend**: None — API only
- **Backend (TypeScript)**: Express.js — because it's the most widely understood Node.js framework with the most LLM training data
- **Backend (Python)**: FastAPI — because it provides automatic OpenAPI docs, type validation via Pydantic, and async support
- **Database**: PostgreSQL via Prisma (TS) or SQLAlchemy (Python) — because relational data with auth needs proper constraints and transactions
- **Auth**: bcrypt for password hashing + jsonwebtoken (TS) or PyJWT (Python) — because JWT is stateless and well-understood. No external auth service needed.
- **Deployment**: Docker container — because APIs need consistent environments. Dockerfile included.

## Architecture
Express/FastAPI application with a layered structure: routes → controllers →
services → database. Auth middleware intercepts protected routes, validates the
JWT, and injects the user into the request context. Password hashing uses bcrypt
with appropriate salt rounds. Database migrations managed by the ORM.

## End Conditions (v1 Definition of Done)
- [ ] POST /api/auth/register creates a user and returns 201
- [ ] POST /api/auth/login with valid credentials returns a JWT token
- [ ] GET /api/{resource_name} without token returns 401
- [ ] GET /api/{resource_name} with valid token returns 200
- [ ] Full CRUD cycle works: create → read → update → delete
- [ ] Passwords are hashed (not stored in plaintext)
- [ ] Invalid input returns 400 with descriptive error message
- [ ] Typecheck passes with zero errors (TS) or mypy passes (Python)

## Open Questions
- What fields does a {resource_name} have beyond id and name?
- Should {resource_name} be scoped to the authenticated user (only see your own)?
- Any specific validation rules for the fields?
