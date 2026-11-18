# Adapters

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
