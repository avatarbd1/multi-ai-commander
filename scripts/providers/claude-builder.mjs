#!/usr/bin/env node
import { spawn } from 'node:child_process';

async function readStdinJson() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error('PROVIDER_INPUT_REQUIRED');
  return JSON.parse(raw);
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p', prompt,
      '--output-format', 'json',
      '--max-turns', '20',
      '--allowedTools', 'Read', 'Glob', 'Grep', 'Edit', 'Write',
    ], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        DISABLE_AUTOUPDATER: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 16384) stderr += chunk; });
    child.on('error', () => reject(new Error('CLAUDE_COMMAND_START_FAILED')));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLAUDE_COMMAND_FAILED:${code ?? 'signal'}`));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('CLAUDE_COMMAND_INVALID_JSON')); }
    });
  });
}

try {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY_REQUIRED');
  const input = await readStdinJson();
  const prompt = [
    'You are the bounded Builder inside Multi-AI Commander.',
    'Work only in the current workspace. Implement the supplied TaskContract and nothing outside its constraints.',
    'Do not push, merge, deploy, access GitHub APIs, or request credentials. Commander owns publication and CI.',
    'You may read/search/edit/write files using only the tools granted by this process. Commander will run deterministic verification after you exit.',
    input.repair ? 'This is a repair attempt. Preserve prior accepted work and address only the supplied repair evidence plus the original task.' : 'This is the initial implementation attempt.',
    'When finished, return a concise final message summarizing the changes and any known limitations.',
    `REQUEST_JSON:\n${JSON.stringify(input)}`,
  ].join('\n\n');
  const response = await runClaude(prompt);
  const summary = typeof response?.result === 'string' && response.result.trim()
    ? response.result.trim().slice(0, 12000)
    : 'Claude Builder completed the bounded workspace edit.';
  process.stdout.write(JSON.stringify({ summary, knownLimitations: [] }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'CLAUDE_BUILDER_FAILED'}\n`);
  process.exitCode = 1;
}
