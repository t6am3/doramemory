# Changelog

All design versions and significant decisions are recorded here.

---

## [v0.1] — 2026-04-07

### Added
- Initial design: hierarchical temporal memory system for AI agents
- Core concept: time-driven pooling layers (L0 raw → L4 yearly skeleton)
- Compression operators: Salience Filter, Pattern Extractor, Entity Tracker, Belief Updater, Narrative Weaver
- Retrieval scoring: semantic relevance × time decay weight × salience
- Literature survey: Generative Agents, MemGPT, H-MEM, R³Mem, Zep, Mem0, A-MEM

### Key Design Decisions
- DDR-001: Compression is time-boundary-triggered (daily/weekly/monthly/yearly)
- DDR-002: Different operator combinations at each compression level
- DDR-003: Flashbulb memories (high salience) resist compression and stay at L0
