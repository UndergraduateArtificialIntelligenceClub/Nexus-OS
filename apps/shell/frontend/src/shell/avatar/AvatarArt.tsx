import { AsciiFace } from '@/ui'
import type { AgentStatus } from '../agent/agentStore'

export interface AvatarArtProps {
  status: AgentStatus
  reduced: boolean
}

/**
 * The avatar's picture. The face data and animation live in the UI library
 * (`ui/ascii/AsciiFace.tsx`), shared with widgets and overlays. This stays the slot
 * for the team's real art: swap this component and keep the props. It must remain
 * decorative; AgentAvatar carries the accessible name.
 */
export function AvatarArt({ status, reduced }: AvatarArtProps) {
  return <AsciiFace status={status} reduced={reduced} className="nx-avatar-art" />
}
