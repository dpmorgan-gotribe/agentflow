---
task-id: "015"
title: "Brief Schema & Frontmatter Validation"
status: pending
priority: P1
tier: 4 — Brief System
depends-on: ["001"]
estimated-scope: small
---

# 015: Brief Schema & Frontmatter Validation

## What This Task Produces
A JSON Schema file at `schemas/brief-frontmatter.schema.json` that validates brief.md frontmatter.

## Scope
From blueprint lines 471-518:

### Frontmatter Fields to Validate
- `$schema` (string, reference to this schema)
- `version` (semver string, required)
- `status` (enum: draft | review | approved | locked)
- `project-name` (string, required)
- `author` (string, required)
- `created` (date, required)
- `last-modified` (date, required)
- `brief-schema-version` (string, required)
- `companion-files` (array of objects: path, type, required)
- `tags` (array of strings)
- `amendments` (array of objects: sections-affected, downstream-impact)

### JSON Schema
Write a standard JSON Schema draft-2020-12 that validates all above fields with correct types, required fields, and enum constraints.

### Also Create
- `schemas/navigation.schema.json` — placeholder (to be filled when companion files are defined)
- `scripts/validate-brief.mjs` — stub script that:
  1. `--frontmatter` flag: parse YAML frontmatter, validate against schema
  2. `--codeblocks` flag: verify §7 and §10 contain code blocks
  3. `--companions` flag: check companion files referenced in frontmatter exist
  4. `--all` flag: run all three

## Acceptance Criteria
- [ ] `schemas/brief-frontmatter.schema.json` exists and is valid JSON Schema
- [ ] All frontmatter fields from blueprint are covered
- [ ] `scripts/validate-brief.mjs` stub exists with three validation modes
- [ ] Schema enforces required fields and enum values

## Human Verification
Review the schema — are any frontmatter fields missing? Is the validation strict enough?
