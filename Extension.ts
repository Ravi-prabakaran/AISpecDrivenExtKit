# DH Champion

Sets up your AI-driven development environment in one command: the repositories, the MCP
servers, and the shared Copilot skills and knowledge base. Everyone on the team ends up
with an identical setup.

Allow about 15 minutes for the first run. After that it takes under a minute.

## What it does

Running **DH Champion: Setup** will:

- Check your prerequisites and tell you what is missing
- Sign you in with your Microsoft work account
- Clone the DigitalHub repositories, each on its correct base branch
- Install our shared Copilot skills, instructions and knowledge base
- Configure the Azure DevOps and Microsoft Learn MCP servers
- Open everything as a single workspace

Run it again any time to pick up updated skills. Repositories you already have are skipped.

## Before you start

| | Why | Check with |
| --- | --- | --- |
| **Git** 2.31+ | Cloning the repositories | `git --version` |
| **Node.js** 20+ | Running the Azure DevOps MCP server | `node --version` |
| **Azure CLI** (recommended) | Sign in once instead of being prompted later | `az --version` |
| **GitHub Copilot** | Signed in, agent mode available | Open Copilot Chat |

Azure CLI is optional but worth installing first. Without it, the Azure DevOps MCP server
asks you to sign in through a browser the first time you use it in chat. With it, you sign
in once during setup and never again.
Get it from <https://aka.ms/installazurecliwindows>.

## Getting started

1. Press `Ctrl+Shift+P` and run **DH Champion: Setup**.
2. Review what will be set up, then click **Continue**.
3. Check the prerequisites screen. Git is required; the rest are warnings you can proceed
   past.
4. Sign in with your Microsoft work account when prompted.
5. Confirm the repositories were found. Setup verifies each one exists before cloning.
6. Sign in to Azure when prompted. This happens once.
7. Choose a folder, for example `C:\Work\DigitalHub`. Pick an empty one.
8. Wait while the repositories clone. Detail appears in **Output → DH Champion**.
9. Click **Open Workspace**.

## Checking it worked

**Explorer** shows `ai-hub` plus each repository as separate top-level folders.

**Source Control** lists all the repositories. If it shows nothing, run
**Developer: Reload Window**; VS Code does not always notice repositories that appeared
while it was running.

**Copilot Chat:** switch the mode dropdown to **Agent** (MCP tools do not work in Ask mode),
type `/` and look for the `dh-` commands.

Then run **DH Champion: Doctor**. It checks everything and opens a report.

## Using it

### Starting work on a story

In Copilot Chat, in Agent mode:

```
/dh-branch 1226224
```

It reads the work item from Azure DevOps, builds a branch name from our convention, and
creates the branch from the correct base branch for that repository.

Copilot asks permission before running each git command. "Allow in this session" is
reasonable; it will ask again next time you open VS Code.

### Rules that apply automatically

Some guidance attaches itself based on the file you are editing, with no command needed.
Opening a data-access class brings in our brand-awareness rules, so Copilot knows which
tables require `BrandId`. You do not need to do anything for this to work.

### Staying up to date

The skills and knowledge base live in a repository that changes as the team improves them.
Run **DH Champion: Setup** again to pick up the latest. Worth doing every week or two;
Doctor will tell you when you are behind.

### Where the skills come from

The skills, instructions and knowledge base live in **MM.DigitalHub.AIKnowledgeHub**. They
are cloned into the `ai-hub` folder of your workspace, so you can read exactly what Copilot
is being told.

Improvements are welcome. Raise a pull request against `master`: a clearer skill, a
correction to a knowledge document, or a new analysis worth sharing. Everyone picks it up
the next time they run Setup.

Do not edit the files in `ai-hub` locally. Setup overwrites them, so your change would only
affect you, and only until the next run.

## Commands

| Command | What it does |
| --- | --- |
| `DH Champion: Setup` | Runs the full setup, or updates an existing workspace |
| `DH Champion: Doctor` | Checks everything and produces a diagnostic report |

## Settings

Search for `DH Champion` in Settings.

| Setting | What it controls |
| --- | --- |
| `dhChampion.repositories` | Which repositories to clone, and each one's base branch |
| `dhChampion.branchPattern` | Feature branch naming convention |
| `dhChampion.mcpServers` | Which MCP servers to configure |
| `dhChampion.sharedRepository` | Where the shared AI assets come from |

The defaults are correct for most people. Changes apply to your machine only.

## Common problems

**Repositories or MCP servers missing after setup**
Run **Developer: Reload Window**. This fixes it more often than anything else.

**Two sets of Azure DevOps tools in chat**
You had your own MCP configuration before installing this. Both are active, which confuses
the agent. Run **MCP: List Servers**, find your original `azure-devops` entry, and disable
it for this workspace. Your other projects are unaffected. Setup warns you when it detects
this.

**An MCP server will not start**
Run **MCP: List Servers**, select the failing server, and choose **Show Output**. Usually
Node.js is missing, or the corporate proxy is blocking the npm registry.

**A repository failed to clone**
Check **Output → DH Champion**. Usually the configured base branch does not exist in that
repository, or you lack access to it in Azure DevOps.

**Setup cannot reach the shared repository**
Check you have access to MM.DigitalHub.AIKnowledgeHub in Azure DevOps. If it is a wider
outage, you can clone that repo yourself and copy its `.github` folder into your workspace,
renaming `dh-context.default.md` to `dh-context.md`. Please report it so it gets fixed
properly rather than leaving everyone on manual copies.

**Copilot is not following our conventions**
Check you are in **Agent** mode, not Ask mode. Then run Doctor to confirm the shared assets
are present and current.

## Getting help

Run **DH Champion: Doctor**, click **Copy Report**, and paste it with your question. It
contains almost everything needed to diagnose a problem.

Contact: *<add your name or team channel here>*
