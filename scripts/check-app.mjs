import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const root = fileURLToPath(new URL('..', import.meta.url));

const collect = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, files);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
};

const files = [path.join(root, 'App.tsx'), ...collect(path.join(root, 'src'))];

for (const file of files) {
  const plugins = ['typescript', 'classProperties', 'objectRestSpread'];
  if (file.endsWith('.tsx')) plugins.push('jsx');
  const source = fs.readFileSync(file, 'utf8');
  parse(source, { sourceType: 'module', plugins });
}

console.log(`Aegis RN code check passed (${files.length} files)`);
