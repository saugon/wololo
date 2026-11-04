# wololo

A Claude Code plugin that takes an issue from definition to a pull request, and always shows **which stage it is in, what is working in the background, and whether it is waiting for you**.

```
/wololo help            # every command and key
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
- **Card** above the prompt, framed in the color of the state: a badge saying what the run is doing (`WORKING`, `WAITING FOR YOU`, `NEEDS PERMISSION`, `AGENTS WORKING`, `RUNNING TESTS`, `WAITING FOR CI`, `BLOCKED`, `STOPPED`, `DONE`), the stage, the detail (the question, or what is being done), a line with the live agents (an icon and a color per role, grouped and counted, with their model and for how long, plus how many finished or failed in the current item or stage), and the stage chips. `m: ▾ more` (a click, or ctrl+x tab then `m`) or `/wololo-more` expands it in place, with two tabs: **Summary** (`r`: stage durations and cost; time by stage, split into working, waiting on agents, tests and CI, waiting for you and paused, with how long each agent role ran in all; usage by stage split by role (the orchestrator, each agent role, and agents outside the run), with the total, cache share and output tokens, one row per live agent and per agent that finished in the current item or stage, with role, model, time and what it does; live tasks, counts, PR, run files, last events) and **History** (`h`: everything that happened; `d` adds agents and tasks). `p` opens the pane, which has the same tabs.
- **Pane** beside the chat: the stages with their durations, the live agents and tasks, the items, and the last events. It opens by itself on a wide terminal; `/wololo panel` opens it otherwise.
- **Status line**: one entry for the run.
- **Notification** when the run starts waiting for you, gets blocked, or finishes.
- `/wololo status` (or `/wololo-status`) shows the runs of every project as a card, one block per run with its badge, stage and what it is doing, without a model turn (`all` adds finished ones). `/wololo` with no arguments summarizes what happened since your last message.
- **History**: what happened, in order and in words: blocks and their reason, every question with the answer given, gates, decisions, assumptions, corrections, commits, the PR. The last events show in the expanded card; `/wololo-history` prints it all (`all` adds agents and tasks), and every run keeps it in `history.md`.
- **Pause**: `/wololo pause` lets the run finish the step in progress, note where it stopped and turn ⏸ PAUSED, with a notice when it is safe to close the session (to restart the machine, say). `/wololo resume` picks it up from that note, in the same session or another.

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

`/wololo init` detects the project's commands, ports, agents and base branch, and walks you through it in a pane: a card with what was detected, then the first-time questions one after another (autonomy, worktree or branch, where the change is approved, how the PR opens, where the suite runs, whether the spec goes into the issue), each with its default picked, and finally save, adjust more by section, or cancel. When the pane cannot be shown, the same questions come in the chat. `/wololo config` opens every setting in a two-column dialog (sections on the left, radios, checkboxes and fields on the right) and saves to this project or to your defaults, validating first. Every key, with its default, is in `hooks/config.ts`. The main ones:

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
| `review.approval` | where the change is approved: `local`, at Aprobar PR in the session, or `pr`, on the PR once CI is green (Aprobar PR passes by itself). `--review-pr` / `--review-local` override it for one run |
| `languages.*` | chat, spec, issue and PR languages |
| `models.<role>`, `project_agents.<role>` | the model per role, or a repository agent in place of wololo's |
| `budgets.*` | design reversals, debate rounds, CI fix attempts, run minutes |
| `mirror.list`, `mirror.run` | show in `/wololo status` the runs another tool drives without a session: the command that lists them (`data.runs`) and the one that says where one stands (`{run}`), both as the JSON protocol of **Adapters** |
| `adapters.<point>` | hand a point of the run (`definition`, `gate_a`, `plan`, `item`, `pr`, `poll`) to another tool; see **Adapters** below |
| `keep_awake` | while a run is active, keep the machine from sleeping (`caffeinate`, macOS), in five-minute leases that lapse on their own when the run or the session ends; for a run left unattended in `full` |
| `risk_paths` | globs: a run whose branch changes a matching path is high risk, and cannot claim less or reach the evidence, Aprobar PR or the PR without `risk.set high` |
| `env.set`, `env.unset` | variables every project command runs with or without (`env -u NAME NAME=value` before each step), so the session's own environment does not leak in |
| `view.*` | header, band (a card above the prompt), pane, status line (off by default: the band says the same), which states notify |
| `view.colors` | the card's colors per group of states (`working`, `waiting`, `blocked`, `done`): a theme key such as `claude` or `warning`, or a hex color. Changes show within 15 s |

### Launch flags

Flags after `/wololo <issue>` change the config for that run only; the run keeps them, `get` scope `config` shows them as `run_flags`, and an unknown flag is refused with the list.

| Flag | Sets |
|---|---|
| `--full`, `--checkpoints`, `--guided` | `autonomy` |
| `--review-pr`, `--review-local` | `review.approval` |
| `--awake`, `--no-awake` | `keep_awake` |
| `--no-adapters` | `adapters` to none |
| `--worktree`, `--in-place` | `isolation` |
| `--base=<branch>` | `pr.base` |
| `--no-pr`, `--draft`, `--ready`, `--no-wait-ci` | `pr.enabled`, `pr.draft`, `pr.wait_ci` |
| `--no-screenshots` | `screenshots.enabled` |
| `--github-spec`, `--no-github-spec` | `spec.to_github` |
| `--debate=`, `--critic=`, `--reviewer=` | `debate.depth`, `debate.critic`, `review.reviewer` |
| `--suite=`, `--e2e=` | `tests.suite_runs`, `tests.e2e_runs` |

```
/wololo 4321 --full --review-pr --awake
/wololo 4321 --checkpoints --no-adapters --in-place
/wololo 4321 --base=release/2.4 --ready --e2e=local
```

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

## Adapters

A project can hand points of a run to its own tooling, such as a delivery runner that already gates, verifies and publishes. `config.adapters.<point>` lists `steps`, each a shell command run in the work tree with `config.env`:

| Field | Meaning |
|---|---|
| `cmd` | the command; `{issue}`, `{branch}`, `{base}`, `{worktree}`, `{run_dir}`, `{sha}` (the work tree's HEAD) and every captured value fill in |
| `capture` | `{name: "data.confirm"}` takes a value from the command's JSON answer, `{name: "/CONFIRM=(\\w+)/"}` from its output |
| `accept_codes` | refusals the step expects (by `code`), which do not block the run |
| `accept_states` | states the tool may leave its own run in while it waits on a person (exit 2), which do not block the run |
| `if_missing`, `if_present` | run the step only when a value was (not) captured before this point started |
| `background` | the command may outlast the ten minutes a step is given: it runs detached, the session waits for it in the background, and the point goes on from it once it ends |
| `status` | while a `background` step runs, a short command whose JSON `state` and `waiting_on` the card shows, at most once a minute |

`replaces: true` on a point means the tool does that stage's work instead of wololo. A command is read as the JSON protocol `{ok, state, waiting_on, unblock, code, message, data}` with exit codes 0, 1, 2 (waits on a person) and 3 (goes on by itself). A refusal blocks the run with the tool's message; a wait on a person blocks it with what to do; a wait on the machine shows as what the run is doing.

A runner that speaks that protocol, as `make agent.*` with `JSON=1` does. Its checks of a branch can take longer than ten minutes, so they run in the background; the issue's spec is the runner's, so wololo leaves the issue alone:

```json
{
  "spec": { "to_github": false },
  "env": { "unset": ["INST", "E2E_BACKEND_PORT", "E2E_WEB_PORT_BASE"] },
  "adapters": {
    "plan": { "steps": [{ "cmd": "make agent.plan ISSUE={issue} JSON=1", "capture": { "confirm": "data.confirm" } }] },
    "item": { "steps": [
      { "cmd": "make inst.claim", "if_missing": "runner_run" },
      { "cmd": "make agent.adopt ISSUE={issue} CONFIRM={confirm} JSON=1", "if_missing": "runner_run", "background": true,
        "status": "make agent.status ISSUE={issue} JSON=1",
        "capture": { "runner_run": "run", "publish_hash": "/CONFIRM=(\\w+)/" }, "accept_states": ["verified"] },
      { "cmd": "make agent.verify RUN={runner_run} SHA={sha} JSON=1", "if_present": "runner_run", "background": true,
        "status": "make agent.status RUN={runner_run} JSON=1",
        "capture": { "publish_hash": "/CONFIRM=(\\w+)/" }, "accept_states": ["verified"] }
    ] },
    "pr": { "replaces": true, "steps": [{ "cmd": "make agent.publish RUN={runner_run} CONFIRM={publish_hash} JSON=1",
      "capture": { "pr_url": "data.pr" }, "accept_states": ["awaiting_approval", "awaiting_merge"] }] },
    "poll": { "steps": [{ "cmd": "make agent.step RUN={runner_run} JSON=1", "accept_states": ["awaiting_approval", "awaiting_merge"] }] }
  }
}
```

For the runs its watcher drives without a session, `"mirror": { "list": "make agent.status JSON=1", "run": "make agent.status RUN={run} JSON=1" }` puts each one that has not ended in `/wololo status`, with what it waits on and, when that is you, the command that unblocks it.

The run plans and implements in the session; the runner takes the branch after the first item, verifies each next item with its own gates and reviewer, publishes and follows CI. A step without `background` runs at most ten minutes. A `background` step lives on if the session closes; a run resumed later waits for it, and one that died without an exit code blocks the run.

