import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import capability from '../../src-tauri/capabilities/default.json';
import tauriConfig from '../../src-tauri/tauri.conf.json';

function commandFunctions(source: string): { name: string; body: string }[] {
  const chunks = source.split('#[tauri::command]');
  chunks.shift();
  return chunks.flatMap((chunk) => {
    const match = chunk.match(/pub\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*\([^)]*\)[^{]*\{/);
    if (!match || match.index === undefined) return [];
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < chunk.length && depth > 0) {
      const char = chunk[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      index += 1;
    }
    return [{ name: match[1], body: chunk.slice(start, index) }];
  });
}

describe('Tauri control-pane security boundary', () => {
  it('grants IPC only to the local main webview', () => {
    expect(capability).toMatchObject({ webviews: ['main'] });
    expect(capability).not.toHaveProperty('windows');
    expect(capability).not.toHaveProperty('remote');
  });

  it('keeps provider pages from calling privileged commands', () => {
    const raw = JSON.stringify(capability);
    expect(capability.webviews).toEqual(['main']);
    for (const label of ['ai-chatgpt', 'ai-grok', 'ai-gemini', 'chatgpt', 'grok', 'gemini']) {
      expect(capability.webviews).not.toContain(label);
      expect(raw).not.toContain(label);
    }
    expect(raw).not.toMatch(/shell:|fs:|"remote"/);
    const srcDir = join(process.cwd(), 'src-tauri/src');
    const commands = readdirSync(srcDir)
      .filter((name) => name.endsWith('.rs'))
      .flatMap((name) => commandFunctions(readFileSync(join(srcDir, name), 'utf8')));
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) {
      expect(command.body, command.name).toContain('ensure_control_webview');
    }
  });

  it('enables a production CSP while leaving Vite development usable', () => {
    expect(tauriConfig.app.security).toMatchObject({
      csp: {
        'default-src': "'self'",
        'connect-src': 'ipc: http://ipc.localhost',
        'img-src': "'self' asset: http://asset.localhost blob: data:",
        'style-src': "'self' 'unsafe-inline'",
      },
      devCsp: null,
    });
  });
});
