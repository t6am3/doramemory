# DoraMemory

A human-like hierarchical temporal memory system for AI agents.

## Core Idea

Human memory degrades in fidelity with temporal distance. DoraMemory models this as **time-driven pooling layers**: recent events are stored at full resolution, while older events are progressively compressed by cognitively-informed operators.

```
← past                                                  now ●
────────────────────────────────────────────────────────────
2yr ago   1yr ago   6mo ago  2mo ago  last mo  last wk  today
  ░░░       ▒▒▒▒     ▒▒▒▒▒   ▓▓▓▓▓   ▓▓▓▓▓   ████    ██████
  ~3%       ~8%      ~15%    ~30%     ~50%    ~70%     100%
 yearly   monthly  monthly  weekly   daily   daily    raw
skeleton  summary  summary  summary  summary summary  events
```

## Status

**Phase**: Design & Research (v0.1)

See [`docs/design/CURRENT.md`](docs/design/CURRENT.md) for the current design spec.  
See [`docs/research/related-work.md`](docs/research/related-work.md) for literature survey.  
See [`CHANGELOG.md`](CHANGELOG.md) for version history.

## Design Highlights

- **5-layer temporal hierarchy**: Working Memory → Daily → Weekly → Monthly → Yearly
- **Compression operators**: Salience Filter, Pattern Extractor, Entity Tracker, Belief Updater, Narrative Weaver
- **Retrieval scoring**: semantic relevance × time decay × salience
- **Flashbulb memory**: high-salience events resist compression permanently
- **Time-boundary triggers**: compression fires at day/week/month/year boundaries
