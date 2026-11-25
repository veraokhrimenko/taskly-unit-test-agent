---
name: write-backend-tests
description: Use when writing or updating unit tests for backend code (Express routes, repositories, validators, mappers) in backend/src.
---

# Write backend tests

Follow the conventions of the existing tests in `backend/tests/`. Read one of them before writing a new file.

## Files and style

- One test file per source file: `backend/tests/<name>.test.ts`. Import source with a relative `.ts` path, for example `../src/api/health.ts`.
- Use Vitest (`it`, `expect`, `vi`) with top-level `it` blocks and a local `setup()` helper that builds fresh mocks for each test.
- Reuse `record` and `todo` from `backend/tests/fixture.ts`. Do not change existing fixtures; add new ones in your test file.
- Name tests by behaviour in plain English: `returns 503 when the database is unavailable`.

## Patterns

- **Routes**: build an Express app in `setup()`, mount the router with mocked dependencies (`vi.fn()`), and call it with `supertest`. Assert the status code, the response body, and the exact arguments passed to dependencies.
- **Repository**: create the real Prisma client with `createDatabase('postgresql://test:test@localhost:5432/test')` (it does not connect) and mock its methods with `vi.spyOn(database.todo, '<method>')`. Call `vi.restoreAllMocks()` in `afterEach`.
- **Validators and mappers**: call them directly. Use `it.each` tables for valid and invalid inputs, including boundaries: empty and whitespace strings, maximum length and one over, every enum value and an unknown one, valid and impossible dates, `null`.
- **Errors**: use `mockRejectedValue` to simulate failing dependencies and assert the error response.

## Quality

- Derive expected values from the intended behaviour (the change, names, validation rules), not by running the code and copying its output.
- Every test asserts an observable result: status, body, return value or exact call arguments. A test that only checks that a mock was called is not enough.
- Never mock the unit under test. Mock only its dependencies.
- For every changed behaviour, write at least one test for the expected case and one for an error or edge case.
- No snapshots.
