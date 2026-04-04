# ADR-010: checkJs:false — Gradual TypeScript Migration Strategy

**Date:** 2026-04-04  
**Status:** Accepted  
**Addresses:** Item 4.1 (Deep Audit 2026-04-04)

## Context

The frontend codebase uses JavaScript for React components and TypeScript for
domain/business logic files. `tsconfig.json` is configured with:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "strict": true
  }
}
```

This means TypeScript's type checker runs with `strict: true` on `.ts` / `.tsx`
files but is **silently disabled** for `.js` / `.jsx` files.

The `domain/` directory contains the most critical business logic:
- `permissions.js` — role-based access control
- `requestWorkflow.ts` — request state machine
- `navigation.js` — tab/nav configuration
- `passValidation.ts` — pass validation rules
- `scanDecision.ts` — QR scan decision logic

Some of these already carry `// @ts-check` directives (e.g. `permissions.js`)
which opt individual files into type checking without changing the global setting.

### Why not set checkJs:true globally?

At the time of the initial TypeScript migration (ADR-009), the React component
files (`.jsx`) contained patterns that were incompatible with strict JSDoc-based
type checking:

1. **Prop drilling without TypeScript interfaces** — components pass large
   `user`, `req`, and `badges` objects as plain props. Annotating these would
   require JSDoc `@param` on every component, adding significant noise.
2. **Dynamic class/style computation** — many components build class names via
   string concatenation; TypeScript infers these as `string` and raises no
   errors, but strict JSDoc can produce false positives in complex ternaries.
3. **Third-party hooks** — some hook signatures from older dependencies lacked
   complete type definitions at the time.

Setting `checkJs: true` globally would have produced ~200 type errors in
component files, blocking the migration rather than enabling it.

## Decision

**Keep `checkJs: false` globally** and use **per-file `// @ts-check`** to
opt critical files into type checking selectively.

### Files that MUST have `// @ts-check`

| File | Reason |
|------|--------|
| `domain/permissions.js` | Security-critical RBAC logic |
| `domain/navigation.js` | Tab routing + badge logic |
| `domain/passValidation.ts` | Already `.ts` — fully checked |
| `domain/requestWorkflow.ts` | Already `.ts` — fully checked |
| `domain/scanDecision.ts` | Already `.ts` — fully checked |

### Files scheduled for migration to `.ts`

New domain logic MUST be written in `.ts`. Existing `domain/*.js` files should
be migrated to `.ts` when they are next modified for a feature or bug fix
(opportunistic migration, not a separate migration sprint).

### Consequences

- **Benefit**: TypeScript errors in component files don't block the team.
- **Benefit**: Domain logic (the highest-risk code) is type-checked.
- **Benefit**: New `.ts` files automatically get full strict checking.
- **Risk**: Bugs in component prop types could go undetected until runtime.
- **Mitigation**: React component contracts are validated by Vitest + Testing
  Library tests; PropTypes were removed in favour of TypeScript migration.
- **Future**: Once all `domain/*.js` are migrated to `.ts`, evaluate enabling
  `checkJs: true` for the remaining `.js` utility files.

## Enforcement

The CI pipeline runs `tsc --noEmit` which checks all `.ts` / `.tsx` files and
any `.js` files with `// @ts-check`. Failures block merge.

To add type checking to a new domain file, add `// @ts-check` at the top and
fix any resulting errors before the PR is merged.
