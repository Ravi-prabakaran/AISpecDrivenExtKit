// Clones the shared assets repo into the assets folder, or updates it if
// it is already there. Returns the short commit hash, or undefined on failure.
async function cloneOrUpdateShared(repoName: string, folder: string, token: string): Promise<string | undefined> {
  const target = path.join(folder, ASSETS_FOLDER);
  const url = `https://dev.azure.com/${ADO_ORGANIZATION}/${encodeURIComponent(ADO_PROJECT)}/_git/${encodeURIComponent(repoName)}`;

  const gitEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`
  };

  try {
    if (fs.existsSync(path.join(target, '.git'))) {
      log.appendLine(`→ Updating shared assets in ${target} (${SHARED_BRANCH}) ...`);
      await execFileAsync('git', ['-C', target, 'fetch', 'origin'], { env: gitEnv });
      await execFileAsync('git', ['-C', target, 'checkout', SHARED_BRANCH], { env: gitEnv });
      await execFileAsync('git', ['-C', target, 'pull', '--ff-only'], { env: gitEnv, maxBuffer: 10 * 1024 * 1024 });
    } else {
      log.appendLine(`→ Cloning shared assets ${repoName} (${SHARED_BRANCH}) into ${target} ...`);
      await execFileAsync('git', ['clone', '--branch', SHARED_BRANCH, url, target], { env: gitEnv, maxBuffer: 10 * 1024 * 1024 });
    }

    const { stdout } = await execFileAsync('git', ['-C', target, 'rev-parse', '--short', 'HEAD'], { env: gitEnv });
    const hash = stdout.trim();
    log.appendLine(`✔ Shared assets at ${hash}`);
    return hash;
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || String(error);
    log.appendLine(`✖ Shared assets: ${message}`);
    return undefined;
  }
}
