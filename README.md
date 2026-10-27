# wololo

A Claude Code plugin that takes an issue from definition to a pull request, and always shows **which stage it is in, what is working in the background, and whether it is waiting for you**.

```
/wololo #4312
/wololo "let waiters split a bill in several payments"
/wololo docs/plans/kds.md --guided
```

## Stages

```
context → definition → approve spec → plan → implement → evidence → approve PR → pr
```

| Stage | What happens |
|---|---|
| context | Reads the issue and explores the code with parallel explorers; estimates the risk. |
| definition | Writes the spec (outcome, scope, non-goals, acceptance scenarios, assumptions) and debates it: self-critique for low risk, an adversarial critic (Claude or an external model such as Codex) for high risk. |
| approve spec (`gate_a`) | You approve the spec. With `spec.to_github`, a short version goes into the issue body, or a summary when it is longer than GitHub accepts. |
| plan | Architects propose small, verifiable items; the plan is debated the same way. |
| implement | Per item: implementer → the tests the run touched → reviewer → commit, with a log of every decision and correction. After the last item, the full suite (locally, or left to CI). |
| evidence | Up to 5 screenshots of what changed. Starts the servers it needs on the run's own ports, and stops them afterwards. |
| approve PR (`gate_b`) | You approve opening the PR. |
| pr | Pushes the run branch, opens a draft PR, watches CI, fixes failures within a budget, marks it ready when green. |

**Autonomy** is per project, and per run with `--full`, `--checkpoints` or `--guided`:

- **full** never asks, except for a blocking condition: something destructive, the spec contradicting the code, a test that would be deleted, an exhausted budget.
- **checkpoints** (the default) stops at the two gates.
- **guided** also asks at every relevant ambiguity.

What it decides on its own is recorded as an assumption, shown at the gates and in the PR.

## Seeing what it does

- **Header** on each reply: `[wololo #4312 · 4/8 Plan · ⟳ agents working: 2 architects (5m)]`, or `[wololo #4312 · 3/8 Approve spec · ? waiting for you: … · 3m ago]`.
- **Card** above the prompt, framed in the color of the state: a badge saying what the run is doing (`WORKING`, `WAITING FOR YOU`, `NEEDS PERMISSION`, `AGENTS WORKING`, `RUNNING TESTS`, `WAITING FOR CI`, `BLOCKED`, `STOPPED`, `DONE`), the stage, the detail (the question, the agents and for how long), and the stage chips. `m: ▾ more` (a click, or ctrl+x tab then `m`) or `/wololo-more` expands it in place, with two tabs: **Summary** (`r`: stage durations, live agents and tasks, counts, PR, run files, last events) and **History** (`h`: everything that happened; `d` adds agents and tasks). `p` opens the pane, which has the same tabs.
- **Pane** beside the chat: the stages with their durations, the live agents and tasks, the items, and the last events. It opens by itself on a wide terminal; `/wololo panel` opens it otherwise.
- **Status line**: one entry for the run.
- **Notification** when the run starts waiting for you, gets blocked, or finishes.
- `/wololo status` (or `/wololo-status`) shows the runs of every project as a card, one block per run with its badge, stage and what it is doing, without a model turn (`all` adds finished ones). `/wololo` with no arguments summarizes what happened since your last message.
- **History**: what happened, in order and in words: blocks and their reason, every question with the answer given, gates, decisions, assumptions, corrections, commits, the PR. The last events show in the expanded card; `/wololo-history` prints it all (`all` adds agents and tasks), and every run keeps it in `history.md`.

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
| `spec.to_github` | `true` publishes a short version of the spec in the issue; `false` keeps it in the run's files only |
| `pr.*` | open a PR, as a draft, wait for CI, and the base branch |
| `languages.*` | chat, spec, issue and PR languages |
| `models.<role>`, `project_agents.<role>` | the model per role, or a repository agent in place of wololo's |
| `budgets.*` | design reversals, debate rounds, CI fix attempts, run minutes |
| `view.*` | header, band (a card above the prompt), pane, status line (off by default: the band says the same), which states notify |
| `view.colors` | the card's colors per group of states (`working`, `waiting`, `blocked`, `done`): a theme key such as `claude` or `warning`, or a hex color. Changes show within 15 s |

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
