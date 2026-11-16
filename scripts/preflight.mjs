#!/usr/bin/env node
/**
 * Checagens que evitam as duas falhas de setup local mais comuns.
 * Roda antes de `dev` e `build` (hooks `predev`/`prebuild` do npm).
 */
import { existsSync } from 'node:fs';

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk =
  major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);

if (!nodeOk) {
  console.error(`\n  Node ${process.versions.node} não serve para o Vite 8.`);
  console.error('  O Vite exige ^20.19 ou >= 22.12.');
  console.error('  Rode:  nvm use        (o .nvmrc deste repositório pede a linha 22)\n');
  process.exit(1);
}

if (!existsSync('node_modules/vite')) {
  console.error('\n  node_modules ausente ou incompleto (não achei o Vite).');
  console.error('  Rode:  npm ci\n');
  process.exit(1);
}
