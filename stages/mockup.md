# Stage: mockup

Comes after definition, before gate_a. Goal: a UI mockup the person adjusted and approved, in `run_dir/mockup/`, so the plan and the code build the screens already agreed.

1. `event stage.entered {stage: "mockup"}`.
2. **Decide whether it applies**, from `config.mockup.when` and the spec's **UI** section (`stages/02-definition.md`):
   - `never`: skip.
   - `always`: make it whenever the change has UI.
   - `auto`: make it only when the spec says there are screens to decide.

   To skip: `event stage.completed {stage: "mockup", note: "<why>"}` and go to `stages/gates.md` for gate_a.
3. **Learn the project's look.** Read the project's styles and two or three screens near the change: colours, type, spacing, the components it uses (its theme or tailwind config, its design tokens, its shared components). The mockup looks like this project, not like a generic page.
4. **Make it.** One self-contained HTML file per screen in `run_dir/mockup/` (`NN-<slug>.html`), or one file with a tab per screen:
   - the states that matter for each screen: empty, loading, error, with data, and the ones the acceptance scenarios name;
   - invented data that reads as real for the domain; never data from a real customer;
   - in `config.languages.spec` for the labels, as the product speaks;
   - static: links and buttons may switch states, nothing calls a server.
5. **Publish it** as an Artifact, so the person opens it in the browser: load the skills the Artifact tool asks for before writing a page, then publish `run_dir/mockup/<file>` (one artifact per file; a later version goes to the same file path, so the link stays). Without the Artifact tool, or when publishing fails, the files stay local: say their paths, which open in a browser.

   Record `event mockup.published {url, files}`: `url` is the artifact's link (the first one, with several files), or `null` when it stayed local; `files` are the names in `run_dir/mockup/`.
6. **Adjust it with the person**, by mode:
   - **full**: do not ask. Record an `assumption` that the UI was decided without the person, and go on.
   - **checkpoints** and **guided**: show the link (or the paths) and a short list of what each screen shows and the decisions it takes (layout, flow, states). Ask with AskUserQuestion, header **Mockup**:
     - **Aprobar mockup (Recomendado)**;
     - **Ajustar**: the person says what to change. Change the files, publish them again to the same artifacts, record `mockup.published` again and a `decision` per point, and ask again;
     - **Saltear**: the run goes on without a mockup. Delete `run_dir/mockup/` and record a `decision`.

     When an adjustment changes the scope or a scenario, update `spec.md` and its scenarios too, as a `corrected`; if it reopens the scope, go back with `stage.entered {stage: "definition", reason}`.
7. `event stage.completed {stage: "mockup"}`, then go to `stages/gates.md` for gate_a.

Aprobar spec approves the spec and the mockup together: a mockup changed after it needs the gate again (the run says so and sends you back here).

The mockup never goes to GitHub: not in the issue, the PR or its comments.
