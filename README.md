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
| approve PR (`gate_b`) | You approve opening the PR. **Probar localmente** starts the app on the run's ports first, so you try the change before approving. |
| pr | Pushes the run branch, opens a draft PR, watches CI, fixes failures within a budget, marks it ready when green. Then the run stays **in review**: changes the review asks for go through the implement loop, and the run ends when the PR merges (checked every 5 minutes while a session holds it), when the person ends it with `/wololo done`, or, if the PR is closed without merging, as the person decides. |

**Autonomy** is per project, and per run with `--full`, `--checkpoints` or `--guided`:

- **full** never asks, except for a blocking condition: something destructive, the spec contradicting the code, a test that would be deleted, an exhausted budget.
- **checkpoints** (the default) stops at the two gates.
- **guided** also asks at every relevant ambiguity.

What it decides on its own is recorded as an assumption, shown at the gates and in the PR.

## Seeing what it does

- **Header** on each reply: `[wololo #4312 · 4/8 Plan · ⟳ agents working: 2 architects (5m)]`, or `[wololo #4312 · 3/8 Approve spec · ? waiting for you: … · 3m ago]`.
- **Card** above the prompt, framed in the color of the state: a badge saying what the run is doing (`WORKING`, `WAITING FOR YOU`, `NEEDS PERMISSION`, `AGENTS WORKING`, `RUNNING TESTS`, `WAITING FOR CI`, `BLOCKED`, `STOPPED`, `IN REVIEW`, `DONE`), the stage, the detail (the question, or what is being done), a line with the live agents (an icon and a color per role, grouped and counted, with their model and for how long, plus how many finished or failed in the current item or stage), and the stage chips. `m: ▾ more` (a click, or ctrl+x tab then `m`) or `/wololo-more` expands it in place, with four tabs: **Summary** (`r`: what is going on now, the background shells, the stages with their active time, total time and cost, and git, ports and path), **Detail** (`d`: time by stage, active (without the waits for you and the pauses) beside the total, each rounded up, and split into working, waiting on agents, tests and CI, waiting for you and paused, with how long each agent role ran in all; usage by stage split by role (the orchestrator, each agent role, and agents outside the run), with the total, cache share and output tokens; one row per live agent and per agent that finished in the current item or stage, with role, model, time and what it does; mode, risk and counts, PR, run files, last events), **Items** (`i`) and **History** (`h`: everything that happened; `c` adds agents and tasks). Expanded, the card shows the whole tab, and the mouse wheel over it scrolls it. `/wololo panel` opens the pane, which has the same tabs.
- **Pane** beside the chat, each section labelled in a left gutter (above it, below 70 columns): the state as a badge with how long it has held, the stage with its bar and chips, then the tabs. Summary has *now* (the question or block, the item, each live agent with what it does), *processes* (background shells by port and name; one started again is one row with each run's age and how many), *stages* (active, total, cost, and the total of each) and *git*, *ports*, *path*. A background shell's port comes from its command (`PORT=`, `--port`, `-p`) or its description. It opens by itself on a wide terminal; `/wololo panel` opens it otherwise.
- **Status line**: one entry for the run.
- **Notification** when the run starts waiting for you, gets blocked, or finishes.
- `/wololo status` (or `/wololo-status`) shows the runs of every project as a card, one block per run with its badge, stage and what it is doing, without a model turn (`all` adds finished ones). `/wololo` with no arguments summarizes what happened since your last message.
- **History**: what happened, in order and in words: blocks and their reason, every question with the answer given, gates, decisions, assumptions, corrections, commits, the PR. The last events show in the expanded card; `/wololo-history` prints it all (`all` adds agents and tasks), and every run keeps it in `history.md`.
- **Pause**: `/wololo pause` lets the run finish the step in progress, note where it stopped and turn ⏸ PAUSED, with a notice when it is safe to close the session (to restart the machine, say). `/wololo resume` picks it up from that note, in the same session or another.
- **/clear**: the new conversation knows nothing of the run, so the run does not follow it: it turns ⏸ PAUSED where it was, its card and pane go away, and `/wololo resume <run>` takes it back (right away in the same terminal), to go on or to cancel it.

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

`/wololo init` detects the project's commands, ports, agents, base branch and delivery runner (one that speaks the adapters' protocol, which it proposes as `adapters`), and walks you through it in a pane: a card with what was detected, then the first-time questions one after another (who delivers the change, the runner or wololo, when it found one; autonomy, worktree or branch, where the change is approved, how the PR opens, where the suite runs, whether the spec goes into the issue), each with its default picked, and finally save, adjust more by section, or cancel. The pane opens as soon as you type the `/wololo` that needs it, so it is drawn at any terminal width, and shows that the repository is being read until the proposal arrives. When it cannot be shown (you closed it, or there is no terminal), the same questions come in the chat. `/wololo config` opens every setting in a two-column dialog (sections on the left, radios, checkboxes and fields on the right) and saves to this project or to your defaults, validating first. Every key, with its default, is in `hooks/config.ts`. The main ones:

| Key | What |
|---|---|
| `autonomy` | `full`, `checkpoints` or `guided` |
| `paths.context` | docs and folders the context stage reads first |
| `debate.depth`, `debate.critic`, `debate.external_cmd` | how hard specs and plans are challenged, and by whom |
| `review.reviewer` | `claude`, `external` or `both` |
| `isolation`, `worktree_dir`, `branch` | a worktree per run, or a branch in place. `branch` takes `{ref}` (the issue number or plan name; nothing for free text) and `{slug}`: the title's at the start, and at the plan stage a few words the run picks from the spec, while the branch is not on origin yet |
| `tests.touched` | how to run some test files: `{match: <glob>, cmd: "... {files}"}`. During development, wololo runs the tests the run created or changed |
| `tests.suite`, `tests.e2e`, `tests.suite_runs`, `tests.e2e_runs` | the full suites, run once at the end, `local` or left to `ci` |
| `tests.follow`, `tests.rules_from` | `project` makes the project's own testing rules (in those files) win over wololo's |
| `tests.background` | long suites run in the background; the run shows "running tests" |
| `commands.prepare`, `commands.start`, `commands.app_url`, `commands.login` | how to run the app, for the screenshots and for **Probar localmente** at Aprobar PR: what to run once per run before the first start (dependencies, the instance's database), and the servers; `{slot}` gives each parallel run its own ports |
| `instance.read`, `instance.databases` | when the project keeps its own registry of instances (one per worktree): the command that prints the work tree's instance number, which the run's slot then follows (so `{slot}` gives that instance's ports), and that instance's databases (`{slot}`), shown in the summary with the connections open to each and the local Postgres' total against its `max_connections` |
| `spec.to_github` | `true` publishes a short version of the spec in the issue; `false` keeps it in the run's files only. An issue write you ask for yourself during the run still goes out |
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
- **One writer**: only the mod instance that owns the session writes a run. Files written before that rule may repeat a `seq`, so sort by `seq` stably, keeping file order among equals.
- **Live updates**: watch the directory (FSEvents, inotify). Snapshots are renamed into place, so a reader never sees half a file.
- **Compatibility**: within `schema_version` 1, fields are only added.

## Desktop app

**Wololo Desk** (`app/`) shows the runs of every terminal and project in one place:

- **Menu bar**: an icon with how many runs are waiting for you, and a menu to show the widget, open the window, the settings, or quit.
- **Widget**: a floating panel over every space and full-screen app, with the active runs, those waiting for you first. ⌘⇧L shows or hides it from any app.
- **Window**: a sidebar by project and a board of cards by status or by stage, with search.
- **Detail**: a run's stages, what it is doing or waiting on, items, agents, PR and CI, timeline, documents, screenshots and cost. **Ir a la terminal** (also on each widget row) brings the iTerm2 or Ghostty tab of its session to the front, or opens one in its directory and copies `/wololo resume <run>`.

It only reads the store, except **Descartar** in a run's detail: for a run no session holds anymore (paused or orphaned, no heartbeat for 90 s), it records `run.finished {outcome: cancelled}` and its snapshot, as the mod's cancel would, after a confirmation. The worktree, branch and files stay in place. The data directory is `WOLOLO_DATA_DIR`, else the one set in its settings, else `~/.claude/wololo`.

```sh
make app       # app/scripts/build-app.sh: app/dist/Wololo Desk.app, signed ad hoc
make install   # app/scripts/build-app.sh --install: and copies it to ~/Applications
```

`--install` replaces an existing `~/Applications/Wololo Desk.app` only if it is a Wololo Desk build. The first **Ir a la terminal** asks for the Automation permission for each terminal; if it was denied, allow it in System Settings → Privacy & Security → Automation. Requires macOS 14 and Swift 5.9 or later.

To develop:

```sh
cd app && swift build && swift test           # WololoKit has the tests
scripts/sample-data.sh /tmp/wololo-sample     # a data directory with sample runs
WOLOLO_DATA_DIR=/tmp/wololo-sample .build/debug/WololoDesk
```

To check the UI without screen recording, `WOLOLO_DESK_SNAPSHOT=<png>` draws what `WOLOLO_DESK_OPEN` asks for (`window`, `widget`, `settings` or `run:<id>[:timeline|documents|screenshots|cost]`) and quits; `WOLOLO_DESK_SEARCH`, `WOLOLO_DESK_PROJECT` and `WOLOLO_DESK_COLUMNS` (`status` or `stage`) set the board's filters, and `WOLOLO_DESK_THEME` and `WOLOLO_DESK_THEMES_DIR` the theme (see **Themes**). The sample runs' times are relative to when `sample-data.sh` ran, so run it again right before a snapshot.

### Themes

A theme changes how Wololo Desk looks (colors, fonts, textures, frames, separators, icons, the shape of the progress bar) and the names of the columns and sidebar sections. It never changes the layout: positions, sizes and which sections exist stay the same in every theme. It is picked in **Ajustes → Apariencia → Tema**, applies at once to the window, the detail, the widget, Settings and the toasts, and is kept for the next launch; a saved theme that is gone or broken by then gives Actual.

- **Actual**: the look from before themes, with system fonts, a continuous progress bar and round dots. The default.
- **AoE**: the Age of Empires look: a dark texture, a double rod between the sidebar and the board, a braided band, Cinzel headings, a bar of 8 gold blocks, hoods and gems, and period names (Resisting, Converting, Idle, Unit ready; Buildings).

Your own themes are the folders of `~/Library/Application Support/Wololo Desk/Themes/`, each with a `theme.json` and the files it names: `Themes/<folder>/theme.json`. The folder's name is the theme's key, and `actual` and `aoe` are reserved. **Abrir carpeta de temas** opens that folder, creating it if needed. **Duplicar el tema elegido como tema propio** copies the theme in use, files included, into `<key>-copia` and switches to it, which is the easiest starting point. **Recargar temas** reads the folder again after you edit a theme; nothing reloads on its own.

`theme.json` is version 1. Every key but `version` is optional, and what a theme leaves out comes from Actual, so a theme can be a single color:

```json
{ "version": 1, "name": "Violeta", "colors": { "surface": "#3a2a4a" } }
```

| Key | What |
|---|---|
| `version` | `1`, the only version understood |
| `name`, `author`, `id` | the name Settings shows (by default, the folder's), and who made it; the key is always the folder's name |
| `colors.ground`, `sidebar`, `surface`, `surfaceHover`, `field` | backgrounds: window, sidebar, cards, a hovered card, fields |
| `colors.border`, `borderHover`, `divider`, `cardDivider`, `rowDivider` | borders and dividers |
| `colors.title`, `heading`, `text`, `secondary`, `muted`, `faint`, `pendingMark`, `agent` | text, from strongest to faintest, pending marks and agents |
| `colors.accent`, `focus`, `selection` | links, toggles and the logo; the focus ring and the selected card; the selection |
| `colors.widget`, `widgetBorder`, `widgetHover` | the widget |
| `colors.status.<status>` | `color`, `badge`, `badgeText`, `activity` and `hood` for `waiting`, `permission`, `blocked`, `stalled`, `running`, `agents`, `tests`, `ci`, `pausing`, `paused`, `review`, `orphaned`, `done`, `failed` or `cancelled`; `hood` overrides the column's |
| `colors.columns.<column>` | `icon`, `title` and `hood` (the cards' hood; the icon's color if unset) for `waiting`, `working`, `review`, `onHold` (the section under the board) or `finished` |
| `colors.bar` | `fill`, `"status"` (the column's color) or a color, and `track` |
| `colors.ci` | `pending`, `passing`, `failing`, `none` |
| `fonts.display`, `body`, `mono` | `family` (empty is the system font), `file` (a font file in the theme's folder, loaded for the app only), `weight` (CSS-style: 400 regular, 700 bold; 1 to 1000) and `tracking` (in em, like CSS `letter-spacing`) |
| `images.background` | `file`, a texture tiled behind everything, and its `size` |
| `images.divider` | `file`, the vertical divider between the sidebar and the board, and its `width` |
| `images.frame` | `file`, a 9-slice frame for cards, the counters box and the segmented control, with its `slice` (in pixels of the file, like CSS `border-image-slice`) and its drawn `width` |
| `images.band` | `file`, the horizontal band under the board's header and over the archive, and its `height` |
| `shapes.radius` | the cards' corner radius (Actual's is 10); the other radii scale with it, and 0 squares them all |
| `shapes.bar`, `bullet` | `continuous` or `blocks` (one per stage); `dot` or `gem` |
| `shapes.statusIcon` | the card's status icon: `dot`, `hood` or `image:<file>` |
| `shapes.columnIcons.<column>`, `projectIcon` | `dot`, `symbol:<SF Symbol>`, `builtin:<name>` (AoE's `resisting`, `converting`, `researching`, `idle`, `unitReady`, `castle`) or `image:<file>` |
| `texts.columns.<column>` | `title` and `subtitle` (an empty one removes the base's); `onHold`'s title names the section under the board |
| `texts.waitingSection`, `projectsSection`, `all`, `boardTitle`, `counterWorking`, `counterWaiting`, `archive`, `empty` | the sidebar's sections, the board's title and counters, the archive and the empty column |

Colors are `#rrggbb` or `#rrggbbaa`, sizes are in points, and files are paths inside the theme's folder. Statuses, stages and what the runs say cannot be renamed. `Resources/Themes/aoe/theme.json` in `app/Sources/WololoDesk` is a complete example.

A theme is untrusted input, and is checked before use:

- **Unusable**: invalid JSON, a version other than 1, a malformed color, an unknown value (a status, a bar shape, an icon), an image without its file or size, or a path that leaves the theme's folder (absolute, `~`, `..`, or a symlink pointing out). The picker shows it disabled, and Settings says why under **No se pueden elegir**.
- **Warning**: a file that is not there, an image that does not load, a font that is not available. The theme is used without it (no texture, the system font) and Settings says what is missing.

Neither breaks the app. For one launch, `WOLOLO_DESK_THEME=<key>` uses that theme without saving it, and `WOLOLO_DESK_THEMES_DIR=<dir>` reads your themes from `<dir>` instead of Application Support (duplicates go there too).

The fonts AoE uses ship inside the app, so they need not be installed: Cinzel, Source Sans 3 and JetBrains Mono, all under the SIL Open Font License 1.1. Each licence is next to its font in `app/Sources/WololoDesk/Resources/Fonts` (`OFL-Cinzel.txt`, `OFL-SourceSans3.txt`, `OFL-JetBrainsMono.txt`) and in the `.app`'s resource bundle.

## Develop

```sh
make typecheck   # tsc -p . (types in .claude-plugin/types)
make test        # claude plugin test .: unit tests
make validate    # claude plugin validate .
make app-test    # cd app && swift test: Wololo Desk (see Desktop app)
make app         # Wololo Desk.app in app/dist
make check       # test, validate and app-test
```

`make help` lists the targets.

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

