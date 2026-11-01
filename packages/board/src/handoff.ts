/** 交接备注上限。按 Unicode 码位计，一个汉字算一字。 */
export const HANDOFF_MAX = 200

export function handoffLength(note: string): number {
  return Array.from(note).length
}

/** 空字符串合法。超过 200 字拒绝，避免把交接摘要悄悄截断。 */
export function assertHandoff(note: string): string {
  if (typeof note !== 'string') {
    throw new Error('交接备注必须是字符串')
  }
  const length = handoffLength(note)
  if (length > HANDOFF_MAX) {
    throw new Error(`交接备注超过 ${HANDOFF_MAX} 字（现为 ${length}）`)
  }
  return note
}

/** 自动生成的打断备注超长时截到 200 字。人工写入仍走 assertHandoff，超长直接拒绝。 */
export function clampHandoff(note: string): string {
  if (typeof note !== 'string') {
    throw new Error('交接备注必须是字符串')
  }
  const chars = Array.from(note)
  if (chars.length <= HANDOFF_MAX) return note
  return chars.slice(0, HANDOFF_MAX).join('')
}
