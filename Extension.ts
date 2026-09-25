// Looks for user-level MCP servers that do the same job as ours, so we can
// warn about duplicate tools instead of silently competing with them.
function findDuplicateUserServers(context: vscode.ExtensionContext): string[] {
  const userMcpPath = path.resolve(context.globalStorageUri.fsPath, '..', '..', 'mcp.json');
  if (!fs.existsSync(userMcpPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(userMcpPath, 'utf8')) as { servers?: Record<string, unknown> };
    const names = Object.keys(parsed.servers ?? {});
    // Anything mentioning these is likely to overlap with what we configure.
    return names.filter(n => /devops|learn/i.test(n));
  } catch {
    return [];
  }
}

------
    const duplicates = findDuplicateUserServers(context);
    if (duplicates.length) {
      log.appendLine(`⚠ User-level MCP servers that may duplicate ours: ${duplicates.join(', ')}`);
    }


---

            duplicates.length
            ? `⚠ You also have these servers configured globally: ${duplicates.join(', ')}.\n   Disable them for this workspace (MCP: List Servers) to avoid duplicate tools.`
            : '',
