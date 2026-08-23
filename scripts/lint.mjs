import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['src', 'tests', 'scripts'];
const problems = [];

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(?:ts|mjs)$/.test(entry.name)) {
      const lines = (await readFile(full, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (/\s+$/.test(line)) problems.push(`${full}:${index + 1}: trailing whitespace`);
        if (line.includes('\t')) problems.push(`${full}:${index + 1}: tab character`);
      });
    }
  }
}

for (const root of roots) await walk(root);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('lint: clean');
