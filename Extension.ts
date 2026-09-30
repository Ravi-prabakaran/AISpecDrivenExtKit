"commands": [
  {
    "command": "dh-champion.setup",
    "title": "Setup",
    "category": "DH Champion"
  },
  {
    "command": "dh-champion.doctor",
    "title": "Doctor",
    "category": "DH Champion"
  }
]


---

// Runs a git command in a folder and returns trimmed stdout, or undefined on failure.
async function git(cwd: string, args: string[], token?: string): Promise<string | undefined> {
  const env = token
    ? {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`
      }
    : process.env;

  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { env, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

// Builds the diagnostic report.
async function buildDoctorReport(context: vscode.ExtensionContext): Promise<string> {
  const version = context.extension.packageJSON.version as string;
  const config = vscode.workspace.getConfiguration('dhChampion');
  const repos = config.get<Repo[]>('repositories') ?? [];
  const sharedRepo = config.get<string>('sharedRepository') ?? 'MM.DigitalHub.AIKnowledgeHub';

  const lines: string[] = [];
  lines.push(`# DH Champion Doctor`);
  lines.push('');
  lines.push(`Extension version: ${version}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // --- Prerequisites ---
  lines.push('## Prerequisites');
  const gitVersion = await getToolVersion('git');
  const nodeVersion = await getToolVersion('node');
  const azVersion = await getToolVersion('az');
  lines.push(gitVersion ? `- OK  Git: ${gitVersion}` : '- FAIL  Git: not found');
  lines.push(nodeVersion ? `- OK  Node.js: ${nodeVersion}` : '- FAIL  Node.js: not found (MCP servers need it)');
  lines.push(azVersion ? `- OK  Azure CLI: ${azVersion}` : '- WARN  Azure CLI: not found (MCP will prompt for browser sign-in)');
  lines.push('');

  // --- Sign-in ---
  lines.push('## Sign-in');
  let token: string | undefined;
  const session = await vscode.authentication.getSession('microsoft', [ADO_SCOPE], { createIfNone: false });
  if (session) {
    token = session.accessToken;
    lines.push(`- OK  Microsoft: ${session.account.label}`);
  } else {
    lines.push('- FAIL  Microsoft: not signed in. Run DH Champion: Setup.');
  }
  if (azVersion) {
    lines.push(await isAzureCliSignedIn() ? '- OK  Azure CLI: signed in' : '- WARN  Azure CLI: not signed in. Run: az login');
  }
  lines.push('');

  // --- Workspace ---
  lines.push('## Workspace');
  const workspaceFile = vscode.workspace.workspaceFile;
  const folder = workspaceFile
    ? path.dirname(workspaceFile.fsPath)
    : context.globalState.get<string>(LAST_FOLDER_KEY);

  if (!folder) {
    lines.push('- FAIL  No DH Champion workspace found. Run DH Champion: Setup.');
    return lines.join('\n');
  }

  lines.push(workspaceFile
    ? `- OK  Workspace open: ${path.basename(workspaceFile.fsPath)}`
    : `- WARN  Workspace not open. Checking last setup folder instead.`);
  lines.push(`- Folder: ${folder}`);
  lines.push('');

  // --- Repositories ---
  lines.push('## Repositories');
  for (const repo of repos) {
    const target = path.join(folder, repo.name);
    if (!fs.existsSync(path.join(target, '.git'))) {
      lines.push(`- FAIL  ${repo.name}: not cloned`);
      continue;
    }
    const branch = await git(target, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const dirty = await git(target, ['status', '--porcelain']);
    const base = repo.baseBranch ?? DEFAULT_BASE_BRANCH;
    const notes: string[] = [];
    if (branch && branch !== base) {
      notes.push(`on ${branch}, base is ${base}`);
    }
    if (dirty) {
      notes.push(`${dirty.split('\n').length} uncommitted change(s)`);
    }
    lines.push(notes.length
      ? `- WARN  ${repo.name}: ${notes.join('; ')}`
      : `- OK  ${repo.name}: on ${branch}, clean`);
  }
  lines.push('');

  // --- AI assets ---
  lines.push('## AI assets');
  const assetsPath = path.join(folder, ASSETS_FOLDER);
  if (!fs.existsSync(path.join(assetsPath, '.git'))) {
    lines.push(`- FAIL  ${ASSETS_FOLDER}: not cloned. Run DH Champion: Setup.`);
  } else {
    const hash = await git(assetsPath, ['rev-parse', '--short', 'HEAD']);
    const branch = await git(assetsPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    lines.push(`- OK  ${sharedRepo} @ ${hash} (${branch})`);

    if (branch !== SHARED_BRANCH) {
      lines.push(`- WARN  Expected branch ${SHARED_BRANCH}.`);
    }

    if (token) {
      await git(assetsPath, ['fetch', 'origin'], token);
      const behind = await git(assetsPath, ['rev-list', '--count', `HEAD..origin/${SHARED_BRANCH}`], token);
      if (behind && behind !== '0') {
        lines.push(`- WARN  ${behind} commit(s) behind origin. Run DH Champion: Setup to update.`);
      } else if (behind === '0') {
        lines.push('- OK  Up to date with origin.');
      }
    }

    // Skills present
    const skillsDir = path.join(assetsPath, '.github', 'skills');
    if (fs.existsSync(skillsDir)) {
      const skills = fs.readdirSync(skillsDir).filter(n =>
        fs.existsSync(path.join(skillsDir, n, 'SKILL.md'))
      );
      lines.push(skills.length
        ? `- OK  Skills: ${skills.join(', ')}`
        : '- WARN  Skills folder is empty.');
    } else {
      lines.push('- WARN  No skills folder found.');
    }

    // Context file freshness
    const contextPath = path.join(assetsPath, '.github', 'dh-context.md');
    if (!fs.existsSync(contextPath)) {
      lines.push('- FAIL  dh-context.md missing. Run DH Champion: Setup.');
    } else {
      const generatedBy = /Generated by DH Champion ([\d.]+)/.exec(fs.readFileSync(contextPath, 'utf8'));
      const contextVersion = generatedBy?.[1];
      lines.push(contextVersion === version
        ? `- OK  dh-context.md generated by ${contextVersion}`
        : `- WARN  dh-context.md generated by ${contextVersion ?? 'unknown'}, extension is ${version}. Re-run Setup.`);
    }
  }
  lines.push('');

  // --- MCP ---
  lines.push('## MCP');
  const mcpPath = path.join(assetsPath, '.vscode', 'mcp.json');
  if (!fs.existsSync(mcpPath)) {
    lines.push('- FAIL  mcp.json missing. Run DH Champion: Setup.');
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as { servers?: Record<string, unknown> };
      const names = Object.keys(parsed.servers ?? {});
      lines.push(`- OK  Configured: ${names.join(', ') || 'none'}`);
    } catch {
      lines.push('- FAIL  mcp.json could not be parsed.');
    }
  }

  const duplicates = findDuplicateUserServers(context);
  if (duplicates.length) {
    lines.push(`- WARN  User-level servers that may duplicate ours: ${duplicates.join(', ')}`);
    lines.push('        Disable them for this workspace: Command Palette -> MCP: List Servers.');
  }
  lines.push('');
  lines.push('_Run MCP: List Servers to see whether each server actually started._');

  return lines.join('\n');
}



----


    const doctor = vscode.commands.registerCommand('dh-champion.doctor', async () => {
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DH Champion: running checks...' },
      () => buildDoctorReport(context)
    );

    log.appendLine('');
    log.appendLine(report);

    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });

    const failures = (report.match(/- FAIL/g) ?? []).length;
    const warnings = (report.match(/- WARN/g) ?? []).length;

    const action = await vscode.window.showInformationMessage(
      failures ? `DH Champion: ${failures} problem(s) found` : warnings ? `DH Champion: ${warnings} warning(s)` : 'DH Champion: all checks passed',
      'Copy Report'
    );
    if (action === 'Copy Report') {
      await vscode.env.clipboard.writeText(report);
    }
  });
  context.subscriptions.push(doctor);
  
