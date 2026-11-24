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
     - the mockup's link (or its paths), when the mockup stage made one: Aprobar spec approves it too;
     - the path to `spec.md`, for the full text.
   - **gate_b**:
     - the items done, with their commits;
     - `git diff --stat origin/<base>...HEAD`, file by file;
     - the verification commands and their results;
     - the screenshot paths, with captions, each beside the mockup screen it matches when there is one;
     - the assumptions and decisions;
     - the branch and the PR title it will open;
     - how many commits are unsigned, if any: they are signed right after approval, so the person should have their signing key unlocked when they approve.
3. **Ask** with AskUserQuestion, with the context block before it, under the gate's header (**Aprobar spec** or **Aprobar PR**): the run accepts `gate.resolved` only on an answer to that question, and a dialog the person cancelled is no answer, so ask again. Options:
   - **Aprobar (Recomendado)**;
   - **Ajustar**: the person says what to change;
   - **Ver completo**: you print `spec.md` whole (at gate_b, the diff of each file), and ask again;
   - **Cancelar el run**.

   At gate_b, when `config.commands.start` has commands, **Probar localmente** (or **Detener el stack**, while it is up) takes Ajustar's place: AskUserQuestion takes four options, and the person writes what to change in its free-text answer, which is Ajustar.
4. **Apply the answer.**
   - **Aprobar**: `event gate.resolved {gate, outcome: "approved", by: "user"}`, then "After approval".
   - **Ajustar** (or what the person wrote): apply the change and record each point as a `decision`, and `gate.resolved {gate, outcome: "changes", by: "user"}`. Ask again; the run stays in the gate until an approval. If the change reopens the scope, go back with `stage.entered {stage: "definition", reason}`; if it is about the mockup, go back with `stage.entered {stage: "mockup", reason}`. At gate_b the equivalent is `implement`.
   - **Ver completo**: show it and ask again.
   - **Probar localmente**: start the stack as `stages/servers.md` says (prepare once, then the servers, in the background). Then show, in the chat, where to try it: each server's URL (`config.commands.app_url` with its port), the login from `config.commands.login` with the project's demo credentials, and the acceptance scenarios to walk through. Ask again, with **Detener el stack** in place of Probar localmente; the stack stays up while the person tries it, and through **Ajustar** too, so the fix shows on the servers already running.
   - **Detener el stack**: stop it as `stages/servers.md` says, and ask again.
   - **Cancelar**: `run.finished {outcome: "cancelled", summary}`.

   Leaving gate_b, approved or cancelled, stop the stack first if it is up.

When the run's change is approved on the PR (`review: pr`), Aprobar PR is not asked: record `gate.resolved {gate: "gate_b", outcome: "approved", by: "auto"}` and go on to the PR, which a person approves on GitHub once CI is green.

## After approval

The run keeps what each gate approved: `spec.md` and the mockup for **Aprobar spec**; `spec.md`, `plan.md` and the committed code for **Aprobar PR**. If any of them changes afterwards, the run refuses to move on (or to open the PR) until you go back to the stage that redoes it (`definition` or `implement`) and ask the gate again. Going back before a gate reopens it, except changes asked for once the PR is open: back to `implement` or `evidence` with the PR open, Aprobar PR's approval stands, and entering `pr` again goes on without asking it (`stages/06-pr.md`, **In review**).

**At gate_a:**

When `config.adapters.gate_a` exists, call `mcp__wololo__run_adapter {point: "gate_a"}` right after the approval, before anything below: it records the approval where the project's tool reads it.

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
   1. Write `run_dir/issue-summary.md`: the outcome, the scope bullets, the scenario titles, a line saying the full spec is kept locally, and the original body.
   2. Call `publish` again with `summary_file`.

   Never cut the spec itself to make it fit.

**At gate_b:** go to `stages/06-pr.md`.
