---
name: write-frontend-tests
description: Use when writing or updating unit tests for frontend code (React components, hooks, API clients, utilities) in frontend/src.
---

# Write frontend tests

Follow the conventions of the existing colocated tests in `frontend/src/`. Read the closest existing test before writing a new one.

## Files and style

- Put the test next to the source: `Name.tsx` → `Name.test.tsx`, `name.ts` → `name.test.ts`.
- Use Vitest with React Testing Library. `src/test/setup.ts` already loads `jest-dom` matchers and cleans up after each test.
- Match the file style: single quotes, no semicolons, top-level `it` blocks.
- Reuse `todoFixture` from `src/test/todoFixture`. You cannot create or change files in `src/test/`; define extra fixtures inside your test file.
- Name tests by behaviour: `shows an error and retries when loading fails`.

## Patterns

- **Design system**: always mock it with the provided mocks, using the correct relative path: `vi.mock('../../design-system', () => import('../../design-system/mocks'))`.
- **Components**: render with props, find elements by role and accessible name (`getByRole('button', { name: ... })`), interact with `userEvent.setup()`, and assert what the user sees and which callbacks were called with which arguments.
- **Pages**: mock child components and hooks with `vi.mock` and `vi.mocked(...).mockReturnValue(...)`, as in `TodosPage.test.tsx`, and test the page's own logic.
- **Query and mutation hooks**: use `renderHook` with a wrapper that provides a fresh `QueryClient` with `retry: false`, mock `todosApi` from `../api/todos`, and assert loading, success and error states.
- **API client and `lib/http.ts`**: mock `request` (for the API client) or `fetch` with `vi.stubGlobal` (for `http.ts`). Cover error responses, empty `204` responses and aborted requests.

## Quality

- Test what the user sees and does, not component internals, state variables or CSS classes.
- Derive expected values from the intended behaviour, not by running the code and copying its output.
- Every test asserts an observable result. A test that only checks that a mock was called is not enough.
- Never mock the unit under test. Mock only its dependencies.
- For every changed behaviour, write at least one test for the expected case and one for an error or edge case.
- No snapshots.
