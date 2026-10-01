// 用法：node scripts/build-plays-doc.mjs
// 透過 Vite 載入 TypeScript，產生 docs/PLAYS.md 與 docs/plays/*.svg。

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildPlaysDoc } = await server.ssrLoadModule('/scripts/plays-doc.ts');
  const { markdown, svgs } = buildPlaysDoc();
  // 先清掉舊圖，戰術改名或刪除時才不會留下過期的檔案
  await rm('docs/plays', { recursive: true, force: true });
  await mkdir('docs/plays', { recursive: true });
  await writeFile('docs/PLAYS.md', markdown);
  for (const [id, svg] of Object.entries(svgs)) await writeFile(`docs/plays/${id}.svg`, svg);
  console.log(`docs/PLAYS.md + ${Object.keys(svgs).length} 張分鏡圖`);
} finally {
  await server.close();
}
