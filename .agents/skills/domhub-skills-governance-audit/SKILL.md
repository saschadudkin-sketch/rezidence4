---
name: domhub-skills-governance-audit
description: Use when auditing DomHub project skills for quality, trigger overlap, stale source links, duplicated guidance, missing source-of-truth references, unsafe instructions, or maintainability drift.
license: project-local
metadata:
  domain: skills-governance
  project: DomHub
  source: project-local
---

# DomHub Skills Governance Audit

Use this skill to audit `D:\rezidence4\.agents\skills`.

## Goals

- Keep skills small, accurate, and non-overlapping.
- Ensure project-local skills point to real DomHub source-of-truth files.
- Detect stale filenames, duplicated rules, generic filler, and conflicting guidance.
- Confirm third-party skills are appropriate for this repository.
- Surface safety risks using `skill-security-auditor` when scripts or external content are present.

## Checks

- Every DomHub skill should declare a clear bounded domain.
- Triggers/descriptions should be specific enough to avoid firing for unrelated work.
- Skills should reference existing local docs, commands, or code paths.
- Skills must not override `AGENTS.md`, developer instructions, or user instructions.
- Avoid copying large source-of-truth content into skills; link to the document instead.
- Prefer project-specific skills over adding broad external “expert” skills.
- Flag redundant skills that should be merged or renamed.

## Output

Lead with findings ordered by severity:

```text
Verdict: PASS|WARN|FAIL

Findings:
- [P1] .agents/skills/name/SKILL.md:line - problem

Recommended actions:
- ...

Coverage:
- Audited: ...
- Not audited: ...
```

