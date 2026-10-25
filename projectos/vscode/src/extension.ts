/**
 * ProjectOS VS Code extension.
 *
 * Thin bridge: each command spawns the `projectos` CLI in the active workspace folder and
 * streams its output to a dedicated Output channel. The extension never edits code or runs
 * anything gated — it surfaces the CLI (which itself enforces the governance rules).
 *
 * Requires the `projectos` CLI on PATH (or a workspace-local `projectos/agent/bin/projectos.js`).
 */
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';

const CHANNEL_NAME = 'ProjectOS';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runCli(channel: vscode.OutputChannel, args: readonly string[]): void {
  const cwd = workspaceRoot();
  if (cwd === undefined) {
    void vscode.window.showWarningMessage('ProjectOS: open a folder first.');
    return;
  }
  channel.show(true);
  channel.appendLine(`$ projectos ${args.join(' ')}`);
  execFile('projectos', [...args], { cwd }, (error, stdout, stderr) => {
    if (stdout) channel.append(stdout);
    if (stderr) channel.append(stderr);
    if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      channel.appendLine('[projectos CLI not found on PATH — build/link projectos/agent]');
    }
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  context.subscriptions.push(channel);

  const commands: ReadonlyArray<[string, readonly string[]]> = [
    ['projectos.status', ['status']],
    ['projectos.plan', ['plan']],
    ['projectos.plugins', ['plugins']],
    ['projectos.reportList', ['report']],
  ];

  for (const [id, args] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () => runCli(channel, args)),
    );
  }
}

export function deactivate(): void {
  // no-op
}
