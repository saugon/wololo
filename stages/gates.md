# Gates

- **gate_a**, after definition: approve the spec.
- **gate_b**, after evidence: approve opening the PR.

To the person they are **Aprobar spec** and **Aprobar PR** (in English, *Approve spec* and *Approve PR*): use those names in messages and as the AskUserQuestion header, never `gate_a`, `gate_b` or "Gate A/B".

## full mode

1. `event stage.entered {stage: "gate_x"}`.
2. Right away, `event gate.resolved {gate: "gate_x", outcome: "approved", by: "auto"}`.
3. Write one line saying the gate passed by itself and how many assumptions the run carries.

At gate_a the issue is updated as in "After approval" below.

## checkpoints and guided

1. `event stage.entered {stage: "gate_x"}`. The mod records the request.
2. **Show what is being approved, in the chat, before asking.** The person decides from what is on screen, so a count ("44 scenarios") or a one-paragraph summary is not enough. Nothing gets cut for length.
   - **gate_a**, from `spec.md`, as markdown:
     - **Outcome**, verbatim;
     - **Scope** and **Non-goals**, verbatim, as bullets;
     - **Acceptance scenarios**: one line per scenario, numbered, all of them. Group them under short headings when there are many;
     - **Assumptions**: every one, one line each, saying which ones you took on your own;
     - **Open items**: what the debate left open, if anything;
     - **Risk** and how the debate ended, in one line;
     - the path to `spec.md`, for the full text.
   - **gate_b**:
     - the items done, with their commits;
     - `git diff --stat origin/<base>...HEAD`, file by file;
     - the verification commands and their results;
     - the screenshot paths, with captions;
     - the assumptions and decisions;
     - the branch and the PR title it will open;
     - how many commits are unsigned, if any: they are signed right after approval, so the person should have their signing key unlocked when they approve.
3. **Ask** with AskUserQuestion, with the context block before it, under the gate's header (**Aprobar spec** or **Aprobar PR**): the run accepts `gate.resolved` only on an answer to that question, and a dialog the person cancelled is no answer, so ask again. Options:
   - **Aprobar (Recomendado)**;
   - **Ajustar**: the person says what to change;
   - **Ver completo**: you print `spec.md` whole (at gate_b, the diff of each file), and ask again;
   - **Cancelar el run**.
4. **Apply the answer.**
   - **Aprobar**: `event gate.resolved {gate, outcome: "approved", by: "user"}`, then "After approval".
   - **Ajustar**: apply the change and record each point as a `decision`, and `gate.resolved {gate, outcome: "changes", by: "user"}`. Ask again; the run stays in the gate until an approval. If the change reopens the scope, go back with `stage.entered {stage: "definition", reason}`. At gate_b the equivalent is `implement`.
   - **Ver completo**: show it and ask again.
   - **Cancelar**: `run.finished {outcome: "cancelled", summary}`.

## After approval

**At gate_a:**

When `config.spec.to_github` is false, nothing goes to GitHub: the spec stays in `run_dir/spec.md` only, and this step ends here.

Otherwise, publish the minimum someone needs to understand and check the change, in `config.languages.issue`:

1. Write `run_dir/issue-body.md`:

   ```
   ## Outcome            1-3 lines
   ## Scope              bullets
   ## Non-goals          bullets
   ## Acceptance         one line per scenario
   ## Decisions          only the person's, one line each
   <details><summary>Original issue</summary>   the original body, untouched
   ```

   Leave out the context, the debate, the risks, the assumptions and every internal note: those stay in the run's files.
2. Publish it with `mcp__wololo__publish`:
   - **GitHub issue source**: `{kind: "issue_body", number, body_file}`;
   - **text source with `config.spec.create_issue_from_text`**: `{kind: "issue_create", title, body_file}`. Keep the issue number for `Closes #n`.
3. When `publish` answers that the text does not fit:
   1. Write `run_dir/issue-summary.md`: the outcome, the scope bullets, the scenario titles, a line saying the full spec is kept in wololo run `<run id>`, and the original body.
   2. Call `publish` again with `summary_file`.

   Never cut the spec itself to make it fit.

**At gate_b:** go to `stages/06-pr.md`.
