// 用法：node scripts/build-plays-doc.mjs
// 透過 Vite 載入 TypeScript，產生 docs/PLAYS.md 與 docs/plays/*.svg。

import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildPlaysDoc } = await server.ssrLoadModule('/scripts/plays-doc.ts');
  const { markdown, svgs } = buildPlaysDoc();
  await mkdir('docs/plays', { recursive: true });
  await writeFile('docs/PLAYS.md', markdown);
  for (const [id, svg] of Object.entries(svgs)) await writeFile(`docs/plays/${id}.svg`, svg);
  console.log(`docs/PLAYS.md + ${Object.keys(svgs).length} 張分鏡圖`);
} finally {
  await server.close();
}
