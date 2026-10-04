// 視覺風格（SPEC §10.2）
export const theme = {
  floor: '#d9a86c',
  line: '#ffffff',
  paintTop: '#2f4f7a',
  paintBottom: '#1d3557',
  blue: { light: '#5b93ff', dark: '#1f56e0' },
  red: { light: '#e2555c', dark: '#b3232d' },
  ring: '#f4f4f4',
  path: { blue: '#1a3ea8', red: '#9c1d27' },
  selection: 'rgba(255,255,255,0.85)',
  /** 路線底下的淺色外框：路線要同時在原木地板（淺）和深藍禁區（深）上看得清楚，只靠路線本身的顏色做不到 */
  pathHalo: 'rgba(255,255,255,0.6)',
  label: '#ffffff',
  ball: { light: '#f0873a', dark: '#c85d17', seam: '#3b1d0b' },
  font: '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
} as const;
