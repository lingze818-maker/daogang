import { HostAdapterError, type HostAdapter, type HostId } from './adapter.ts'
import { DuiyingHost } from './duiying.ts'
import { LocalCliHost } from './local-cli.ts'

export {
  HostAdapterError,
  type HostAdapter,
  type HostAuth,
  type HostContext,
  type HostId,
  type HostMessage,
  type HostSession,
  type InterruptIncoming,
  type InterruptInput,
  type InterruptResult,
  type OpenSessionInput,
  type SendMessageInput,
  type SessionKind,
  type Urgency,
} from './adapter.ts'
export { DuiyingHost, DuiyingNotWiredError } from './duiying.ts'
export { LocalCliHost } from './local-cli.ts'

/** 默认 `local-cli`。对影要显式传入，而且动作目前会拒绝执行。 */
export function createHost(options: { kind?: HostId; home?: string } = {}): HostAdapter {
  const kind = options.kind ?? 'local-cli'
  if (kind === 'duiying') return new DuiyingHost()
  if (!options.home) throw new HostAdapterError('LocalCliHost 需要一个目录')
  return new LocalCliHost(options.home)
}
