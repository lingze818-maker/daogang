export const SUMMARY_MAX = 80
export const INPUT_MAX = 4000

export function charLength(text: string): number {
  return Array.from(text).length
}

export function clampText(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return chars.slice(0, max).join('')
}

export function collapseSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
