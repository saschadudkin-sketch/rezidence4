## Architecture checklist

- [ ] Service contract changes are reflected in `src/services/providers/ServiceContracts.ts`.
- [ ] Both providers pass `ServiceContracts.test.ts` (`demo` + `backend` parity).
- [ ] State placement checked (AppStore vs React Query vs local state) and documented in PR notes.
- [ ] Any new ChatView logic is extracted to hooks/components (avoid god component growth).
- [ ] `npm run typecheck` and `npm run lint` executed.
