import { HostAdapterError, type HostAdapter, type HostId } from './adapter.ts'
import { DuiyingHost } from './duiying.ts'
import { LocalCliHost } from './local-cli.ts'

export {
  HostAdapterError,
  type HostAdapter,
  type DuiyingMode,
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
export { DuiyingHost, DuiyingLinkError, DuiyingNotWiredError, type DuiyingHostOptions } from './duiying.ts'
export { LocalCliHost } from './local-cli.ts'

/** 默认 `local-cli`。对影要显式传入，并且需要到岗自己的目录来放映射。 */
export function createHost(options: {
  kind?: HostId
  home?: string
  baseUrl?: string
  env?: NodeJS.ProcessEnv
} = {}): HostAdapter {
  const kind = options.kind ?? 'local-cli'
  if (kind === 'duiying') {
    if (!options.home) throw new HostAdapterError('DuiyingHost 需要一个目录')
    return new DuiyingHost({ home: options.home, baseUrl: options.baseUrl, env: options.env })
  }
  if (!options.home) throw new HostAdapterError('LocalCliHost 需要一个目录')
  return new LocalCliHost(options.home)
}
