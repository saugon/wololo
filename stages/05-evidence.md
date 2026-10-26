# Stage 5: evidence

Goal: up to `config.screenshots.max` screenshots of what changed, saved in `run_dir/screenshots/`. Every server and browser the stage starts is stopped before it ends.

1. `event stage.entered {stage: "evidence"}`.
2. **Decide whether it applies.** Skip the screenshots when:
   - the change is not visible in a browser (no UI files, no visible behaviour);
   - `config.screenshots.enabled` is false;
   - or no Playwright browser tools are available.

   To skip: `event stage.completed {stage: "evidence", note: "<why>"}` and go on.
3. **Servers.** For each entry of `ports` from `start` (`name`, `port`, `cmd`, `env`):
   - **Something already listens on the port** (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`):
     - reuse it only if its working directory is inside this run's worktree (`lsof -a -p <pid> -d cwd -Fn`);
     - otherwise it belongs to another run or to the person: do not touch it. In `full`, skip the screenshots with a note; in the other modes, ask.
   - **Nothing listens:** start it in the background in the worktree, with its env (`cd <worktree> && <ENV=…> <cmd>`, `run_in_background`).
     - Then wait for the port in one command: `for i in $(seq 60); do lsof -nP -iTCP:<port> -sTCP:LISTEN -t && break; sleep 2; done`.
     - Record its pid and port in `run_dir/servers.json`.
4. **Log in** if `config.commands.login` says how. Use the project's demo credentials from its CLAUDE.md, never real ones.
5. **Capture** at most `config.screenshots.max` screens, chosen for the acceptance scenarios they prove.
   - Save each as `run_dir/screenshots/NN-<slug>.png`.
   - Record `screenshot.saved {file, caption}`, with a caption in `config.languages.pr`.
6. **Stop everything you started, always, even after a failure.**
   - Close the browser.
   - Kill the servers recorded in `servers.json`.
   - Check that each port is free again.
   - Never stop a server you reused.
7. `event stage.completed {stage: "evidence"}`, then go to `stages/gates.md` for gate_b.
