# Context Management for Open DroneLog

This document explains how to keep context docs continuously up to date as code evolves.

## One-time Setup

1. Install dependencies:

```bash
npm install
```

2. Generate context artifacts once:

```bash
npm run context:build
```

If this is the first migration, add the new context files to git once:

```bash
git add context docs/context-management.md .github/workflows/context-check.yml scripts/context package.json README.md
```

3. (Recommended) Install Git hooks so stale context is blocked on commit:

```bash
npm run context:install-hooks
```

## Daily Workflow

When code changes (API routes, env vars, dependencies, DB schema, etc.), run:

```bash
npm run context:build
```

Then review and commit changed files under `context/`.

## What Updates Automatically

The following files are generated from source code:

- `context/generated/api-routes.json`
- `context/generated/openapi.json`
- `context/generated/tauri-commands.json`
- `context/generated/deps-frontend.json`
- `context/generated/deps-rust.json`
- `context/generated/env-vars.json`
- `context/generated/db-schema.json`
- `context/manifest.json`
- `context/links/graph.json`

## What You Update Manually

Curated domain docs in `context/domains/*.json` are human-owned and should be updated when new features or architectural changes are introduced.

Required manual fields:
- `updated_at`
- `verified_from`
- `content` facts that are semantic (for example: design intent, business rules)

## Guardrail Command

Use this before commit or in CI:

```bash
npm run context:check
```

It fails if generated artifacts are stale relative to current code.

## Progressive Feature Additions

When adding a new feature:

1. Implement code changes.
2. Run `npm run context:build`.
3. Update relevant `context/domains/*.json` document(s).
4. Run `npm run context:validate`.
5. Run `npm run context:check`.
6. Commit code + context updates together.

## Optional Git Hook (Manual Setup)

If you prefer manual setup instead of `npm run context:install-hooks`, configure:

```bash
mkdir -p .githooks
cat > .githooks/pre-commit <<'EOF'
#!/usr/bin/env sh
npm run context:check
EOF
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```
