import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HostAdapterError, type DuiyingMode } from './adapter.ts'

export interface DuiyingBinding {
  ticketId: string
  sessionId: string
  mode: DuiyingMode
  summary: string
  handoffNote: string
  deliveryKey: string
  channel?: string
  peerId?: string
  lastLine?: { role: 'user'; text: string }
}

export interface DuiyingMapFile {
  sessions: Record<string, DuiyingBinding>
}

export function duiyingMapPath(home: string): string {
  return join(home, 'duiying-map.json')
}

export function readDuiyingMap(home: string): DuiyingMapFile {
  const file = duiyingMapPath(home)
  if (!existsSync(file)) return { sessions: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DuiyingMapFile>
    return { sessions: parsed.sessions ?? {} }
  } catch {
    throw new HostAdapterError('对影映射读不了')
  }
}

export function writeDuiyingMap(home: string, map: DuiyingMapFile): void {
  const file = duiyingMapPath(home)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(map)}\n`, 'utf8')
  renameSync(tmp, file)
}

/** 只用 deliveryKey 反查。不把键本身当成 worker 会话名。 */
export function findByDeliveryKey(map: DuiyingMapFile, deliveryKey: string): DuiyingBinding | undefined {
  return Object.values(map.sessions).find((item) => item.deliveryKey === deliveryKey)
}
