# Stages

```
context → definition → mockup → approve spec → plan → implement → evidence → approve PR → pr
```

| Stage | What happens |
|---|---|
| context | Reads the issue and explores the code with parallel explorers; estimates the risk. |
| definition | Writes the spec (outcome, scope, non-goals, acceptance scenarios, assumptions) and debates it: self-critique for low risk, an adversarial critic (Claude or an external model such as Codex) for high risk. |
| mockup | When the change has screens to decide (`mockup.when`: `auto` by default, `always` or `never`), a mockup of them in the project's look, with its states and invented data, published as a private claude.ai Artifact you open in the browser. You adjust it until it is right; in `full` it is made without asking. Skipped with a note otherwise. |
| approve spec (`gate_a`) | You approve the spec, and the mockup with it. With `spec.to_github`, a short version goes into the issue body, or a summary when it is longer than GitHub accepts. |
| plan | Architects propose small, verifiable items; the plan is debated the same way. |
| implement | Per item: implementer → the tests the run touched → reviewer → commit, with a log of every decision and correction. After the last item, the full suite (locally, or left to CI). |
| evidence | Up to 5 screenshots of what changed. Starts the servers it needs on the run's own ports, and stops them afterwards. |
| approve PR (`gate_b`) | You approve opening the PR. **Probar localmente** starts the app on the run's ports first, so you try the change before approving. |
| pr | Pushes the run branch, opens a draft PR, watches CI, fixes failures within a budget, marks it ready when green. From the moment the PR opens, also while CI runs, it checks the PR's comments every 5 minutes (people's and bots' such as Codex) and fixes or answers each one. The same check sees when the PR conflicts with its base or enters the merge queue (and its place there), which the card, the pane and the app show. Then the run stays **in review**: changes the review asks for go through the implement loop, and the run ends when the PR merges (checked every 5 minutes while a session holds it), when the person ends it with `/wololo done`, or, if the PR is closed without merging, as the person decides. |

**Autonomy** is per project, and per run with `--full`, `--checkpoints` or `--guided`:

- **full** never asks, except for a blocking condition: something destructive, the spec contradicting the code, a test that would be deleted, an exhausted budget.
- **checkpoints** (the default) stops at the two gates.
- **guided** also asks at every relevant ambiguity.

What it decides on its own is recorded as an assumption, shown at the gates and in the PR.
