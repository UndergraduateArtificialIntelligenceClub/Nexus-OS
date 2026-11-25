import type { EngineTool } from '@/types/agentEvents'

// The engine's registry (apps/engine/backend/agent/tools/registry.py) as
// GET /api/v1/tools reports it with default settings: read tools run on their
// own; mutate and network tools always ask first (policy_locked).
// Keep in step with the registry; source.test.ts pins the shape.

type FixtureTool = Omit<EngineTool, 'last_used_at' | 'require_approval' | 'input_schema'> & {
  /** Minutes before "now" the gateway last ran it; null = never. */
  usedMinutesAgo: number | null
}

const tool = (t: FixtureTool) => t

export const FIXTURE_TOOLS: readonly FixtureTool[] = [
  tool({
    tool_id: 'system_diagnostics', version: '1', capability_group: 'desktop.system',
    description: 'Return structured local health observations (platform, python, database, engine).',
    risk: 'read_only', side_effect: false, native: false, availability: 'enabled',
    scope: 'read', policy: 'auto_approve', policy_locked: false, usedMinutesAgo: 4,
  }),
  tool({
    tool_id: 'file_search', version: '1', capability_group: 'desktop.files',
    description: 'Search approved roots for file-pattern matches and return metadata references.',
    risk: 'read_only', side_effect: false, native: false, availability: 'enabled',
    scope: 'read', policy: 'auto_approve', policy_locked: false, usedMinutesAgo: 125,
  }),
  tool({
    tool_id: 'memory_lookup', version: '1', capability_group: 'knowledge.memory',
    description: 'Retrieve ranked memory references for a scoped query.',
    risk: 'read_only', side_effect: false, native: false, availability: 'enabled',
    scope: 'read', policy: 'auto_approve', policy_locked: false, usedMinutesAgo: 60 * 26,
  }),
  tool({
    tool_id: 'memory_save', version: '1', capability_group: 'knowledge.memory',
    description: 'Persist a validated memory record reference created by the memory validator.',
    risk: 'reversible_write', side_effect: true, native: false, availability: 'enabled',
    scope: 'mutate', policy: 'approval_required', policy_locked: true, usedMinutesAgo: null,
  }),
  tool({
    tool_id: 'document_read', version: '1', capability_group: 'documents',
    description: 'Extract text/evidence references from a registered artifact.',
    risk: 'read_only', side_effect: false, native: false, availability: 'enabled',
    scope: 'read', policy: 'auto_approve', policy_locked: false, usedMinutesAgo: null,
  }),
  tool({
    tool_id: 'document_create', version: '1', capability_group: 'documents',
    description: 'Create an artifact under an approved destination and return its reference.',
    risk: 'reversible_write', side_effect: true, native: false, availability: 'enabled',
    scope: 'mutate', policy: 'approval_required', policy_locked: true, usedMinutesAgo: null,
  }),
  tool({
    tool_id: 'search_web', version: '1', capability_group: 'network.web',
    description: 'Search public webpages for source URLs and excerpts.',
    risk: 'read_only', side_effect: false, native: false, availability: 'enabled',
    scope: 'network', policy: 'approval_required', policy_locked: true, usedMinutesAgo: 38,
  }),
  tool({
    tool_id: 'fetch_page', version: '1', capability_group: 'network.web',
    description: 'Read bounded text from a public webpage.',
    risk: 'read_only', side_effect: false, native: false, availability: 'enabled',
    scope: 'network', policy: 'approval_required', policy_locked: true, usedMinutesAgo: 37,
  }),
  tool({
    tool_id: 'open_application', version: '1', capability_group: 'desktop.system',
    description: 'Ask the desktop core to open a resolved application target.',
    risk: 'reversible_write', side_effect: true, native: true, availability: 'enabled',
    scope: 'mutate', policy: 'approval_required', policy_locked: true, usedMinutesAgo: 12,
  }),
]
