# wololo

A Claude Code plugin that takes an issue from definition to a pull request, and always shows **which stage it is in, what is working in the background, and whether it is waiting for you**.

```
/wololo #4312
/wololo "let waiters split a bill in several payments"
/wololo docs/plans/kds.md --guided
```

## Stages

```
context → definition → gate A → plan → implement → evidence → gate B → pr
```

| Stage | What happens |
|---|---|
| context | Reads the issue and explores the code with parallel explorers; estimates the risk. |
| definition | Writes the spec (outcome, scope, non-goals, acceptance scenarios, assumptions) and debates it: self-critique for low risk, an adversarial critic (Claude or an external model such as Codex) for high risk. |
| gate A | You approve the spec; the issue body is updated with it. |
| plan | Architects propose small, verifiable items; the plan is debated the same way. |
| implement | Per item: implementer → the tests the run touched → reviewer → commit, with a log of every decision and correction. After the last item, the full suite (locally, or left to CI). |
| evidence | Up to 5 screenshots of what changed. Starts the servers it needs on the run's own ports, and stops them afterwards. |
| gate B | You approve opening the PR. |
| pr | Pushes the run branch, opens a draft PR, watches CI, fixes failures within a budget, marks it ready when green. |

**Autonomy** is per project, and per run with `--full`, `--checkpoints` or `--guided`:

- **full** never asks, except for a blocking condition: something destructive, the spec contradicting the code, a test that would be deleted, an exhausted budget.
- **checkpoints** (the default) stops at the two gates.
- **guided** also asks at every relevant ambiguity.

What it decides on its own is recorded as an assumption, shown at the gates and in the PR.

## Seeing what it does

- **Header** on each reply: `[wololo #4312 · ③ Plan · ⟳ 2 agents]`, or `[wololo #4312 · Gate A · ❓ WAITING FOR YOU 3m]`.
- **Band** above the prompt: the stage, what is running and for how long, and the stage pills.
- **Pane** beside the chat: the stages with their durations, the live agents and tasks, the items, and the last events. It opens by itself on a wide terminal; `/wololo panel` opens it otherwise.
- **Status line**: one entry for the run.
- **Notification** when the run starts waiting for you, gets blocked, or finishes.
- `/wololo status` lists the runs of every project. `/wololo` with no arguments summarizes what happened since your last message.

The state is derived from what the session does, not from what the model says:

- a question dialog open → waiting for you;
- a permission dialog → waiting for a permission;
- background agents or jobs alive → waiting on them;
- a CI watch → waiting on CI;
- a turn that ended with none of these → stopped. A full run is woken up twice, then marked blocked.

## Install

```sh
git clone <this repo> ~/saugon/wololo
ln -s ~/saugon/wololo ~/.claude/skills/wololo
```

A folder in `~/.claude/skills` is loaded as both the `/wololo` skill and the plugin that holds the mod.

## Configure

Nothing is written into your repositories. All configuration and run data live in the data directory: `~/.claude/wololo` by default. To change it, set `data_dir` in `/config` (or `pluginConfigs` in `~/.claude/settings.json`).

```
<data>/config.json                          your defaults
<data>/projects/<owner>__<repo>/config.json per project (overrides the defaults)
```

`/wololo init` detects the project's commands, ports, agents and base branch, and proposes the project file. `/wololo config` shows the effective config. Every key, with its default, is in `hooks/config.ts`. The main ones:

| Key | What |
|---|---|
| `autonomy` | `full`, `checkpoints` or `guided` |
| `paths.context` | docs and folders the context stage reads first |
| `debate.depth`, `debate.critic`, `debate.external_cmd` | how hard specs and plans are challenged, and by whom |
| `review.reviewer` | `claude`, `external` or `both` |
| `isolation`, `worktree_dir`, `branch` | a worktree per run, or a branch in place |
| `tests.touched` | how to run some test files: `{match: <glob>, cmd: "... {files}"}`. During development, wololo runs the tests the run created or changed |
| `tests.suite`, `tests.e2e`, `tests.suite_runs`, `tests.e2e_runs` | the full suites, run once at the end, `local` or left to `ci` |
| `tests.follow`, `tests.rules_from` | `project` makes the project's own testing rules (in those files) win over wololo's |
| `tests.background` | long suites run in the background; the run shows "running tests" |
| `commands.start`, `commands.app_url`, `commands.login` | how to run the app for screenshots; `{slot}` gives each parallel run its own ports |
| `pr.*` | open a PR, as a draft, wait for CI, and the base branch |
| `languages.*` | chat, spec, issue and PR languages |
| `models.<role>`, `project_agents.<role>` | the model per role, or a repository agent in place of wololo's |
| `budgets.*` | design reversals, debate rounds, CI fix attempts, run minutes |
| `view.*` | header, band, pane, status line, which states notify |

## The store, for dashboards

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
- **Live updates**: watch the directory (FSEvents, inotify). Snapshots are renamed into place, so a reader never sees half a file.
- **Compatibility**: within `schema_version` 1, fields are only added.

## Develop

```sh
tsc -p .                 # type-check (types in .claude-plugin/types)
claude plugin test .     # unit tests
claude plugin validate .
```
