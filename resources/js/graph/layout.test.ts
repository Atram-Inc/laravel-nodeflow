import { describe, expect, it } from 'vitest'

import { LAYER_GAP, NODE_MIN_HEIGHT, NODE_WIDTH, ROW_GAP, estimatedNodeHeight } from '../canvas/layout'
import { hierarchicalLayout, layoutForGraph, layoutGraph, positionsForGraph, type LayoutEdge, type LayoutNode, type Point } from './layout'
import type { Graph, GraphComponentPayload, GraphNode } from './types'

function overlaps(a: Point, aHeight: number, b: Point, bHeight: number): boolean {
  return a.x < b.x + NODE_WIDTH
    && a.x + NODE_WIDTH > b.x
    && a.y < b.y + bHeight
    && a.y + aHeight > b.y
}

function assertNoOverlap(nodes: LayoutNode[], positions: Record<string, Point>, gap = 0): void {
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left]!
      const b = nodes[right]!
      const aHeight = (a.height ?? NODE_MIN_HEIGHT) + gap
      const bHeight = (b.height ?? NODE_MIN_HEIGHT) + gap
      expect(overlaps(positions[a.id]!, aHeight, positions[b.id]!, bHeight), `${a.id} overlaps ${b.id}`).toBe(false)
    }
  }
}

/** A deterministic pseudo random generator, so the "random" graphs are the same on every run. */
function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function randomDag(seed: number, size: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const random = generator(seed)
  const nodes = Array.from({ length: size }, (_, index): LayoutNode => ({ id: `n${index}`, height: 90 + Math.floor(random() * 120) }))
  const edges: LayoutEdge[] = []
  for (let index = 1; index < size; index += 1) {
    const parents = 1 + Math.floor(random() * 2)
    for (let count = 0; count < parents; count += 1) {
      const from = Math.floor(random() * index)
      if (!edges.some((edge) => edge.from === `n${from}` && edge.to === `n${index}`)) {
        edges.push({ from: `n${from}`, to: `n${index}`, order: Math.floor(random() * 3) })
      }
    }
  }
  return { nodes, edges }
}

describe('layoutGraph', () => {
  it('places a simple sequence strictly left to right on one row', () => {
    const { positions } = layoutGraph(
      [{ id: 'start' }, { id: 'prepare' }, { id: 'finish' }],
      [{ from: 'start', to: 'prepare' }, { from: 'prepare', to: 'finish' }],
      'start',
    )

    expect(positions.start!.x).toBeLessThan(positions.prepare!.x)
    expect(positions.prepare!.x).toBeLessThan(positions.finish!.x)
    expect(positions.prepare!.x - positions.start!.x).toBe(NODE_WIDTH + LAYER_GAP)
    expect(new Set([positions.start!.y, positions.prepare!.y, positions.finish!.y]).size).toBe(1)
  })

  it('increases the column along every edge, for many generated graphs', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { nodes, edges } = randomDag(seed, 18)
      const { positions } = layoutGraph(nodes, edges, 'n0')
      for (const edge of edges) {
        expect(positions[edge.to]!.x, `seed ${seed}: ${edge.from} -> ${edge.to}`).toBeGreaterThan(positions[edge.from]!.x)
      }
    }
  })

  it('never overlaps two nodes, whatever their heights, for many generated graphs', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { nodes, edges } = randomDag(seed, 18)
      const { positions } = layoutGraph(nodes, edges, 'n0')
      // The gap between two nodes in one column is at least ROW_GAP.
      assertNoOverlap(nodes, positions, ROW_GAP - 1)
    }
  })

  it('returns the same result for the same graph, and ignores input order of equal runs', () => {
    const { nodes, edges } = randomDag(7, 24)
    const first = layoutGraph(nodes, edges, 'n0')
    const second = layoutGraph(nodes.map((node) => ({ ...node })), edges.map((edge) => ({ ...edge })), 'n0')

    expect(second).toEqual(first)
  })

  it('fans the branches of a condition out vertically in output order, around the condition', () => {
    const { positions } = layoutGraph(
      [{ id: 'trigger' }, { id: 'check', height: 145 }, { id: 'no' }, { id: 'yes' }],
      [
        { from: 'trigger', to: 'check', order: 0 },
        // Listed false first: the output order, not the list order, decides.
        { from: 'check', to: 'no', order: 1 },
        { from: 'check', to: 'yes', order: 0 },
      ],
      'trigger',
    )

    expect(positions.yes!.x).toBe(positions.no!.x)
    expect(positions.yes!.y).toBeLessThan(positions.no!.y)
    const checkCenter = positions.check!.y + 145 / 2
    const yesCenter = positions.yes!.y + NODE_MIN_HEIGHT / 2
    const noCenter = positions.no!.y + NODE_MIN_HEIGHT / 2
    expect(Math.abs((yesCenter + noCenter) / 2 - checkCenter)).toBeLessThanOrEqual(1)
  })

  it('keeps a free lane for an edge that jumps a column, clear of the nodes in it', () => {
    const nodes: LayoutNode[] = [{ id: 'trigger' }, { id: 'check', height: 145 }, { id: 'message' }, { id: 'exit' }]
    const edges: LayoutEdge[] = [
      { from: 'trigger', to: 'check' },
      { from: 'check', to: 'message', order: 0 },
      { from: 'message', to: 'exit' },
      { from: 'check', to: 'exit', order: 1 },
    ]
    const { positions, lanes } = layoutGraph(nodes, edges, 'trigger')

    expect(lanes[0]).toBeUndefined()
    expect(lanes[3]).toHaveLength(1)
    const lane = lanes[3]![0]!
    expect(lane.x).toBe(positions.message!.x)
    const messageTop = positions.message!.y
    const messageBottom = messageTop + NODE_MIN_HEIGHT
    expect(lane.y < messageTop || lane.y > messageBottom).toBe(true)
    expect(positions.exit!.x).toBeGreaterThan(positions.message!.x)
  })

  it('is deterministic and finite for cycles', () => {
    const nodes = ['start', 'cycle-a', 'cycle-b', 'finish'].map((id) => ({ id }))
    const edges = [
      { from: 'start', to: 'cycle-a' },
      { from: 'cycle-a', to: 'cycle-b' },
      { from: 'cycle-b', to: 'cycle-a' },
      { from: 'cycle-b', to: 'finish' },
    ]

    const first = layoutGraph(nodes, edges, 'start')
    const second = layoutGraph(nodes, edges, 'start')

    expect(second).toEqual(first)
    expect(Object.values(first.positions).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    expect(first.positions['cycle-a']!.x).toBe(first.positions['cycle-b']!.x)
    expect(first.positions['cycle-a']!.y).not.toBe(first.positions['cycle-b']!.y)
    assertNoOverlap(nodes, first.positions)
  })

  it('places disconnected components below the start component without overlap', () => {
    const nodes = ['start', 'primary', 'other-root', 'other-leaf'].map((id) => ({ id }))
    const { positions } = layoutGraph(
      nodes,
      [
        { from: 'start', to: 'primary' },
        { from: 'other-root', to: 'other-leaf' },
      ],
      'start',
    )

    const primaryBottom = Math.max(positions.start!.y, positions.primary!.y) + NODE_MIN_HEIGHT
    const disconnectedTop = Math.min(positions['other-root']!.y, positions['other-leaf']!.y)

    expect(disconnectedTop).toBeGreaterThan(primaryBottom)
    expect(positions['other-root']!.x).toBe(positions.start!.x)
    assertNoOverlap(nodes, positions)
  })

  it('puts a node added without connections below the flow', () => {
    const nodes = [{ id: 'trigger' }, { id: 'message' }, { id: 'new' }]
    const { positions } = layoutGraph(nodes, [{ from: 'trigger', to: 'message' }], 'trigger')

    expect(positions.new!.y).toBeGreaterThan(positions.trigger!.y + NODE_MIN_HEIGHT)
    assertNoOverlap(nodes, positions)
  })

  it('owns prototype-like IDs without prototype pollution', () => {
    const positions = hierarchicalLayout(
      ['constructor', 'toString', '__proto__'],
      [{ from: 'constructor', to: 'toString' }, { from: 'toString', to: '__proto__' }],
      'constructor',
    )

    expect(Object.getPrototypeOf(positions)).toBeNull()
    expect(Object.hasOwn(positions, 'constructor')).toBe(true)
    expect(Object.hasOwn(positions, 'toString')).toBe(true)
    expect(Object.hasOwn(positions, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('lays out a 5,000-node chain without exhausting the call stack', () => {
    const nodeIds = Array.from({ length: 5_000 }, (_, index) => `node-${index}`)
    const edges = nodeIds.slice(1).map((to, index) => ({ from: nodeIds[index]!, to }))

    const positions = hierarchicalLayout(nodeIds, edges, nodeIds[0]!)

    expect(Object.keys(positions)).toHaveLength(nodeIds.length)
    expect(positions['node-0']!.x).toBeLessThan(positions['node-4999']!.x)
    expect(Object.values(positions).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
  })

  it('keeps a deep cycle in one finite, deterministic column', () => {
    const nodeIds = Array.from({ length: 5_000 }, (_, index) => `cycle-${index}`)
    const edges = nodeIds.map((from, index) => ({ from, to: nodeIds[(index + 1) % nodeIds.length]! }))

    const first = hierarchicalLayout(nodeIds, edges, nodeIds[0]!)
    const second = hierarchicalLayout(nodeIds, edges, nodeIds[0]!)

    expect(second).toEqual(first)
    expect(first['cycle-0']!.x).toBe(first['cycle-4999']!.x)
    expect(Object.values(first).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
  })
})

describe('layoutForGraph', () => {
  const definitions = {
    trigger: { kind: 'trigger', type: 'trigger', label: 'Trigger', outputs: ['started'] },
    condition: { kind: 'executable', type: 'condition', label: 'Condition', outputs: ['true', 'false'] },
    message: { kind: 'executable', type: 'message', label: 'Message', outputs: ['next'] },
    exit: { kind: 'executable', type: 'exit', label: 'Exit', outputs: [] },
  } as unknown as Record<string, GraphComponentPayload>

  it('ignores stored coordinates: every graph opens tidy and the same way', () => {
    const graph: Graph = {
      start: 'start',
      nodes: [
        { id: 'start', type: 'trigger', position: { x: 900, y: -0.5 } },
        { id: 'finish', type: 'exit', position: { x: 12, y: 901.25 } },
      ],
      edges: [{ from: 'start', to: 'finish', output: 'started' }],
    }
    const moved: Graph = { ...graph, nodes: graph.nodes!.map((node) => ({ ...node, position: { x: 1, y: 2 } })) }

    expect(positionsForGraph(graph, definitions)).toEqual(positionsForGraph(moved, definitions))
    expect(positionsForGraph(graph, definitions).start!.x).toBeLessThan(positionsForGraph(graph, definitions).finish!.x)
  })

  it('reserves the estimated height of each node, taller with more outputs', () => {
    const graph: Graph = {
      start: 'start',
      nodes: [
        { id: 'start', type: 'trigger' },
        { id: 'check', type: 'condition' },
        { id: 'a', type: 'message' },
        { id: 'b', type: 'message' },
      ],
      edges: [
        { from: 'start', to: 'check', output: 'started' },
        { from: 'check', to: 'a', output: 'true' },
        { from: 'check', to: 'b', output: 'false' },
      ],
    }
    const positions = positionsForGraph(graph, definitions)

    expect(estimatedNodeHeight(2)).toBeGreaterThan(estimatedNodeHeight(1))
    expect(positions.a!.y).toBeLessThan(positions.b!.y)
    expect(positions.b!.y - positions.a!.y).toBeGreaterThanOrEqual(estimatedNodeHeight(1) + ROW_GAP)
  })

  it('uses a measured height when it is taller than the estimate', () => {
    const graph: Graph = {
      start: 'start',
      nodes: ['start', 'a', 'b'].map((id): GraphNode => ({ id, type: id === 'start' ? 'condition' : 'message' })),
      edges: [{ from: 'start', to: 'a', output: 'true' }, { from: 'start', to: 'b', output: 'false' }],
    }
    const positions = layoutForGraph(graph, definitions, (id) => (id === 'a' ? 400 : undefined)).positions

    expect(positions.b!.y - positions.a!.y).toBeGreaterThanOrEqual(400 + ROW_GAP)
  })

  it('layers an unpositioned flood graph from left to right with readable branches', () => {
    const graph: Graph = {
      start: 'start',
      nodes: ['start', 'alpha', 'beta', 'gamma', 'finish'].map((id): GraphNode => ({ id, type: 'node' })),
      edges: [
        { from: 'start', to: 'alpha' },
        { from: 'start', to: 'beta' },
        { from: 'start', to: 'gamma' },
        { from: 'alpha', to: 'finish' },
        { from: 'beta', to: 'finish' },
        { from: 'gamma', to: 'finish' },
      ],
    }

    const positions = positionsForGraph(graph)

    expect(positions.start!.x).toBeLessThan(positions.alpha!.x)
    expect(positions.alpha!.x).toBe(positions.beta!.x)
    expect(positions.beta!.x).toBe(positions.gamma!.x)
    expect(positions.gamma!.x).toBeLessThan(positions.finish!.x)
    expect(new Set([positions.alpha!.y, positions.beta!.y, positions.gamma!.y]).size).toBe(3)
    // The merge node sits level with the middle branch.
    expect(positions.finish!.y).toBe(positions.beta!.y)
  })
})
