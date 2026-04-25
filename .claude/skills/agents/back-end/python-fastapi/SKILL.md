---
name: python-fastapi
description: Prompt pack for the backend-builder when architecture.yaml.tooling.stack.backend_framework=python-fastapi. FastAPI + SQLAlchemy 2 async + Alembic + Pydantic v2, consuming @repo/types via generated Python Pydantic mirrors.
stack_tier: back-end
stack_slug: python-fastapi
maturity: shipped
authoredAt: 2026-04-22
dependencyPinsRefreshedAt: 2026-04-22
---

# python-fastapi — FastAPI + SQLAlchemy 2 async + Pydantic v2

Stack-skill prompt pack for the backend-builder. Loaded when `architecture.yaml.tooling.stack.backend_framework === "python-fastapi"`.

**Cross-language schema contract**: the factory's canonical types live in `@repo/types` (TypeScript Zod). When the backend is Python, a codegen step in the builder produces matching Pydantic v2 models at `packages/python-types/` — the backend imports from there, not directly from Zod. The codegen is `zod-to-pydantic` (factory script, shipped alongside this skill). This keeps one source of truth for API contracts while the backend speaks Python.

## 1. Canonical layout

```
apps/api/
├── src/
│   └── api/
│       ├── __init__.py
│       ├── main.py                      # FastAPI app + middleware wiring
│       ├── dependencies.py              # shared deps: get_db, get_current_user
│       ├── config.py                    # Pydantic Settings (env validation)
│       ├── auth/
│       │   ├── __init__.py
│       │   ├── router.py                # APIRouter for /auth endpoints
│       │   ├── service.py               # business logic (pure functions)
│       │   ├── schemas.py               # Pydantic request/response shapes
│       │   └── test_service.py
│       ├── users/
│       │   ├── __init__.py
│       │   ├── router.py
│       │   ├── service.py
│       │   ├── schemas.py
│       │   └── test_service.py
│       ├── db/
│       │   ├── __init__.py
│       │   ├── session.py               # AsyncSession factory
│       │   └── models/
│       │       ├── __init__.py
│       │       ├── user.py              # SQLAlchemy declarative Mapped[...] models
│       │       └── session_token.py
│       └── common/
│           ├── errors.py                # HTTPException factories
│           └── middleware.py            # request-id, structured logging
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── tests/
│   ├── conftest.py                      # pytest fixtures (test-db, async client)
│   ├── integration/
│   │   └── test_auth_flow.py
│   └── e2e/                             # tester-owned
├── pyproject.toml                       # uv-managed; deps + tool config
├── uv.lock
├── .python-version                      # 3.13
└── alembic.ini
```

Cross-repo generated:

```
packages/python-types/
├── __init__.py                          # generated — mirrors @repo/types Zod schemas
├── user.py
├── session.py
└── (other mirrors)
```

## 2. Idioms

- **Fully async.** FastAPI endpoints are `async def`; SQLAlchemy 2 `AsyncSession`; dependencies async; HTTP clients (`httpx.AsyncClient`). Sync-only deps wrap in `run_in_executor` or `asyncio.to_thread`.
- **Typed SQLAlchemy 2.** Declarative models use `Mapped[...]` + `mapped_column(...)` — no legacy `Column()`. Relationships via `Mapped["OtherModel"]`.
- **Pydantic v2 for request/response.** Config via `model_config = ConfigDict(from_attributes=True)` (formerly `orm_mode`). Use `field_validator` / `model_validator` decorators.
- **Dependency injection via `Depends()`.** Auth, db session, rate limit, feature flags — all via `Depends(fn)`. Never import a db session at module scope; always inject.
- **Separation of concerns per domain**: `router.py` = HTTP surface only, `service.py` = business logic (takes session + inputs, returns domain objects), `schemas.py` = Pydantic I/O models, `db/models/*.py` = SQLAlchemy ORM models.
- **Services are pure-ish.** `service.create_user(db: AsyncSession, payload: UserCreate) -> User` — no HTTP concepts in service signatures; router wraps service results in JSON response shapes.
- **HTTPException with structured detail.** `raise HTTPException(status_code=409, detail={"code": "email_taken", "message": "..."})` — structured JSON errors consumers can switch on.
- **Alembic migrations autogenerate but ALWAYS review.** `alembic revision --autogenerate -m "add session token"` generates a draft; builder MUST open the file and confirm the operations before applying.
- **Pydantic Settings for env.** `class Settings(BaseSettings)` with `SettingsConfigDict(env_file=".env")` — validates at startup. Missing `DATABASE_URL` fails fast with a clear error.
- **uv for dependency management.** `uv sync` installs; `uv add <pkg>` adds; `uv run <cmd>` runs in venv. Faster + more reliable than pip + virtualenv combo.

## 3. Testing

Binds to `feat-004-builder-tdd-hybrid`.

- **Test-file naming**: `api/auth/service.py` → `api/auth/test_service.py` (co-located).
- **Test runner**: `uv run pytest tests/` or `uv run pytest path/to/test_file.py::test_name`; coverage `uv run pytest --cov=api --cov-report=term-missing`.
- **Async test pattern** (requires `pytest-asyncio`):

  ```python
  import pytest
  from api.auth.service import create_user, UserCreate

  @pytest.mark.asyncio
  async def test_create_user_hashes_password(test_session):
      result = await create_user(
          test_session,
          UserCreate(email="a@b.c", password="hunter2"),
      )
      assert result.email == "a@b.c"
      assert result.password_hash != "hunter2"
      assert result.password_hash.startswith("$2b$")
  ```

- **Mocking patterns**:
  - Mock async DB session via `unittest.mock.AsyncMock()` for pure unit tests; prefer real test-db via `conftest.py` fixture for anything touching SQL semantics.
  - Mock clock via `freezegun` (`@freeze_time("2026-01-01")`).
  - Mock external HTTP via `httpx_mock` (`pytest-httpx`).
- **Integration tests** use a real test-db via `testcontainers.PostgresContainer()` or a dedicated CI Postgres. Each test gets a fresh schema via `Base.metadata.create_all()` + rollback on teardown.
- **Coverage expectation**: 60% builder / 80% total (same cross-stack policy).
- **Example conftest.py fixture**:
  ```python
  @pytest.fixture
  async def test_session(test_engine):
      async with AsyncSession(test_engine) as session:
          yield session
          await session.rollback()
  ```

## 4. Commands

```
lint:        uv run ruff check api tests
format:      uv run ruff format api tests
typecheck:   uv run mypy api
test:        uv run pytest
build:       uv build                           # wheel + sdist (if publishing)
dev:         uv run fastapi dev src/api/main.py
db:migrate:  uv run alembic upgrade head
db:revise:   uv run alembic revision --autogenerate -m "msg"
```

Builder self-verify gate: `uv run ruff check api && uv run mypy api && uv run pytest`. Runs in ~5-15s on a small project.

## 5. Gotchas

- **Circular imports between models.** When `user.py` references `SessionToken` and `session_token.py` references `User`, use `from typing import TYPE_CHECKING` + string type hints (`Mapped["SessionToken"]`). Runtime bypasses the import; type-checker resolves via the `TYPE_CHECKING` block.
- **Sync call inside async handler blocks the event loop.** `time.sleep(5)` in an `async def` endpoint freezes all concurrent requests. Use `await asyncio.sleep(5)`. Same for DB calls — `session.query(...)` (sync) vs `session.execute(...)` + `await` (async).
- **Pydantic v1 vs v2 breaking changes.** `@validator` → `@field_validator`; `Config` class → `model_config = ConfigDict()`; `.dict()` → `.model_dump()`; `.parse_obj()` → `.model_validate()`. If a library imports `pydantic.v1` explicitly, it hasn't been upgraded — pin carefully.
- **Alembic autogenerate misses subtle changes.** It doesn't detect CHECK constraints, default-value changes on existing columns, or index renames. Always open the generated file + manually add missed ops.
- **FastAPI's response model strips undeclared fields.** If you return a dict with extra keys, they're silently dropped. Intentional for API-contract safety but surprising; use `response_model=None` on intentionally-loose endpoints.
- **`Depends()` evaluates every request.** A `get_current_user` dep does auth + DB lookup on EVERY request — cache within request scope via `functools.lru_cache` if truly expensive.
- **Async SQLAlchemy session sharing.** Sessions aren't thread-safe and don't share between concurrent tasks. Use `async with` context per task; don't pass one session across `asyncio.gather(...)` children.
- **`uvicorn --reload` in dev vs `fastapi dev`.** `fastapi dev` is the newer unified wrapper (FastAPI 0.110+); older examples use `uvicorn api.main:app --reload`. Stick with `fastapi dev` for consistency.
- **Webhook signature verification needs raw body.** FastAPI's default JSON parser consumes the body. Register a dependency that reads `request.body()` BEFORE JSON parsing — see `api/common/raw_body.py` pattern.

## Review

Stack-specific checks the reviewer agent runs IN ADDITION to `docs/reviewer-playbook.md`'s generic 7 dimensions. Scope: files in the feature's diff under `apps/api/`.

#### security — SQL string interpolation

- **Invocation**: `grep -rnE "(execute|from_statement)\s*\(\s*[fF]\"(SELECT|INSERT|UPDATE|DELETE)" apps/api/`
- **Threshold**: zero hits — SQLAlchemy f-string SQL is the classic injection vector; use `text(":param")` bound parameters or the ORM query builder
- **Retry target**: backend-builder
- **Playbook §**: augments §2.1 SQL injection

#### security — raw-body dependency for webhooks

- **Invocation**: for every webhook-receiving integration in `architecture.yaml.apps.api.integrations`, grep the corresponding router: `grep -rnE "raw_body|request\.body\(\)" apps/api/`
- **Threshold**: ≥1 match per webhook integration (signature verification fails without the untouched body)
- **Retry target**: backend-builder
- **Playbook §**: augments §2 security (webhook-integrity sub-check)

#### performance — sync def inside async app

- **Invocation**: identify endpoint handlers that await I/O: `grep -rnB1 -A5 "@router\.(get|post|put|patch|delete)" apps/api/ | grep -B5 "await " | grep -E "^\s*def "`
- **Threshold**: zero hits — every handler that awaits MUST be declared `async def`; a sync wrapper around an `await` blocks the event loop
- **Retry target**: backend-builder
- **Playbook §**: augments §6 performance (event-loop-blocking sub-check)

#### architecture — response_model coverage on endpoints

- **Invocation**: `grep -rnE "@router\.(get|post|put|patch|delete)" apps/api/ | grep -vE "response_model="`
- **Threshold**: zero hits — every endpoint names a Pydantic `response_model=` (schema-driven API contract binds to tasks.yaml + brief §11)
- **Retry target**: backend-builder
- **Playbook §**: augments §1 architecture + §7 brief-delivery

#### security — Depends() auth on protected routes

- **Invocation**: for every route in `architecture.yaml.apps.api.routes` with `authRequired: true`, grep the router file: `grep -nE "Depends\((get_current_user|require_auth|verify_token)\)" apps/api/routers/<file>.py`
- **Threshold**: ≥1 `Depends(...)` auth dependency per auth-required route
- **Retry target**: backend-builder
- **Playbook §**: augments §2 security (auth-bypass sub-check)

## 6. Dependency pins

Via `pyproject.toml` (uv-managed):

```toml
[project]
requires-python = ">=3.13"
dependencies = [
  "fastapi>=0.115,<0.116",
  "uvicorn[standard]>=0.32,<0.33",
  "sqlalchemy>=2.0.36,<2.1",
  "asyncpg>=0.30,<0.31",       # async postgres driver
  "alembic>=1.14,<1.15",
  "pydantic>=2.10,<3.0",
  "pydantic-settings>=2.6,<3.0",
  "bcrypt>=4.2,<5.0",
  "python-jose[cryptography]>=3.3,<4.0",
  "httpx>=0.28,<0.29",
]

[dependency-groups]
dev = [
  "pytest>=8.3,<9.0",
  "pytest-asyncio>=0.24,<0.25",
  "pytest-cov>=6.0,<7.0",
  "pytest-httpx>=0.33,<0.34",
  "testcontainers[postgres]>=4.8,<5.0",
  "ruff>=0.8,<0.9",
  "mypy>=1.13,<2.0",
  "freezegun>=1.5,<2.0",
]
```

Python version pinned in `.python-version`: `3.13` (current stable at factory-authoring time).

## 7. Anti-patterns

- **Never mix sync + async in the same endpoint.** An `async def` with `requests.get()` blocks the loop — use `httpx.AsyncClient` instead.
- **Never query the DB at module import.** Side effects at import time break test isolation + make config errors invisible until runtime. Put queries in `@app.on_event("startup")` or `Depends()`.
- **Never re-author Pydantic shapes by hand when a Zod source exists in `@repo/types`.** Run the `zod-to-pydantic` codegen; commit the generated `packages/python-types/` output as a read-only mirror.
- **Never use `dict` as a type-hint on response models.** Declare a Pydantic `BaseModel` subclass — API consumers rely on OpenAPI for type safety, and `dict` erases that.
- **Never commit `.env` or `alembic/versions/*.pyc`.** `.gitignore` covers it, but verify after `uv run alembic revision` — autogen should only touch `.py` files.
- **Never mutate a Pydantic model's fields in-place after validation.** Use `model_copy(update={...})` for immutable updates; mutations skip validators.

## Self-verify (RUN BEFORE REPORTING TASK COMPLETE)

After authoring code + tests for a task, run these commands IN ORDER from the worktree root. Each must succeed before you report `taskStatus: "completed"` for that task. ANY failure → set `taskStatus: "failed"` for the task and surface the stderr in the `errors` field of your return JSON.

```bash
# 1. Install: catches "I added a pyproject.toml line but uv.lock doesn't have it"
uv sync

# 2. Typecheck: catches missing types, Pydantic v1-vs-v2 drift, SQLAlchemy mapping errors
uv run mypy api

# 3. Tests + coverage: runs the test_*.py files you authored
uv run pytest --cov=api --cov-report=term-missing
```

If you skip ANY of these commands, your task will fail downstream when feat-018's commit-discipline gate evaluates. The orchestrator will mark the feature failed via `feature-no-commits`. Save yourself the round-trip: run the three commands.

If `uv sync` fails because of a registry network issue, retry once with `--offline` after a successful previous resolve. If still failing, report the failure verbatim — don't try to work around it.

## 8. References

- [FastAPI docs](https://fastapi.tiangolo.com/)
- [SQLAlchemy 2 async ORM patterns](https://docs.sqlalchemy.org/en/20/orm/queryguide/index.html)
- [Pydantic v2 migration guide](https://docs.pydantic.dev/latest/migration/)
- [Alembic cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html)
- [uv docs](https://docs.astral.sh/uv/) — Python project + dependency tool
- Blueprint §17 / Appendix E
