# Init: the project's config

Goal: a project config at `project_config_path` (from `get` scope `config`), outside the repository. The config holds only the keys that differ from the defaults.

1. `get` scope `config`. Keep `effective`, `defaults`, `project_config_path` and `project_config_exists`.
2. **Detect, from the repository:**
   - **Commands**: Makefile targets, `package.json` scripts, `mix.exs`, `pyproject.toml`, `Cargo.toml`, `go.mod`.
   - **Instructions**: every CLAUDE.md (root and nested). Look for the test commands, the commands that run the app, its ports, whether several instances can run side by side (an instance or port variable), demo credentials, and the rules for commits and PRs.
   - **Agents**: the repository's own, in `.claude/agents/*.md`.
   - **Base branch**: `git symbolic-ref refs/remotes/origin/HEAD`, or `gh repo view --json defaultBranchRef`.
   - **PR template**: `.github/pull_request_template.md`.
3. **Propose a JSON** holding only what differs from `defaults`:
   - `tests`:
     - `touched`: one entry per kind of test file, `{match: <glob>, cmd: <command with {files}>}`, the project's way to run some test files (for example `{match: "backend/**/*_test.exs", cmd: "cd backend && mix test {files}"}`);
     - `patterns`: only when the project names its test files differently from the defaults;
     - `suite`: the full suite;
     - `e2e`: the end-to-end suite, if there is one;
     - `suite_runs` and `e2e_runs`: `local` or `ci`. When the project says the full suites belong to CI, use `ci`.
     - `follow`: `project` when the project documents its own testing rules (when tests are required, which ones to run, where), with those files in `rules_from`; otherwise leave `wololo`.
   - `commands.start`:
     - each entry has a `name`, a `cmd`, a `port` and an `env`;
     - when the project supports several instances, use `{slot}` in `port` and `env` (for example `"port": "4000+10*{slot}", "env": {"INST": "{slot}"}`), so parallel runs do not collide;
     - when it does not, warn that two runs in this project will share ports;
   - `commands.app_url`, with `{port}` in it;
   - `commands.login`: how to log in for screenshots, using the demo credentials;
   - `paths.context`: the docs that matter for defining work, such as a how-we-work guide or specs;
   - `pr.base`;
   - `project_agents`: a role mapped to a repository agent;
   - `debate.risk_signals`: the risky domain words the project uses.
4. **Let the person review it**: call `mcp__wololo__review_config {proposal}` with the JSON, then end your turn. The pane shows what was detected, lets them pick the sections to review, one screen per section, and saves the file itself. Their save or cancel reaches you as a message: on save, run `get` scope `config` and fix whatever `errors` lists; on cancel, ask them how to go on.
   - When init runs inside a `full` run, skip the review: Write the JSON at `project_config_path` yourself and record an `assumption`.
   - If `review_config` answers with an error (the pane could not be shown: a narrow terminal, or none to draw on), never tell the person a pane is open. Say in one line that the run needs a config for this project before it starts, show the JSON in a code block with one line per part in plain words, ask with AskUserQuestion (**Guardar (Recomendado)** / **Ajustar** / **Cancelar**), and Write it at `project_config_path` on a yes.

Never write the config into the repository.
