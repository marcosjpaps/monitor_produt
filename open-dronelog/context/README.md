# Context System

This directory contains machine-parsable context for agentic development.

## Layout

- `schema/`: JSON schemas for context documents.
- `domains/`: Curated domain context (human-maintained, schema-validated).
- `generated/`: Code-derived context artifacts (machine-owned).
- `links/graph.json`: Relationship graph for retrieval and linking.
- `manifest.json`: Registry of all context artifacts.
- `adr/`: Architecture decisions for the context system.

## Commands

- `npm run context:extract`: Regenerate generated artifacts from source code.
- `npm run context:validate`: Validate context structure and references.
- `npm run context:build`: Run extract + validate.
- `npm run context:check`: Run build and fail if tracked generated artifacts are stale.
- `npm run context:install-hooks`: Install a pre-commit hook that runs `context:check`.

## Ownership Model

- Edit `domains/*.json` manually.
- Do not manually edit `generated/*.json`; regenerate with scripts.
- Keep `verified_from` in each domain doc accurate.

## CI/Automation

`context:check` is intended for pre-commit/pre-push and CI to prevent drift.
