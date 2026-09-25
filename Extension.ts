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

// Workspace file and the shared folder for AI assets.
// The assets folder is listed first, which makes it the primary workspace
// folder, and that is where VS Code looks for MCP config and skills.
const WORKSPACE_FILE = 'dh-champion.code-workspace';
const ASSETS_FOLDER = 'dh-champion';

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
    return stdout.trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

// True if Azure CLI already has a signed-in account.
async function isAzureCliSignedIn(): Promise<boolean> {
  try {
    await execFileAsync('az', ['account', 'show'], { shell: true });
    return true;
  } catch {
    return false;
  }
}

// Opens the browser for Azure CLI sign-in. Resolves when sign-in completes.
async function azureCliLogin(): Promise<boolean> {
  try {
    await execFileAsync('az', ['login'], { shell: true, timeout: 5 * 60 * 1000 });
    return true;
  } catch (error) {
    log.appendLine(`✖ az login failed: ${String(error)}`);
    return false;
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

// Definitions of the official MCP servers we support.
// useAzureCli controls how the Azure DevOps server authenticates.
function mcpServerDefinition(id: string, useAzureCli: boolean): object | undefined {
  switch (id) {
    case 'azure-devops':
      return {
        type: 'stdio',
        command: 'npx',
        args: [
          '-y',
          '@azure-devops/mcp@2.3.0',
          ADO_ORGANIZATION,
          ...(useAzureCli ? ['--authentication', 'azcli'] : [])
        ]
      };
    case 'microsoft-learn':
      return {
        type: 'http',
        url: 'https://learn.microsoft.com/api/mcp'
      };
    default:
      return undefined;
  }
}

// Writes the MCP config into the assets folder, which is the primary
// workspace folder. This is scoped to the workspace and never touches
// the developer's own user-level mcp.json.
function writeWorkspaceMcpConfig(folder: string, serverIds: string[], useAzureCli: boolean): string[] {
  const vscodeDir = path.join(folder, ASSETS_FOLDER, '.vscode');
  const mcpPath = path.join(vscodeDir, 'mcp.json');

  const servers: Record<string, object> = {};
  const configured: string[] = [];
  for (const id of serverIds) {
    const definition = mcpServerDefinition(id, useAzureCli);
    if (definition) {
      servers[id] = definition;
      configured.push(id);
    }
  }

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify({ servers }, null, 2), 'utf8');

  log.appendLine(`✔ MCP config written: ${mcpPath}`);
  log.appendLine(`   servers: ${configured.join(', ') || 'none'}`);
  log.appendLine(`   authentication: ${useAzureCli ? 'Azure CLI session' : 'browser sign-in on first use'}`);
  return configured;
}

// Generates the AI assets into the primary workspace folder's .github directory.
// These files are regenerated on every Setup run, so local edits do not survive.
function writeAiAssets(folder: string, repos: Repo[], branchPattern: string, version: string): string[] {
  const githubDir = path.join(folder, ASSETS_FOLDER, '.github');
  const written: string[] = [];

  const repoTable = repos
    .map(r => `| ${r.name} | ${r.project ?? ADO_PROJECT} | ${r.baseBranch ?? DEFAULT_BASE_BRANCH} |`)
    .join('\n');

  // Always-on context for Copilot in this workspace.
  const copilotInstructions = `# Working in this workspace

This workspace contains our Azure DevOps repositories and the shared AI assets
that drive spec driven development. It is generated by the DH Champion extension.

## Repositories

| Repository | Project | Base branch |
| --- | --- | --- |
${repoTable}

## Conventions

- Azure DevOps organization: \`${ADO_ORGANIZATION}\`
- Feature branches follow the pattern \`${branchPattern}\`
- Always branch from the repository's base branch shown above, never from another feature branch.
- Use the Azure DevOps tools to read work items rather than guessing their contents.
`;

  fs.mkdirSync(githubDir, { recursive: true });
  fs.writeFileSync(path.join(githubDir, 'copilot-instructions.md'), copilotInstructions, 'utf8');
  written.push('copilot-instructions.md');

  // Skill: create a feature branch from the correct base branch.
  const branchSkillDir = path.join(githubDir, 'skills', 'ai-branch');
  const branchSkill = `---
name: ai-branch
description: Create a feature branch for an Azure DevOps work item, from the correct base branch, using our naming convention.
---

# Create a feature branch

Use this skill when the user wants to start work on an Azure DevOps work item.

## Inputs

- A work item ID. If the user did not give one, ask for it before doing anything else.
- The target repository. If the user did not name one, ask which of the repositories below to use.

## Repositories and their base branches

| Repository | Project | Base branch |
| --- | --- | --- |
${repoTable}

## Steps

1. Read the work item from Azure DevOps to get its title and type. Do not guess the title.
2. Build a slug from the title: lowercase, spaces and punctuation replaced with hyphens,
   trimmed to at most 50 characters, with no trailing hyphen.
3. Build the branch name from the pattern \`${branchPattern}\`, substituting:
   - \`{workItemId}\` with the work item ID
   - \`{title}\` with the slug from step 2
4. In the chosen repository, run these commands in order:
   - \`git fetch origin\`
   - \`git checkout <base branch>\`
   - \`git pull\`
   - \`git checkout -b <branch name>\`
5. Report the branch you created, the base branch it came from, and the work item title.

## Rules

- Never branch from a branch other than the base branch listed above.
- Never push the branch. The user decides when to push.
- If the branch already exists, stop and tell the user rather than creating a variation.
- If the work item cannot be found, stop and report it. Do not invent a title.
`;

  fs.mkdirSync(branchSkillDir, { recursive: true });
  fs.writeFileSync(path.join(branchSkillDir, 'SKILL.md'), branchSkill, 'utf8');
  written.push('skills/ai-branch');

  // Version stamp, so we can detect drift later.
  fs.writeFileSync(
    path.join(githubDir, 'dh-champion.json'),
    JSON.stringify({ version, generatedAt: new Date().toISOString(), assets: written }, null, 2),
    'utf8'
  );

  log.appendLine(`✔ AI assets written: ${githubDir}`);
  log.appendLine(`   ${written.join(', ')}`);
  return written;
}

// Creates the assets folder and writes the multi-root workspace file.
// Both are generated, so they are rewritten every time Setup runs.
function writeWorkspaceFile(folder: string, repos: Repo[]): string {
  const assetsPath = path.join(folder, ASSETS_FOLDER);
  fs.mkdirSync(assetsPath, { recursive: true });

  const readme = path.join(assetsPath, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, '# DH Champion\n\nShared AI assets for spec driven development.\n', 'utf8');
  }

  const workspace = {
    folders: [
      // Must stay first: VS Code reads MCP config and skills from the primary folder.
      { name: 'DH Champion (AI assets)', path: ASSETS_FOLDER },
      ...repos.map(r => ({ name: r.name, path: r.name }))
    ],
    settings: {
      // Ask VS Code to start the MCP servers without the developer clicking Start.
      'chat.mcp.autostart': 'newAndOutdated'
    }
  };

  const workspacePath = path.join(folder, WORKSPACE_FILE);
  fs.writeFileSync(workspacePath, JSON.stringify(workspace, null, 2), 'utf8');
  log.appendLine(`✔ Workspace file written: ${workspacePath}`);
  return workspacePath;
}

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel('DH Champion');
  context.subscriptions.push(log);

  const setup = vscode.commands.registerCommand('dh-champion.setup', async () => {

    // 1. Show what will be set up
    const config = vscode.workspace.getConfiguration('dhChampion');
    const repos = config.get<Repo[]>('repositories') ?? [];
    const branchPattern = config.get<string>('branchPattern') ?? 'feature/{workItemId}-{title}';

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
    const azVersion = await getToolVersion('az');

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
      nodeVersion ? `✔ Node.js: ${nodeVersion}` : `⚠ Node.js: not found (needed for MCP servers)`,
      azVersion ? `✔ Azure CLI: ${azVersion}` : `⚠ Azure CLI: not found`,
      '',
      azVersion
        ? 'Azure CLI found, so you will sign in once now and the Azure DevOps MCP server will reuse that session.'
        : 'Without Azure CLI, the Azure DevOps MCP server will ask you to sign in through the browser the first time you use it in Copilot Chat.'
    ].join('\n');

    const prereqChoice = await vscode.window.showInformationMessage(
      'DH Champion: prerequisites',
      { modal: true, detail: prereqDetails },
      'Continue',
      ...(azVersion ? [] : ['Install Azure CLI'])
    );
    if (prereqChoice === 'Install Azure CLI') {
      vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/installazurecliwindows'));
      return;
    }
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

    // 5. Azure CLI sign-in, so the MCP server never has to ask later
    let useAzureCli = false;
    if (azVersion) {
      useAzureCli = await isAzureCliSignedIn();
      if (useAzureCli) {
        log.appendLine('✔ Azure CLI already signed in.');
      } else {
        const loginChoice = await vscode.window.showInformationMessage(
          'DH Champion: Azure sign-in',
          {
            modal: true,
            detail: 'A browser window will open so you can sign in to Azure.\nThis happens once. The Azure DevOps MCP server reuses this session afterwards.'
          },
          'Sign in'
        );
        if (loginChoice === 'Sign in') {
          useAzureCli = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'DH Champion: waiting for Azure sign-in in your browser...' },
            () => azureCliLogin()
          );
          if (!useAzureCli) {
            vscode.window.showWarningMessage('DH Champion: Azure CLI sign-in did not complete. The MCP server will ask you to sign in later instead.');
          }
        }
      }
    }

    // 6. Choose where the repos will be cloned
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

    // 7. Clone the repositories
    log.show(true);
    log.appendLine('');
    log.appendLine(`=== DH Champion setup: ${folder} ===`);

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

    // 8. Workspace file, AI assets and MCP config
    const workspacePath = writeWorkspaceFile(folder, repos);
    const assets = writeAiAssets(
      folder,
      repos,
      branchPattern,
      context.extension.packageJSON.version as string
    );
    const mcpServerIds = config.get<string[]>('mcpServers') ?? [];
    const configured = writeWorkspaceMcpConfig(folder, mcpServerIds, useAzureCli);
    log.appendLine('=== Done ===');

    // 9. Summary, then open the workspace
    const summary = results.map(r =>
      r.status === 'cloned' ? `✔ ${r.repo.name}: cloned`
      : r.status === 'skipped' ? `↷ ${r.repo.name}: already there, skipped`
      : `✖ ${r.repo.name}: failed (see Output → DH Champion)`
    );
    const anyFailed = results.some(r => r.status === 'failed');

    const openChoice = await vscode.window.showInformationMessage(
      anyFailed ? 'DH Champion: setup finished with errors' : 'DH Champion: workspace ready',
      {
        modal: true,
        detail: [
          `Folder: ${folder}`,
          '',
          ...summary,
          '',
          `MCP servers: ${configured.join(', ') || 'none'}`,
          `AI assets: ${assets.join(', ')}`,
          useAzureCli
            ? 'Azure DevOps: signed in via Azure CLI, no further prompts.'
            : 'Azure DevOps: will ask for browser sign-in on first use in Copilot Chat.'
        ].join('\n')
      },
      'Open Workspace'
    );

    if (openChoice === 'Open Workspace') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), {
        forceNewWindow: false
      });
    }
  });

  context.subscriptions.push(setup);
}

export function deactivate() {}
