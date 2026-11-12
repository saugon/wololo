# Stage 4: implement

Goal: every plan item implemented, verified, reviewed and committed on the run's branch, with its record in `run_dir/log.md`.

`event stage.entered {stage: "implement"}`. Then, for each item `n`, in order:

1. **Start it.** `event item.started {n, title}`. When this attempt throws away the previous attempt's design, add `reversal: true`.
2. **Implement.** Spawn `config.project_agents.implementer`, or `wololo:implementer`. Give it:
   - the item;
   - the paths to `spec.md` and `plan.md`;
   - the findings of the previous attempt, if any, and the minor findings carried to this item (step 4);
   - the work-tree preamble from SKILL.md, and the reminder that it does not commit.
3. **Verify.** Call `mcp__wololo__tests {scope: "touched"}`. It returns:
   - the test files this run created or changed;
   - the commands that run them;
   - the files no configured command covers.

   Then spawn `config.project_agents.verifier`, or `wololo:verifier`, with the work-tree preamble, the `commands` to run exactly as written, and the `unmatched` files. The verifier runs the unmatched files the way the project documents, and you record an `assumption` for each.
   - **No test file at all:** the item is not done. Back to step 2: a behaviour change without a test fails verification.
   - **`config.tests.follow` is `project`:** the verifier also reads `config.tests.rules_from`, and the project's rules win wherever they differ from these steps.
   - **Stale reports.** The verifier reports the tree hash before and after. If they differ, or they do not match `git rev-parse HEAD` plus `git diff HEAD | shasum` now, the report is stale: discard it and verify again. Never act on a stale PASS.
   - Record `item.verified {n, result: "pass" | "fail", tree}`. On a pass the run records the tree it verified itself: the one `git add -A` would commit now.
   - **On FAIL**: back to step 2 with the failures. Count the attempts.
4. **Review.** Use `config.review.reviewer`:
   - `claude`: `config.project_agents.reviewer` or `wololo:reviewer`;
   - `external`: `external_turn {role: "reviewer"}`, with a prompt holding the body of `roles/reviewer.md`, the item, and `git diff HEAD`;
   - `both`: both.

   What to do with each finding:
   - **blocking or major**: fix it through the implementer, then verify and review again: the run takes a commit only of what was reviewed after its last verification. Fix the minors of the same review in that same round.
   - **minor**, when nothing blocking or major came with it: never open a round for it alone (implementer, verifier and reviewer again cost 5 to 20 minutes). Commit the item as reviewed and either:
     - **carry it** to the next item that touches the same files, handing it to that item's implementer, or to a final item `Pendientes de la revisión` / `Review leftovers` that you add once at the end of `plan.md` (its number is the last one plus 1; `item.started` grows the plan) and that collects the rest: one round for all of them;
     - **accept it** with a reason, when it is cosmetic or the reviewer's preference.

     Write each in `log.md` as carried (to which item) or accepted (why). A carried minor that the run ends without doing is listed in the PR as left out.
   - In `guided`, ask the person about the findings you would accept or carry.

   Record `item.reviewed {n, findings, verdict}`.
5. **Commit.** `git add -A && git commit -m "<message in the repository's style>"`, with no trailers. Record `item.committed {n, sha, title}`. The run refuses it when the commit's tree is not the one it verified: something changed after verification, so verify and review again.
   - **If the commit fails because it cannot be signed** (gpg, ssh-keygen or 1Password errors: the person is away or the key is locked), never stop the run and never retry in a loop:
     1. Commit the same thing unsigned: `git -c commit.gpgsign=false commit -m "<the same message>"`.
     2. Record `item.committed {n, sha, title}`, then `signing.deferred {n, sha}`.
     3. Keep going. The commits get signed before the push (`stages/06-pr.md`).
   - Any other commit failure (a pre-commit hook, a conflict) is a real failure: fix it through the implement loop.
   - When `config.adapters.item` exists, call `mcp__wololo__run_adapter {point: "item"}` after recording the commit: the project's tool checks the item too. If it blocks the run with findings, they are the item's next attempt (`item.started {n, title}` again).
6. **Log.** Append to `log.md`:

   ```
   ## item N: <title>                                   <short sha>
   attempts: <passes>, <design reversals> reversals
   gates: <PASS|FAIL:<what>>  tree:<short hash>
   review: <n findings>: <severity> <one line each> → <fixed|carried to item M|accepted: why>
   decisions: <what the person ruled, and which way>
   corrected: <any plan or spec sentence that turned out false, and who found it>
   left out: <what was deliberately not done, and why>
   ```

   `corrected:` matters most: a false sentence left uncorrected gets believed again.

**Stop with `blocked`** (see SKILL.md) when:
- two attempts on one item each reversed its design;
- a test looks wrong rather than the code;
- `git diff --diff-filter=D --name-only origin/<base>...` lists a test file whose code still exists;
- a check fails only sometimes.

Never edit a test into passing. Never re-run a flaky check until it turns green.

After the last item, **the full suite**:

1. Call `mcp__wololo__tests {scope: "suite"}`.
2. When `suite_runs` is `local`, run every `suite` command; when `e2e_runs` is `local`, also every `e2e` command.
   - With `e2e_needs_servers`, start the servers exactly as `stages/05-evidence.md` says, on the run's ports, and stop them afterwards.
   - When `background` is true, run each one as a background Bash command, from the work tree, writing its output to `logs_dir/<name>-<n>.log`:

     ```
     cd <work tree> && <command> > <logs_dir>/<name>-<n>.log 2>&1; echo "exit=$?" >> <logs_dir>/<name>-<n>.log
     ```

     Then end the turn. The mod shows "corriendo tests". When the notification arrives, read the tail of the log.
   - Record the tree hash when it starts. A suite that ran on a tree that changed since is stale.
3. Fix any failure through the same loop (implementer, the touched tests, a commit), then run the suite again.
4. When a suite is left to CI (`ci`), record an `assumption` saying so; the pr stage watches it.
5. `event stage.completed {stage: "implement"}`.
6. Go to `stages/05-evidence.md`.
