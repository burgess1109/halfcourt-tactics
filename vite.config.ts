import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 用相對路徑：部署在子目錄（例如 GitHub Pages）也能正常載入
  base: './',
  plugins: [
    // PWA（SPEC §10）：預先快取所有檔案，可以離線使用、加到主畫面。
    // 有新版本時自動更新（重新整理後生效），不打斷正在編輯的戰術。
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // 只能有一種語言（打包時產生）：名稱用雙語，主畫面圖示下的短名稱用英文（太長會被截斷）
        name: '半場戰術板 Halfcourt Tactics',
        short_name: 'Halfcourt',
        description: '3 對 3 半場籃球戰術：設定球隊、設計跑位，系統模擬防守並評分',
        lang: 'zh-Hant-TW',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // 分享連結的資料在 hash 裡，不會送到伺服器；離線時任何網址都回應 index.html
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
