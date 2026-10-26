# Stage 2: definition

Goal: `run_dir/spec.md`, a definition a reviewer can approve and an implementer cannot read two ways.

1. `event stage.entered {stage: "definition"}`.
2. **Write `spec.md`** in `config.languages.spec`:

   ```
   # <title>
   ## Outcome            what changes, for whom, in one paragraph
   ## Scope              what this change includes
   ## Non-goals          what it deliberately leaves out
   ## Acceptance scenarios
   1. Given … when … then …   (happy path, errors, permissions, edge cases)
   ## Assumptions        each: what was assumed and why
   ## Open decisions     each as [NEEDS CLARIFICATION: the question]
   ## Risks
   ```

   Keep it under about 9,000 characters and 12 scenarios. If it does not fit, the issue is too big: propose a split, asking in `checkpoints`/`guided`, or `blocked` in `full`.
3. **Resolve every `[NEEDS CLARIFICATION]`** by mode:
   - **guided**: ask them all, batched (see the question rules in SKILL.md).
   - **checkpoints**: resolve the minor ones yourself, with the reading most consistent with the code and the least risky, and move them to Assumptions (`assumption` event each). Ask only the ones that change the scope or carry risk.
   - **full**: resolve them all yourself as assumptions. A blocking condition still stops the run.

   Each answer is a `decision {text, by: "person"}`. Decided means final: no critic and no later revision may reopen it.
4. **Debate the spec**: follow `stages/debate.md` with `stage: "definition"` and the document `spec.md`.
5. `event stage.completed {stage: "definition"}`, then go to `stages/gates.md` for gate_a.
