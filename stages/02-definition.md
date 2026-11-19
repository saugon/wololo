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
   ## UI               screens to decide: none, or each new or changed screen and the choices it takes (layout, flow, states)
   ```

   **UI** says whether the mockup stage makes a mockup when `config.mockup.when` is `auto`: list a screen when it is new, or when the change makes a choice about it the person may want to see first (where something goes, which steps a flow takes, which states it shows). Write `none` for a change without UI, or whose UI follows what exists with nothing to choose (a field more in a form, a text, a column like the others).

   `spec.md` has no length limit, and its length never stops the run. What goes to GitHub is a short version, written at gate_a.
3. **Resolve every `[NEEDS CLARIFICATION]`** by mode:
   - **guided**: ask them all, batched (see the question rules in SKILL.md).
   - **checkpoints**: resolve the minor ones yourself, with the reading most consistent with the code and the least risky, and move them to Assumptions (`assumption` event each). Ask only the ones that change the scope or carry risk.
   - **full**: resolve them all yourself as assumptions. A blocking condition still stops the run.

   Each answer is a `decision {text, by: "person"}`. Decided means final: no critic and no later revision may reopen it.
4. **Debate the spec**: follow `stages/debate.md` with `stage: "definition"` and the document `spec.md`. When `config.adapters.definition` exists, call `mcp__wololo__run_adapter {point: "definition"}` after writing `spec.md`; if it `replaces` the debate, skip your own and take the tool's result into `spec.md`.
5. `event stage.completed {stage: "definition"}`, then go to `stages/mockup.md`.
