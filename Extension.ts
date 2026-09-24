"dhChampion.mcpServers": {
  "type": "array",
  "items": { "type": "string", "enum": ["azure-devops", "microsoft-learn"] },
  "default": ["azure-devops", "microsoft-learn"],
  "description": "MCP servers to configure during setup."
}


// Definitions of the official MCP servers we support.
function mcpServerDefinition(id: string): object | undefined {
  switch (id) {
    case 'azure-devops':
      return {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@azure-devops/mcp@2.3.0', ADO_ORGANIZATION]
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

// Writes .vscode/mcp.json next to the workspace file, unless one already exists.
function writeMcpConfig(folder: string, serverIds: string[]): 'written' | 'skipped' {
  const vscodeDir = path.join(folder, '.vscode');
  const mcpPath = path.join(vscodeDir, 'mcp.json');

  if (fs.existsSync(mcpPath)) {
    log.appendLine(`↷ MCP config already exists at ${mcpPath}, leaving it alone.`);
    return 'skipped';
  }

  const servers: Record<string, object> = {};
  for (const id of serverIds) {
    const definition = mcpServerDefinition(id);
    if (definition) {
      servers[id] = definition;
    }
  }

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify({ servers }, null, 2), 'utf8');
  log.appendLine(`✔ MCP config written: ${mcpPath}`);
  return 'written';
}

-----

    // 7. Build the workspace and MCP config
    const workspacePath = writeWorkspaceFile(folder, repos);
    const mcpServerIds = config.get<string[]>('mcpServers') ?? [];
    const mcpStatus = writeMcpConfig(folder, mcpServerIds);
    log.appendLine('=== Done ===');


----

            mcpStatus === 'written'
            ? `MCP servers: ${mcpServerIds.join(', ')}`
            : `MCP servers: existing mcp.json kept`

