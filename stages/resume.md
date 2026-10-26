# Resume a run

`resume` answers with the run's stage, worktree, branch and `since` lines.

1. Show the `since` lines under "Mientras no estabas" (or "Since you last looked"), and what the run is waiting on.
2. The work tree is the run's worktree, or the repository root in `branch` mode. Work on it as SKILL.md's "Where the work happens" says.
3. Read whichever of `run_dir/spec.md`, `plan.md` and `log.md` exist.
4. Reconcile with git: `git status --porcelain`, plus `git log --oneline origin/<base>..HEAD`. Compare with the items `log.md` records as committed.
   - Uncommitted changes mean the previous session died in the middle of an item. Verify the tree before trusting it, and record a `corrected` event for whatever the log claimed and git does not show.
5. Read the file of the current stage and continue from where the record says the run is, not from memory.
