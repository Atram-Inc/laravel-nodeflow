import { expect, it } from 'vitest'
import { canConnect } from '../editor/ids'
import { resolveOutputs } from './outputs'
import { toCanvas } from './toCanvas'
import { toGraph } from './toGraph'
import type { NodeTypePayload } from './types'

const def: NodeTypePayload = {
  kind: 'executable', type: 'condition', label: 'Condition', group: 'Logic', icon: null,
  description: null, outputs: ['otherwise'], fields: [], default_config: {}, cardinality: ['subject'],
  output_config: { field: 'branches', fallback: 'otherwise' },
}

it('uses each instance config and keeps ids across label and order changes', () => {
  const config = { branches: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }] }
  expect(resolveOutputs(def, config)).toEqual([
    { id: 'a', label: 'First' }, { id: 'b', label: 'Second' }, { id: 'otherwise', label: 'Otherwise' },
  ])
  expect(canConnect('condition', 'a', { condition: def }, config)).toBe(true)
  expect(canConnect('condition', 'a', { condition: def }, { branches: [] })).toBe(false)
  const graph = {
    start: 'n', nodes: [{ id: 'n', type: 'condition', config }],
    edges: [{ from: 'n', to: 'n', output: 'a' }],
  }
  const before = toCanvas(graph, { condition: def })
  graph.nodes[0]!.config.branches = [{ id: 'b', label: 'Second' }, { id: 'a', label: 'Renamed' }]
  const after = toCanvas(graph, { condition: def })
  expect(after.edges[0]!.id).toBe(before.edges[0]!.id)
  expect(after.edges[0]!.label).toBe('Renamed')
  graph.nodes[0]!.config.branches = []
  const removed = toGraph(toCanvas(graph, { condition: def }), 'n', { condition: def })
  expect(removed.graph.edges![0]!.output).toBe('a')
  expect(removed.unresolved).toHaveLength(1)
})

it('safely skips malformed and duplicate handles', () => {
  expect(resolveOutputs(def, { branches: [
    null, { id: 'otherwise', label: 'Oops' }, { id: 'bad id', label: 'Bad' },
    { id: 'a', label: 'A' }, { id: 'a', label: 'B' },
  ] })).toEqual([{ id: 'a', label: 'A' }, { id: 'otherwise', label: 'Otherwise' }])
})

it('does not accept identifiers with trailing newlines', () => {
  expect(resolveOutputs(def, { branches: [{ id: 'a\n', label: 'Invalid' }] }))
    .toEqual([{ id: 'otherwise', label: 'Otherwise' }])
})
