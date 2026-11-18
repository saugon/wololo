# wololo

A Claude Code plugin that takes an issue to a pull request, and always shows which stage it is in, what is running and whether it is waiting for you.

## Highlights

- 🧭 One command from issue to PR: context, spec, plan, implementation, screenshots, PR and CI.
- ✋ You approve twice, the spec and the PR, or never, or at every doubt.
- 🥊 Specs and plans are debated before any code is written, by Claude or an external model such as Codex.
- 👀 A card above the prompt and a side pane say what the run is doing at every moment.
- 🌳 Each run works in its own worktree, branch and ports, so several run in parallel.
- 🗂️ Nothing goes into your repository: config and runs live in `~/.claude/wololo`.
- 🖥️ [Wololo Desk](docs/desktop-app.md), a macOS app with the runs of every terminal.

## Installation

```sh
git clone https://github.com/saugon/wololo ~/saugon/wololo
ln -s ~/saugon/wololo ~/.claude/skills/wololo
```

A folder in `~/.claude/skills` loads as both the `/wololo` skill and its plugin.

## Getting started

Set up a project once, from its repository:

```
/wololo init
```

It detects the project's commands, ports and base branch, and asks a few questions with their defaults picked.

Then hand it an issue:

```
/wololo #4312
```

wololo reads the issue and the code, writes a spec and asks you to approve it. Then it plans, implements item by item with tests and review, takes screenshots, and asks you to approve the PR. It opens it, watches CI and fixes what fails.

```
context → definition → approve spec → plan → implement → evidence → approve PR → pr
```

## Usage

Start a run from an issue, a text or a plan file:

```
/wololo #4312
/wololo https://github.com/acme/shop/issues/4312
/wololo "let waiters split a bill in several payments"
/wololo docs/plans/kds.md
```

Choose how much it asks:

```
/wololo #4312 --full          # never asks, unless something is blocking
/wololo #4312 --checkpoints   # asks at the spec and the PR (the default)
/wololo #4312 --guided        # also asks at every ambiguity
```

Follow and steer it:

```
/wololo              # what happened since your last message
/wololo status       # the runs of every project
/wololo panel        # the side pane
/wololo pause        # stop after the current step
/wololo resume       # pick it up again, here or in another session
/wololo done         # end a run in review
/wololo cancel
```

Change the settings:

```
/wololo config
```

`/wololo help` lists every command and flag.

## Documentation

- [Stages](docs/stages.md): what each stage does, and the autonomy modes.
- [Seeing what it does](docs/seeing-what-it-does.md): the card, the pane, the history, pause and `/clear`.
- [Configuration](docs/configuration.md): every setting and launch flag.
- [Adapters](docs/adapters.md): hand parts of a run to your project's own tooling.
- [The store](docs/store.md): the run files, for dashboards.
- [Wololo Desk](docs/desktop-app.md): the desktop app and its themes.

## Development

```sh
make check   # unit tests, plugin validation and Wololo Desk's tests
make help    # every target
```
