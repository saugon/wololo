# Stage 3: plan

Goal: `run_dir/plan.md`, small items, each with how it is verified.

1. `event stage.entered {stage: "plan"}`. When `config.adapters.plan` exists, call `mcp__wololo__run_adapter {point: "plan"}` now: a refusal (the project's tool does not take the issue as it is) blocks the run before any plan is written.
2. **Name the branch.** The name the run started with comes from the title, word for word. Now that the spec says what the change is, give it its name: `event branch.named {slug}`, with a slug of two to five words on what the change does, in the language and style of the repository's branches (`git branch -r --sort=-committerdate | head -20`), such as `ecommerce-offline-payments`. The mod renames the branch from `config.branch`, and `<branch>` is the new one from here on. It keeps the name once the branch is on origin.
3. **Architects.** Give each one `spec.md`, `context.md` and its approach.
   - Low risk or `light`: one `wololo:architect`, pragmatic.
   - High or unknown risk: two in parallel, minimal and pragmatic.
   - `deep`: add a third, clean.

   With more than one plan:
   - `guided`: ask the person to choose, showing the approaches as previews.
   - Otherwise: choose yourself and record a `decision {text, by: "claude"}` with the reason.
4. **Write `plan.md`:**
   - **Approach**: one paragraph.
   - **Items**: numbered. Each has a title, the files it touches, the change, and its verification (the tests or the command that proves it, tied to acceptance scenarios).
   - **Order**.
   - **Risks**.

   An item fits one implementer pass. Every behaviour change carries its test inside the item.
5. **Debate the plan**: follow `stages/debate.md` with `stage: "plan"`.
6. `event plan.ready {items: [the item titles]}`.
7. `event stage.completed {stage: "plan"}`, then go to `stages/04-implement.md`.
