    // 8. Shared assets, context file, workspace file and MCP config
    const sharedRepo = config.get<string>('sharedRepository') ?? 'MM.DigitalHub.AIKnowledgeHub';
    const sharedHash = await cloneOrUpdateShared(sharedRepo, folder, session.accessToken);

    const workspacePath = writeWorkspaceFile(folder, repos);
    const version = context.extension.packageJSON.version as string;
    if (sharedHash) {
      writeContextFile(folder, repos, branchPattern, version);
    }

    const mcpServerIds = config.get<string[]>('mcpServers') ?? [];
    const configured = writeWorkspaceMcpConfig(folder, mcpServerIds, useAzureCli);
    const duplicates = findDuplicateUserServers(context);
    if (duplicates.length) {
      log.appendLine(`⚠ User-level MCP servers that may duplicate ours: ${duplicates.join(', ')}`);
    }
    log.appendLine('=== Done ===');



---

            sharedHash
            ? `AI assets: ${sharedRepo} @ ${sharedHash}`
            : `⚠ AI assets: could not clone ${sharedRepo} (see Output → DH Champion)`,
