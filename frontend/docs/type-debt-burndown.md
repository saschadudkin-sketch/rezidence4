# Type debt burn-down plan

## Current status

- `npm run typecheck` is still in **red zone** with legacy typing debt across `services`, `hooks`, `views`, `store`.
- This plan enforces staged hardening, starting from service contracts (source of truth), then moving up-stack.

## Phases

1. **Service layer contracts (done in this PR)**
   - Introduce `ServiceContracts.ts` as canonical interface.
   - Make `createServices()` validate and return typed contracts.
   - Add contract tests for demo/backend parity.

2. **Hooks alignment (in progress)**
   - Migrate hooks consuming `services.*` to explicit return types and guards.
   - Remove `unknown` propagation from hooks to UI.

3. **Store boundary hardening (planned)**
   - Type AppStore selectors/actions to avoid `unknown` fan-out.
   - Introduce typed slice payloads for requests/chat/admin.

4. **Views cleanup (planned)**
   - Replace ad-hoc prop objects with typed props.
   - Remove implicit `any` and invalid JSX prop surfaces.

## Gate policy

- New service APIs **must** update `ServiceContracts.ts`.
- New provider methods are accepted only with contract tests for both providers.
- PR must include status line: `A1 fully done: yes/no`.
