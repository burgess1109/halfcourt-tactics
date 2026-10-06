// 內建戰術的參考影片（SPEC §6.3）。只要改這個檔案就能新增、修改、刪除連結。
// key 是戰術的 id（src/plays/library.ts），每套最多 3 個；同一套戰術的所有出手點共用。
// 顯示在戰術庫卡片與評分卡片（從這套戰術載入的戰術），點擊開新分頁；docs/PLAYS.md 也會列出（改完執行 npm run plays-doc）。
// 網址必須是 https，plays.test.ts 會檢查 id、數量與網址格式。

export interface PlayVideo {
  /** 顯示文字 */
  title: string;
  url: string;
}

/** 每套戰術最多幾個影片 */
export const MAX_VIDEOS = 3;

const PNR_BASICS: PlayVideo[] = [
  { title: '擋拆教學', url: 'https://www.youtube.com/watch?v=IULh8LwbDZE' },
  { title: '籃球教學 - Pick&Roll擋拆攻擊', url: 'https://www.youtube.com/watch?v=B_Ofn946hXo' },
];

const DHO_BASICS: PlayVideo[] = [{ title: 'DHO: Dribble Pitch/Dribble Screen', url: 'https://www.youtube.com/watch?v=Oqzx1JElX5g' }];

export const PLAY_VIDEOS: Readonly<Record<string, readonly PlayVideo[]>> = {
  // 高位擋拆-Pull-up Jumper
  'high-pnr-pullup': PNR_BASICS,
  // 高位擋拆-Floater
  'high-pnr-floater': PNR_BASICS,
  // 高位擋拆-Drive to Rim
  'high-pnr-drive': PNR_BASICS,
  // 高位擋拆-Pick and Pop
  'high-pnr-pop': [{ title: '新北國王湯瑪士 Pick & Pop', url: 'https://www.youtube.com/watch?v=5SUNHcFeGj4' }],
  // 高位擋拆-Pick and Roll
  'high-pnr-roll': [
    { title: 'Pick＆Roll 擋拆小組配合', url: 'https://www.youtube.com/watch?v=puZxpKfcv7Y' },
    { title: 'How Pick And Roll In Basketball', url: 'https://www.youtube.com/watch?v=bwT15tI3H70' },
    { title: 'OVER THE TOP PASS TO ROLL MAN', url: 'https://www.youtube.com/watch?v=ZRY_dhTSWTM' },
  ],
  // 高位擋拆-Spain Pick and Roll
  'high-pnr-spain': [
    { title: '三對三超實用戰術：西班牙擋拆', url: 'https://www.facebook.com/watch/?v=174199876616333' },
    { title: '3x3 Playbook - Spanish Pick and Roll', url: 'https://www.youtube.com/watch?v=db22lmGpGbM' },
  ],
  // 空切-Pass and Cut
  'cut-give-go': [{ title: 'The Give-and-Go', url: 'https://www.youtube.com/watch?v=LOL5ZNuP7vk' }],
  // 空切-Backdoor Cut
  'cut-backdoor': [
    { title: 'The Backdoor Cut', url: 'https://www.youtube.com/watch?v=O4EX3P76h_U' },
    { title: 'NBA Cutting- Backdoor Cuts', url: 'https://www.youtube.com/watch?v=RzfXykjY_L4' },
  ],
  // 無球掩護-Down Screen
  'offball-down': [{ title: '無球擋拆影片分析 | 下擋down screen進攻選項', url: 'https://www.youtube.com/watch?v=1HuVxCLThjM' }],
  // 無球掩護-Back Screen
  'offball-back': [
    { title: '4 High Set Play - Back Screen and Ball Screen Options', url: 'https://www.youtube.com/watch?v=2S8FFvIP9_U' },
  ],
  // 無球掩護-Post Split
  'offball-post-split': [{ title: 'Golden State Offense - Post Split', url: 'https://www.youtube.com/watch?v=ivcb5niZ-PM' }],
  // 無球掩護-Flare Screen
  'offball-flare': [
    { title: '林志傑 Flare Screen', url: 'https://www.youtube.com/watch?v=5g41UVABV0I' },
    { title: 'The BEST Way to Use Flare Screens in Basketball', url: 'https://www.youtube.com/watch?v=Fy_rEXaU4jM' },
  ],
  // 手遞手-DHO to Drive
  'dho-drive': DHO_BASICS,
  // 手遞手-DHO to Shoot
  'dho-shoot': DHO_BASICS,
  // 手遞手-Fake Hand-Off
  'dho-fake': [{ title: 'Fake Handoff Breakdown', url: 'https://www.youtube.com/watch?v=41sDICfHVlo' }],
  // 手遞手-Chicago
  'dho-chicago': [{ title: '籃球字典: ZOOM|CHICAGO 戰術', url: 'https://www.youtube.com/watch?v=JWRnjldFXWQ' }],
  // 單打-Hunting the Mismatch
  'iso-mismatch': [
    { title: '球场上最常用的战术？如何快速形成错位？3种制造错位战术教程', url: 'https://www.youtube.com/watch?v=-naJ7vD3YgI' },
  ],
};

/** 這套戰術的參考影片（沒有就是空陣列） */
export const videosOf = (playId: string | undefined): readonly PlayVideo[] => (playId && PLAY_VIDEOS[playId]) || [];
