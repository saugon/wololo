# Debate

Used for the spec (definition) and for the plan. It decides how hard the document is challenged before anyone builds on it.

## How deep

| `config.debate.depth` | Run risk | Debate |
|---|---|---|
| `light` | any | one self-critique |
| `by_risk` | `low` | one self-critique |
| `by_risk` | `high` or `unknown` | critic rounds, up to `budgets.debate_rounds` |
| `deep` | any | critic rounds, up to `budgets.debate_rounds` |

Number the debate files with a two-digit sequence that runs across the whole run (`01`, `02`, …).

## Self-critique

1. Reread the document against the critic's checklist in `roles/critic.md`.
2. Fix what fails.
3. Write `debate/NN-<stage>-self.md`, listing what you changed and why.
4. Record `debate.turn {stage, role: "self", round: 1, model: "claude", verdict: "approve", file}`.

## A critic round

1. **The critique.** Give the critic the document, the list of resolved decisions (the `decision` events) and the round number.
   - `config.debate.critic` is `claude`: spawn `wololo:critic`. Write its answer to `debate/NN-<stage>-critic.md` and record `debate.turn {stage, role: "critic", round, model: "claude", verdict, file}`.
   - `config.debate.critic` is `external`: write the prompt to `debate/NN-<stage>-critic-prompt.md`. The prompt is the body of `roles/critic.md`, the document and the resolved decisions. Call `external_turn {role: "critic", stage, round, prompt_file, out_file: debate/NN-<stage>-critic.md}`. It records its own `debate.turn`.
2. **The answer.** For each finding:
   - accepted: change the document;
   - rejected: give the reason.

   A finding that would reopen a resolved decision is rejected, citing the decision. Write `debate/NN-<stage>-answer.md`, with one line per finding: ✅ or ❌, then the reason.
3. **Stop** when the verdict is `approve`, or when the rounds run out.
   - With findings still blocking: in `checkpoints`/`guided` they go to the gate as open items; in `full` they are a blocking condition.
   - With only major or minor findings left: record each as an `assumption`.
