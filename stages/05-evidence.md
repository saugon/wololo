# Stage 5: evidence

Goal: up to `config.screenshots.max` screenshots of what changed, saved in `run_dir/screenshots/`. Every server and browser the stage starts is stopped before it ends.

1. `event stage.entered {stage: "evidence"}`.
2. **Decide whether it applies.** Skip the screenshots when:
   - the change is not visible in a browser (no UI files, no visible behaviour);
   - `config.screenshots.enabled` is false;
   - or no Playwright browser tools are available.

   To skip: `event stage.completed {stage: "evidence", note: "<why>"}` and go on.
3. **Servers.** Start them as `stages/servers.md` says. When a port belongs to another run or to the person: in `full`, skip the screenshots with a note; in the other modes, ask.
4. **Log in** if `config.commands.login` says how. Use the project's demo credentials from its CLAUDE.md, never real ones.
5. **Capture** at most `config.screenshots.max` screens, chosen for the acceptance scenarios they prove, and every screen the mockup shows. When a screen differs from its mockup in something the person approved, fix it through the implement loop first, or say why at gate_b.
   - Save each as `run_dir/screenshots/NN-<slug>.png`.
   - Record `screenshot.saved {file, caption}`, with a caption in `config.languages.pr`.
6. **Stop everything you started, always, even after a failure.**
   - Close the browser.
   - Stop the servers as `stages/servers.md` says.
7. `event stage.completed {stage: "evidence"}`, then go to `stages/gates.md` for gate_b.
