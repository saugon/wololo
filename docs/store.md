# The store, for dashboards

Every run is a directory any app can read. Several terminals and projects write at once without coordinating: each run has a single writer, the session that owns it.

```
<data>/runs/<run id>/
  run.json        snapshot (schema/v1/run.schema.json), replaced atomically
  events.jsonl    append-only source of truth (schema/v1/event.schema.json)
  owner.json      { session_id, cwd, heartbeat_at }: the writer's heartbeat, every 15 s
  source.md context.md spec.md plan.md log.md summary.md pr-body.md
  debate/NN-<stage>-<role>.md   one file per debate turn
  screenshots/NN-<slug>.png
<data>/sessions/<session id>.json   which run a session drives
```

- **Listing runs**: read `runs/*/run.json`. A run whose status is not final and whose `owner.heartbeat_at` is more than 90 s old has lost its session: show it as orphaned. `/wololo resume <run>` takes it over.
- **Timelines and durations**: read `events.jsonl`; `seq` orders it, and `ts` is in seconds since the epoch.
- **One writer**: only the mod instance that owns the session writes a run. Files written before that rule may repeat a `seq`, so sort by `seq` stably, keeping file order among equals.
- **Live updates**: watch the directory (FSEvents, inotify). Snapshots are renamed into place, so a reader never sees half a file.
- **Compatibility**: within `schema_version` 1, fields are only added.
