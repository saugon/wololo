# Stage 3: plan

Goal: `run_dir/plan.md`, small items, each with how it is verified.

1. `event stage.entered {stage: "plan"}`.
2. **Architects.** Give each one `spec.md`, `context.md` and its approach.
   - Low risk or `light`: one `wololo:architect`, pragmatic.
   - High or unknown risk: two in parallel, minimal and pragmatic.
   - `deep`: add a third, clean.

   With more than one plan:
   - `guided`: ask the person to choose, showing the approaches as previews.
   - Otherwise: choose yourself and record a `decision {text, by: "claude"}` with the reason.
3. **Write `plan.md`:**
   - **Approach**: one paragraph.
   - **Items**: numbered. Each has a title, the files it touches, the change, and its verification (the tests or the command that proves it, tied to acceptance scenarios).
   - **Order**.
   - **Risks**.

   An item fits one implementer pass. Every behaviour change carries its test inside the item.
4. **Debate the plan**: follow `stages/debate.md` with `stage: "plan"`.
5. `event plan.ready {items: [the item titles]}`.
6. `event stage.completed {stage: "plan"}`, then go to `stages/04-implement.md`.
