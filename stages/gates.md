# Gates

- **gate_a**, after definition: approve the spec.
- **gate_b**, after evidence: approve opening the PR.

## full mode

1. `event stage.entered {stage: "gate_x"}`.
2. Right away, `event gate.resolved {gate: "gate_x", outcome: "approved", by: "auto"}`.
3. Write one line saying the gate passed by itself and how many assumptions the run carries.

At gate_a the issue is updated as in "After approval" below.

## checkpoints and guided

1. `event stage.entered {stage: "gate_x"}`. The mod records the request.
2. **Summarize what is being approved.**
   - **gate_a**: in at most 10 lines,
     - the outcome;
     - the scope;
     - how many non-goals and acceptance scenarios there are;
     - **every assumption, one line each**;
     - the risk;
     - how the debate ended;
     - and the path to `spec.md`.
   - **gate_b**:
     - the items done and their commits;
     - `git diff --stat origin/<base>...HEAD`, summarized;
     - the verification commands and their results;
     - the screenshot paths, with captions;
     - the assumptions and decisions;
     - and the branch and the PR title it will open.
3. **Ask** with AskUserQuestion, with the context block before it. Options:
   - **Aprobar (Recomendado)**;
   - **Ajustar**: the person says what to change;
   - **Ver completo**: you print the spec, or the diff summary per file, and ask again;
   - **Cancelar el run**.
4. **Apply the answer.**
   - **Aprobar**: `event gate.resolved {gate, outcome: "approved", by: "user"}`, then "After approval".
   - **Ajustar**: apply the change and record each point as a `decision`. Ask again; the run stays in the gate. If the change reopens the scope, go back with `stage.entered {stage: "definition", reason}`. At gate_b the equivalent is `implement`.
   - **Ver completo**: show it and ask again.
   - **Cancelar**: `run.finished {outcome: "cancelled", summary}`.

## After approval

**At gate_a:**
- **GitHub issue source**, with `config.spec.update_issue`:
  1. Write `run_dir/issue-body.md`: the spec, followed by `<details><summary>Original issue</summary>` with the original body. This keeps the original.
  2. `gh issue edit <n> --body-file run_dir/issue-body.md`.
- **Text source**, with `config.spec.create_issue_from_text`: create the issue with `gh issue create`, in `config.languages.issue`, and keep its number for `Closes #n`.

**At gate_b:** go to `stages/06-pr.md`.
