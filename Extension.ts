import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Fixed values for our organization
const ADO_ORGANIZATION = 'your-org-name';
const ADO_PROJECT = 'YourProjectName';
const DEFAULT_BASE_BRANCH = 'develop';

// Azure DevOps sign-in scope (a fixed Microsoft ID for Azure DevOps, same for everyone)
const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

// Key used to remember the last chosen folder
const LAST_FOLDER_KEY = 'dhChampion.lastSetupFolder';

// Shape of each repository entry in settings
type Repo = { name: string; baseBranch?: string; project?: string };

// Result of cloning one repo
type CloneResult = { repo: Repo; status: 'cloned' | 'skipped' | 'failed' };

// "DH Champion" channel in the Output panel
let log: vscode.OutputChannel;

// Runs "<tool> --version". Returns the version text, or undefined if the tool isn't installed.
async function getToolVersion(tool: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(tool, ['--version'], { shell: true });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

// Asks Azure DevOps for the list of repo names in one project.
async function listAdoRepos(token: string, project: string): Promise<string[]> {
  const url = `https://dev.azure.com/${ADO_ORGANIZATION}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (response.status !== 200) {
    throw new Error(`Azure DevOps returned ${response.status} for project "${project}".`);
  }

  const body = (await response.json()) as { value: { name: string }[] };
  return body.value.map(r => r.name.toLowerCase());
}

// Clones one repo on its base branch. The token is passed through environment
// variables for this single git command, so it is never saved in the repo.
async function cloneRepo(repo: Repo, folder: string, token: string): Promise<CloneResult> {
  const project = repo.project ?? ADO_PROJECT;
  const branch = repo.baseBranch ?? DEFAULT_BASE_BRANCH;
  const target = path.join(folder, repo.name);
  const url = `https://dev.azure.com/${ADO_ORGANIZATION}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo.name)}`;

  if (fs.existsSync(path.join(target, '.git'))) {
    log.appendLine(`↷ ${repo.name}: already cloned at ${target}, skipping.`);
    return { repo, status: 'skipped' };
  }

  log.appendLine(`→ Cloning ${project}/${repo.name} (branch: ${branch}) into ${target} ...`);
  try {
    await execFileAsync('git', ['clone', '--branch', branch, url, target], {
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`
      }
    });
    log.appendLine(`✔ ${repo.name}: cloned.`);
    return { repo, status: 'cloned' };
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || String(error);
    log.appendLine(`✖ ${repo.name}: ${message}`);
    return { repo, status: 'failed' };
  }
}

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel('DH Champion');
  context.subscriptions.push(log);

  const setup = vscode.commands.registerCommand('dh-champion.setup', async () => {

    // 1. Show what will be set up
    const config = vscode.workspace.getConfiguration('dhChampion');
    const repos = config.get<Repo[]>('repositories') ?? [];
    const branchPattern = config.get<string>('branchPattern');

    const details = [
      `Organization: ${ADO_ORGANIZATION}`,
      `Default project: ${ADO_PROJECT}`,
      `Branch pattern: ${branchPattern}`,
      '',
      `Repositories (${repos.length}):`,
      ...repos.map(r =>
        `  • ${r.project ?? ADO_PROJECT} / ${r.name}  →  ${r.baseBranch ?? DEFAULT_BASE_BRANCH}`
      )
    ].join('\n');

    const choice = await vscode.window.showInformationMessage(
      'DH Champion: ready to set up',
      { modal: true, detail: details },
      'Continue'
    );
    if (choice !== 'Continue') {
      return;
    }

    // 2. Check prerequisites
    const gitVersion = await getToolVersion('git');
    const nodeVersion = await getToolVersion('node');

    if (!gitVersion) {
      const action = await vscode.window.showErrorMessage(
        'DH Champion: Git is not installed',
        { modal: true, detail: 'Git is required to clone the repositories. Install it, restart VS Code, and run Setup again.' },
        'Download Git'
      );
      if (action === 'Download Git') {
        vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/download/win'));
      }
      return;
    }

    const prereqDetails = [
      `✔ Git: ${gitVersion}`,
      nodeVersion
        ? `✔ Node.js: ${nodeVersion}`
        : `⚠ Node.js: not found (needed later for MCP servers)`
    ].join('\n');

    const prereqChoice = await vscode.window.showInformationMessage(
      'DH Champion: prerequisites',
      { modal: true, detail: prereqDetails },
      'Continue'
    );
    if (prereqChoice !== 'Continue') {
      return;
    }

    // 3. Sign in with Microsoft (VS Code handles the sign-in window)
    let session: vscode.AuthenticationSession;
    try {
      session = await vscode.authentication.getSession('microsoft', [ADO_SCOPE], { createIfNone: true });
    } catch {
      vscode.window.showWarningMessage('DH Champion: sign-in was cancelled.');
      return;
    }

    // 4. Check each configured repo exists in Azure DevOps
    let checkLines: string[];
    let missing: Repo[];
    try {
      const projects = [...new Set(repos.map(r => r.project ?? ADO_PROJECT))];
      const reposByProject = new Map<string, string[]>();
      for (const project of projects) {
        reposByProject.set(project, await listAdoRepos(session.accessToken, project));
      }

      missing = repos.filter(r =>
        !reposByProject.get(r.project ?? ADO_PROJECT)!.includes(r.name.toLowerCase())
      );
      checkLines = repos.map(r =>
        missing.includes(r) ? `✖ ${r.name}: not found` : `✔ ${r.name}`
      );
    } catch (error) {
      await vscode.window.showErrorMessage('DH Champion: could not reach Azure DevOps', {
        modal: true,
        detail: String(error instanceof Error ? error.message : error)
      });
      return;
    }

    if (missing.length > 0) {
      await vscode.window.showErrorMessage('DH Champion: some repositories were not found', {
        modal: true,
        detail: [...checkLines, '', 'Fix the names in Settings → DH Champion and run Setup again.'].join('\n')
      });
      return;
    }

    const repoChoice = await vscode.window.showInformationMessage(
      'DH Champion: signed in and repositories found',
      { modal: true, detail: [`Signed in as: ${session.account.label}`, '', ...checkLines].join('\n') },
      'Continue'
    );
    if (repoChoice !== 'Continue') {
      return;
    }

    // 5. Choose where the repos will be cloned
    const lastFolder = context.globalState.get<string>(LAST_FOLDER_KEY);

    const picked = await vscode.window.showOpenDialog({
      title: 'DH Champion: choose where to clone the repositories',
      openLabel: 'Use this folder',
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: lastFolder ? vscode.Uri.file(lastFolder) : undefined
    });
    if (!picked || picked.length === 0) {
      return;
    }

    const folder = picked[0].fsPath;
    await context.globalState.update(LAST_FOLDER_KEY, folder);

    // 6. Clone the repositories
    log.show(true);
    log.appendLine('');
    log.appendLine(`=== DH Champion setup: cloning into ${folder} ===`);

    const results = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DH Champion' },
      async progress => {
        const all: CloneResult[] = [];
        for (const [i, repo] of repos.entries()) {
          progress.report({ message: `Cloning ${repo.name} (${i + 1}/${repos.length})...` });
          all.push(await cloneRepo(repo, folder, session.accessToken));
          progress.report({ increment: 100 / repos.length });
        }
        return all;
      }
    );

    // 7. Summary
    const summary = results.map(r =>
      r.status === 'cloned' ? `✔ ${r.repo.name}: cloned`
      : r.status === 'skipped' ? `↷ ${r.repo.name}: already there, skipped`
      : `✖ ${r.repo.name}: failed (see Output → DH Champion)`
    );
    const anyFailed = results.some(r => r.status === 'failed');

    log.appendLine(`=== Done ===`);

    await vscode.window.showInformationMessage(
      anyFailed ? 'DH Champion: setup finished with errors' : 'DH Champion: repositories ready',
      { modal: true, detail: [`Folder: ${folder}`, '', ...summary].join('\n') }
    );
  });

  context.subscriptions.push(setup);
}

export function deactivate() {}
