# DoraMemory — CLAUDE.md

Project conventions and working agreements for this repository.

---

## Project Overview

**DoraMemory** is a research and implementation project for a human-like hierarchical temporal memory system for AI agents. The core idea: memory fidelity degrades with temporal distance, implemented as time-driven pooling layers with cognitively-informed compression operators.

---

## Repository Structure

```
doramemory/
├── CLAUDE.md                  # This file — repo conventions
├── README.md                  # Public-facing overview
├── docs/
│   ├── design/
│   │   ├── v0.1-initial-design.md     # First design sketch
│   │   └── CURRENT.md                 # Symlink/copy of latest design
│   └── research/
│       └── related-work.md            # Literature survey
├── src/                       # Implementation (TBD)
└── CHANGELOG.md               # Version history
```

---

## Version Management

### Design Document Versioning

Design documents follow **semantic versioning** (`vMAJOR.MINOR`):

| Bump | When |
|------|------|
| MAJOR | Core architecture changes (e.g., new compression model, retrieval overhaul) |
| MINOR | Additions or refinements within the existing architecture |

- Every design discussion that produces a conclusion **must** result in an updated or new versioned doc under `docs/design/`.
- `docs/design/CURRENT.md` always reflects the latest agreed design.
- Old versions are **never deleted** — they serve as a decision trail.

### Changelog

`CHANGELOG.md` must be updated whenever:
- A new design version is created
- A research finding changes the design direction
- An implementation decision is made

Format:
```
## [vX.Y] — YYYY-MM-DD
### Added / Changed / Decided
- ...
```

---

## Design Decision Records (DDR)

For any non-trivial design decision, record it inline in the design doc under a `## Decision Log` section:

```markdown
### DDR-001: Salience scoring timing
**Decision**: Score salience at compression time (retrospective), not at event ingestion.
**Rationale**: Mirrors human "hindsight" memory consolidation; avoids premature importance judgments.
**Date**: 2026-04-07
**Status**: Proposed
```

Statuses: `Proposed` → `Accepted` → `Superseded`

---

## Writing Conventions

- Language: Chinese for discussion docs, English for code and CLAUDE.md
- Diagrams: ASCII art preferred (renders everywhere); Mermaid acceptable for complex flows
- No speculative implementation details — only what has been explicitly designed and agreed

---

## What NOT to do

- Do not create implementation files before the design is at `v1.0`
- Do not delete or overwrite versioned design docs
- Do not mix research notes into design docs (keep `docs/research/` separate)
