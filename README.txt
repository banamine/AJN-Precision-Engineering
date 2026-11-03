AJN CI FIX - one file
Replaces: src/App.tsx   (line 403: removes the stray onPlayerPage prop on <RadioDock>)
Apply ONLY on top of PR #169 (fix/restore-deleted-tests), which restores the 32 deleted test/tool files.
Check: npx tsc --noEmit   -> no output, exit 0
