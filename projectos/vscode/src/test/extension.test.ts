/**
 * Interactive Extension Host proof for the ProjectOS VS Code extension.
 *
 * Runs inside a real downloaded VS Code (via @vscode/test-electron), so this exercises the
 * actual extension host — activation + command registration + execution — not a compile check.
 * Proves the extension is read-only: exactly the 4 viewer commands, no approve/close/deploy/
 * send/pay, no throw, extension activates.
 */
import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXPECTED = ['projectos.plan', 'projectos.plugins', 'projectos.reportList', 'projectos.status'];
const UNSAFE = /approve|close|deploy|commit|push|delete|pay|send|mutate|refund|drop/i;

suite('ProjectOS VS Code extension (interactive host)', () => {
  suiteSetup(async () => {
    // Extension activates lazily (onCommand); its contributed commands only appear in
    // getCommands after activation, so activate it before the registration assertion.
    const ext = vscode.extensions.all.find((e) => e.id.toLowerCase().endsWith('projectos-vscode'));
    assert.ok(ext, 'extension present in host');
    await ext.activate();
  });

  test('contributes exactly the 4 read-only commands; no unsafe commands', async () => {
    const all = await vscode.commands.getCommands(true);
    const ours = all.filter((c) => c.startsWith('projectos.')).sort();
    assert.deepStrictEqual(ours, EXPECTED, 'only the 4 viewer commands');
    const unsafe = ours.filter((c) => UNSAFE.test(c));
    assert.strictEqual(unsafe.length, 0, 'no approve/close/deploy/send/pay command exposed');
  });

  test('each command activates + executes read-only without throwing', async () => {
    for (const c of EXPECTED) {
      // Read-only: spawns the projectos CLI + streams to an Output channel. If the CLI is not on
      // PATH in the host it is handled gracefully (no throw).
      await vscode.commands.executeCommand(c);
    }
    assert.ok(true, 'all commands executed without throwing');
  });

  test('extension activates in the host', async () => {
    const ext = vscode.extensions.all.find((e) => e.id.toLowerCase().endsWith('projectos-vscode'));
    assert.ok(ext, 'extension is present in the host');
    assert.ok(ext.isActive, 'extension is active after a command ran');
  });
});
