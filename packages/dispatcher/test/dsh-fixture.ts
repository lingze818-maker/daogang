import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = `let constructed = 0
export function timesConstructed() {
  return constructed
}
export class DshExecutor {
  constructor(host) {
    if (!host?.effects?.enqueue || !host?.effects?.handle) throw new Error('effects 未接上')
    constructed += 1
    this.host = host
    host.effects.handle('launch', async () => {})
    host.effects.handle('delivery', async () => {})
  }
  start(ticket, assignment) {
    this.host.effects.enqueue('launch', assignment.id, {
      ticketId: ticket.id,
      assignmentId: assignment.id,
    })
  }
  deliver(ticket, _assignment) {
    this.host.effects.enqueue('delivery', ticket.id, { ticketId: ticket.id })
  }
}
`

/** 最小克隆：只有 package 名和可加载的 DshExecutor，不是上游整仓。 */
export function writeDshFixture(root: string): string {
  mkdirSync(join(root, 'src', 'executor'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'dsh-superagent', private: true })}\n`)
  writeFileSync(join(root, 'src', 'executor', 'dsh.js'), SOURCE)
  return root
}
