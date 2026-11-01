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
