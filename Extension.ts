const SHARED_BRANCH = 'master';


--

      log.appendLine(`→ Updating shared assets in ${target} ...`);
      await execFileAsync('git', ['-C', target, 'fetch', 'origin'], { env: gitEnv });
      await execFileAsync('git', ['-C', target, 'checkout', SHARED_BRANCH], { env: gitEnv });
      await execFileAsync('git', ['-C', target, 'pull', '--ff-only'], { env: gitEnv, maxBuffer: 10 * 1024 * 1024 });
    } else {
      log.appendLine(`→ Cloning shared assets ${repoName} (${SHARED_BRANCH}) into ${target} ...`);
      await execFileAsync('git', ['clone', '--branch', SHARED_BRANCH, url, target], { env: gitEnv, maxBuffer: 10 * 1024 * 1024 });
    }
    
