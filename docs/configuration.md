# Configuration

Nothing is written into your repositories. All configuration and run data live in the data directory: `~/.claude/wololo` by default. To change it, set `data_dir` in `/config` (or `pluginConfigs` in `~/.claude/settings.json`).

```
<data>/config.json                          your defaults
<data>/projects/<owner>__<repo>/config.json per project (overrides the defaults)
```

`/wololo init` detects the project's commands, ports, agents, base branch and delivery runner (one that speaks the adapters' protocol, which it proposes as `adapters`), and walks you through it in a pane: a card with what was detected, then the first-time questions one after another (who delivers the change, the runner or wololo, when it found one; autonomy, worktree or branch, where the change is approved, how the PR opens, where the suite runs, whether the spec goes into the issue), each with its default picked, and finally save, adjust more by section, or cancel. The pane opens as soon as you type the `/wololo` that needs it, so it is drawn at any terminal width, and shows that the repository is being read until the proposal arrives. When it cannot be shown (you closed it, or there is no terminal), the same questions come in the chat. `/wololo config` opens every setting in a two-column dialog (sections on the left, radios, checkboxes and fields on the right) and saves to this project or to your defaults, validating first. Every key, with its default, is in `hooks/config.ts`. The main ones:

| Key | What |
|---|---|
| `autonomy` | `full`, `checkpoints` or `guided` |
| `paths.context` | docs and folders the context stage reads first |
| `debate.depth`, `debate.critic`, `debate.external_cmd` | how hard specs and plans are challenged, and by whom |
| `review.reviewer` | `claude`, `external` or `both` |
| `review.final.skill`, `review.final.args` | a skill that reviews the whole change after the last item, such as `code-review` with `high {branch}`: the run fixes what it finds and reviews again, and the implement stage ends only once it passes on the code as committed. `{base}` and `{branch}` fill in. Empty: no final review |
| `isolation`, `worktree_dir`, `branch` | a worktree per run, or a branch in place. `branch` takes `{ref}` (the issue number or plan name; nothing for free text) and `{slug}`: the title's at the start, and at the plan stage a few words the run picks from the spec, while the branch is not on origin yet |
| `tests.touched` | how to run some test files: `{match: <glob>, cmd: "... {files}"}`. During development, wololo runs the tests the run created or changed |
| `tests.suite`, `tests.e2e`, `tests.suite_runs`, `tests.e2e_runs` | the full suites, run once at the end, `local` or left to `ci` |
| `tests.follow`, `tests.rules_from` | `project` makes the project's own testing rules (in those files) win over wololo's |
| `tests.background` | long suites run in the background; the run shows "running tests" |
| `commands.prepare`, `commands.start`, `commands.app_url`, `commands.login` | how to run the app, for the screenshots and for **Probar localmente** at Aprobar PR: what to run once per run before the first start (dependencies, the instance's database), and the servers; `{slot}` gives each parallel run its own ports |
| `instance.read`, `instance.databases`, `instance.release` | when the project keeps its own registry of instances (one per worktree): the command that prints the work tree's instance number, which the run's slot then follows (so `{slot}` gives that instance's ports), that instance's databases (`{slot}`), shown in the summary with the connections open to each and the local Postgres' total against its `max_connections`, and the command that gives the instance back when the run finishes, once its servers are down |
| `spec.to_github` | `true` publishes a short version of the spec in the issue; `false` keeps it in the run's files only. An issue write you ask for yourself during the run still goes out |
| `pr.*` | open a PR, as a draft, wait for CI, and the base branch |
| `review.approval` | where the change is approved: `local`, at Aprobar PR in the session, or `pr`, on the PR once CI is green (Aprobar PR passes by itself). `--review-pr` / `--review-local` override it for one run |
| `languages.*` | chat, spec, issue and PR languages |
| `models.<role>`, `project_agents.<role>` | the model per role, or a repository agent in place of wololo's |
| `budgets.*` | design reversals, debate rounds, CI fix attempts, run minutes |
| `mirror.list`, `mirror.run` | show in `/wololo status` the runs another tool drives without a session: the command that lists them (`data.runs`) and the one that says where one stands (`{run}`), both as the JSON protocol of [adapters](adapters.md) |
| `adapters.<point>` | hand a point of the run (`definition`, `gate_a`, `plan`, `item`, `pr`, `poll`) to another tool; see [adapters](adapters.md) |
| `keep_awake` | while a run is active, keep the machine from sleeping (`caffeinate`, macOS), in five-minute leases that lapse on their own when the run or the session ends; for a run left unattended in `full` |
| `risk_paths` | globs: a run whose branch changes a matching path is high risk, and cannot claim less or reach the evidence, Aprobar PR or the PR without `risk.set high` |
| `env.set`, `env.unset` | variables every project command runs with or without (`env -u NAME NAME=value` before each step), so the session's own environment does not leak in |
| `view.*` | header, band (a card above the prompt), pane, status line (off by default: the band says the same), which states notify |
| `view.colors` | the card's colors per group of states (`working`, `waiting`, `blocked`, `done`): a theme key such as `claude` or `warning`, or a hex color. Changes show within 15 s |

## Launch flags

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
| `--final-review=<skill>`, `--final-review-args=<args>`, `--no-final-review` | `review.final.skill`, `review.final.args` |
| `--suite=`, `--e2e=` | `tests.suite_runs`, `tests.e2e_runs` |
| `--node=<goal>/<node>` | nothing: Wololo Desk adds it when it starts a run from a goal's node, so the node finds the run even without an issue |

```
/wololo 4321 --full --review-pr --awake
/wololo 4321 --checkpoints --no-adapters --in-place
/wololo 4321 --base=release/2.4 --ready --e2e=local
```
