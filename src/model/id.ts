/** 產生短 id。不用 crypto.randomUUID，因為用 http 區網 IP 在手機上測試時它不存在。 */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
