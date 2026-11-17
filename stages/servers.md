# Servers

How the run starts the project's app, for the screenshots (`stages/05-evidence.md`) and for the person to try the change at Aprobar PR (`stages/gates.md`). The ports are the run's: take them from `mcp__wololo__get {scope: "run"}` (`ports`: `name`, `port`, `cmd`, `env`), which follows the slot when it changed since `start`.

1. **Prepare, once per run.** When `config.commands.prepare` has commands and `run_dir/prepared` does not exist, run each in the work tree as written (`cd <work tree> && <cmd>`), in order. A long one goes in the background like the tests. When all pass, write `run_dir/prepared`. When one fails, stop here and say which and why.
2. **Start each server** of `ports`:
   - **Something already listens on the port** (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`):
     - reuse it only if its working directory is inside this run's worktree (`lsof -a -p <pid> -d cwd -Fn`);
     - otherwise it belongs to another run or to the person: do not touch it, and say so.
   - **Nothing listens:** start it in the background in the work tree, with its env (`cd <work tree> && <ENV=…> <cmd>`, `run_in_background`).
     - Then wait for the port in one command: `for i in $(seq 90); do lsof -nP -iTCP:<port> -sTCP:LISTEN -t && break; sleep 2; done`.
     - Record its pid and port in `run_dir/servers.json`.
3. **Stop them** when the step that started them ends, always, even after a failure:
   - kill the servers recorded in `servers.json` and remove them from it. Record each with its `pid`: when the run finishes, wololo also stops any of them still running one of the project's start commands, in case one was missed;
   - check that each port is free again;
   - never stop a server you reused.
