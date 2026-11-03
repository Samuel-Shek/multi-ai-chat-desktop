import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'auth.openai.com',
  'auth0.openai.com',
  'openai.com',
  'gsi.google.com',
  'www.google.com',
  'accounts.google.com',
  'accounts.google.com.tw',
  'gemini.google.com',
  'google.com',
  'grok.com',
  'x.com',
  'twitter.com',
  'accounts.x.ai',
  'auth.grokusercontent.com',
  'auth.grok.com',
  'auth.grokipedia.com',
  'challenges.cloudflare.com',
  'accounts.youtube.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'ipc.localhost',
  'asset.localhost',
  'localhost',
  'mac-bridge.invalid',
  // Inert strings shipped inside React and the Tauri config schema. They are not requests.
  'www.w3.org',
  'reactjs.org',
  'schema.tauri.app',
]);

const FORBIDDEN = [
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'ted-h.com',
  'ai-sister.com',
  'sentry.io',
  'posthog.com',
  'googletagmanager.com',
  'google-analytics.com',
  'mixpanel.com',
];

const URL_HOST = /https?:\/\/([^/?#\s"'`<>\\]+)/gi;

const SCAN_ROOTS = [
  'dist',
  'src-tauri/gen/injected',
  'src-tauri/src',
  'adapters/chatgpt.json',
  'adapters/grok.json',
  'adapters/gemini.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities',
  'src-tauri/build.rs',
];

function endOfBrace(source, openBrace) {
  let depth = 0;
  for (let position = openBrace; position < source.length; position += 1) {
    const char = source[position];
    if (char === '/' && source[position + 1] === '/') {
      position = source.indexOf('\n', position);
      if (position === -1) break;
      continue;
    }
    if (char === '/' && source[position + 1] === '*') {
      const end = source.indexOf('*/', position + 2);
      position = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('br#', position) || source.startsWith('r#', position) || source[position] === 'r' && source[position + 1] === '"') {
      let cursor = position;
      if (source.startsWith('br', cursor) || source.startsWith('b', cursor) && source[cursor + 1] === 'r') cursor += source.startsWith('br', cursor) ? 2 : 1;
      if (source[cursor] === 'r') cursor += 1;
      let hashes = 0;
      while (source[cursor] === '#') {
        hashes += 1;
        cursor += 1;
      }
      if (source[cursor] === '"') {
        const closer = `"${'#'.repeat(hashes)}`;
        const end = source.indexOf(closer, cursor + 1);
        position = end === -1 ? source.length : end + closer.length - 1;
        continue;
      }
    }
    if (char === '"' || char === "'") {
      const quote = char;
      position += 1;
      while (position < source.length) {
        if (source[position] === '\\') {
          position += 2;
          continue;
        }
        if (source[position] === quote) break;
        position += 1;
      }
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return position + 1;
    }
  }
  throw new Error('unbalanced #[cfg(test)] body');
}

function stripCfgTest(source) {
  const marker = '#[cfg(test)]';
  let result = '';
  let index = 0;
  while (index < source.length) {
    const at = source.indexOf(marker, index);
    if (at === -1) {
      result += source.slice(index);
      break;
    }
    result += source.slice(index, at);
    let cursor = at + marker.length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    const head = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|mod|struct|enum|impl|const|static|type|use|trait)\b/.exec(
      source.slice(cursor),
    );
    if (!head) {
      throw new Error(`could not parse #[cfg(test)] item at offset ${at}`);
    }
    cursor += head[0].length;
    if (head[1] === 'use') {
      const semi = source.indexOf(';', cursor);
      if (semi === -1) throw new Error('unterminated #[cfg(test)] use');
      index = semi + 1;
      continue;
    }
    const brace = source.indexOf('{', cursor);
    const semi = source.indexOf(';', cursor);
    if (semi !== -1 && (brace === -1 || semi < brace)) {
      index = semi + 1;
      continue;
    }
    if (brace === -1) throw new Error('#[cfg(test)] item has no body');
    index = endOfBrace(source, brace);
  }
  return result;
}

async function filesUnder(relativePath) {
  const absolute = path.join(root, relativePath);
  const info = await stat(absolute);
  if (!info.isDirectory()) return [absolute];
  const found = [];
  const pending = [absolute];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(next);
      else if (/\.(js|mjs|cjs|css|html|json|rs|txt|map)$/.test(entry.name)) found.push(next);
    }
  }
  return found;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const failures = [];

for (const relative of SCAN_ROOTS) {
  let files;
  try {
    files = await filesUnder(relative);
  } catch (error) {
    failures.push(`${relative}: missing (${error.message}). Run pnpm build and pnpm build:injected first.`);
    continue;
  }
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const source = file.endsWith('.rs') ? stripCfgTest(raw) : raw;
    const display = path.relative(root, file);
    for (const token of FORBIDDEN) {
      const at = source.indexOf(token);
      if (at !== -1) {
        failures.push(`${display}:${lineOf(source, at)} contains ${token}`);
      }
    }
    for (const match of source.matchAll(URL_HOST)) {
      const host = match[1].replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(host)) continue;
      if (!ALLOWED_HOSTS.has(host)) {
        failures.push(`${display}:${lineOf(source, match.index)} uses non-provider host ${host}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Remote-host check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('No remote or non-provider hosts in the built frontend, injected scripts, or Rust sources.');
