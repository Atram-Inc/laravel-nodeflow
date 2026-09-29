import type { GraphComponentPayload, GraphConfig } from './types'

/** Stable identifiers route edges; labels and list order are presentation only. */
export function resolveOutputs(def: GraphComponentPayload | undefined, config?: GraphConfig | null): { id: string; label: string }[] {
  const descriptor = def?.kind === 'executable' ? def.output_config : undefined
  if (descriptor === undefined) return (def?.outputs ?? []).map((id) => ({ id, label: id }))
  const branches = config && !Array.isArray(config) ? config[descriptor.field] : undefined
  const seen = new Set([descriptor.fallback])
  const outputs: { id: string; label: string }[] = []
  for (const branch of Array.isArray(branches) ? branches : []) {
    if (branch === null || typeof branch !== 'object' || typeof branch.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(branch.id) || seen.has(branch.id)) continue
    seen.add(branch.id)
    outputs.push({ id: branch.id, label: typeof branch.label === 'string' ? branch.label : branch.id })
  }
  return [...outputs, { id: descriptor.fallback, label: descriptor.fallback_label ?? 'Otherwise' }]
}
