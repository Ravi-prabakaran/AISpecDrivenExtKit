  // Tracked so the agent's file search can see it, but local changes are hidden
  // so it never appears as a pending change.
  try {
    await execFileAsync('git', ['-C', path.join(folder, ASSETS_FOLDER),
      'update-index', '--skip-worktree', '.github/dh-context.md']);
  } catch {
    log.appendLine('⚠ Could not mark dh-context.md skip-worktree.');
  }
