import {
  CANVAS_ORIGIN,
  COMPONENT_GAP,
  LAYER_GAP,
  NODE_MIN_HEIGHT,
  NODE_WIDTH,
  ROW_GAP,
  estimatedNodeHeight,
} from '../canvas/layout'
import type { Graph, GraphComponentPayload } from './types'

export type Point = { x: number; y: number }

/** A node to place. Height defaults to NODE_MIN_HEIGHT; every node is NODE_WIDTH wide. */
export type LayoutNode = { id: string; height?: number }

/**
 * A connection. `order` is the index of the source output the edge leaves from,
 * so the branches of a condition keep their declared order top to bottom.
 */
export type LayoutEdge = { from: string; to: string; order?: number }

/**
 * Where an edge that spans several columns crosses one of them: `x` is that
 * column's left edge and `y` the centre of the horizontal lane the layout kept
 * free for it. Edges between neighbouring columns have no lanes.
 */
export type EdgeLane = { x: number; y: number }

export type LayoutResult = {
  positions: Record<string, Point>
  /** Indexed like the input edges. */
  lanes: Array<EdgeLane[] | undefined>
}

/** The vertical band a lane reserves in a column it crosses. */
const LANE_HEIGHT = 8
const SWEEPS = 6

function uniqueNodeIds(nodeIds: string[]): string[] {
  const ids: string[] = []
  const known = new Set<string>()

  for (const id of nodeIds) {
    if (!known.has(id)) {
      known.add(id)
      ids.push(id)
    }
  }

  return ids
}

function adjacency(nodeIds: string[], edges: LayoutEdge[]): Map<string, string[]> {
  const known = new Set(nodeIds)
  const graph = new Map(nodeIds.map((id) => [id, [] as string[]]))

  for (const { from, to } of edges) {
    if (!known.has(from) || !known.has(to)) {
      continue
    }

    const neighbors = graph.get(from)!
    if (!neighbors.includes(to)) {
      neighbors.push(to)
    }
  }

  return graph
}

/** Tarjan's traversal follows the persisted node and edge order. */
function stronglyConnectedComponents(nodeIds: string[], graph: Map<string, string[]>): string[][] {
  const indexByNode = new Map<string, number>()
  const lowlinkByNode = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []
  let index = 0

  const discover = (node: string): void => {
    indexByNode.set(node, index)
    lowlinkByNode.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)
  }

  type Frame = { node: string; nextNeighbor: number; parent?: string }
  for (const root of nodeIds) {
    if (indexByNode.has(root)) {
      continue
    }
    discover(root)
    const frames: Frame[] = [{ node: root, nextNeighbor: 0 }]

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!
      const neighbors = graph.get(frame.node) ?? []
      if (frame.nextNeighbor < neighbors.length) {
        const neighbor = neighbors[frame.nextNeighbor++]!
        if (!indexByNode.has(neighbor)) {
          discover(neighbor)
          frames.push({ node: neighbor, nextNeighbor: 0, parent: frame.node })
        } else if (onStack.has(neighbor)) {
          lowlinkByNode.set(frame.node, Math.min(lowlinkByNode.get(frame.node)!, indexByNode.get(neighbor)!))
        }
        continue
      }

      frames.pop()
      if (frame.parent !== undefined) {
        lowlinkByNode.set(
          frame.parent,
          Math.min(lowlinkByNode.get(frame.parent)!, lowlinkByNode.get(frame.node)!),
        )
      }
      if (lowlinkByNode.get(frame.node) === indexByNode.get(frame.node)) {
        const component: string[] = []
        let member: string | undefined
        do {
          member = stack.pop()
          if (member !== undefined) {
            onStack.delete(member)
            component.push(member)
          }
        } while (member !== frame.node)
        components.push(component)
      }
    }
  }

  return components
}

/**
 * One box in a column: a strongly connected component (normally a single node;
 * a cycle's members stack inside one box) or a lane reserved for a long edge.
 */
type Item = {
  key: number
  layer: number
  height: number
  /** Component id, or -1 for a lane. */
  component: number
  /** Lowest input index of its members, the tie-breaker that keeps results stable. */
  rank: number
  incoming: Link[]
  outgoing: Link[]
}

/** A one-column hop between items, with the source output order it started from. */
type Link = { from: Item; to: Item; order: number }

type ComponentGraph = {
  components: string[][]
  componentByNode: Map<string, number>
  /** Distinct component-level edges with the lowest output order among the node edges they stand for. */
  outgoing: Map<number, Map<number, number>>
  incoming: Map<number, Set<number>>
}

function componentGraph(nodeIds: string[], edges: LayoutEdge[]): ComponentGraph {
  const inputOrder = new Map(nodeIds.map((id, index) => [id, index]))
  const components = stronglyConnectedComponents(nodeIds, adjacency(nodeIds, edges))
    .map((component) => component.sort((left, right) => inputOrder.get(left)! - inputOrder.get(right)!))
    .sort((left, right) => inputOrder.get(left[0]!)! - inputOrder.get(right[0]!)!)
  const componentByNode = new Map<string, number>()
  const outgoing = new Map<number, Map<number, number>>()
  const incoming = new Map<number, Set<number>>()

  components.forEach((component, componentId) => {
    outgoing.set(componentId, new Map())
    incoming.set(componentId, new Set())
    component.forEach((node) => componentByNode.set(node, componentId))
  })

  for (const edge of edges) {
    const from = componentByNode.get(edge.from)
    const to = componentByNode.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      continue
    }
    const order = Number.isFinite(edge.order) ? edge.order! : 0
    const targets = outgoing.get(from)!
    targets.set(to, Math.min(targets.get(to) ?? order, order))
    incoming.get(to)!.add(from)
  }

  return { components, componentByNode, outgoing, incoming }
}

function reachable(graph: ComponentGraph, start: number): Set<number> {
  const seen = new Set<number>([start])
  const queue = [start]
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of graph.outgoing.get(queue[index]!)!.keys()) {
      if (!seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
  }
  return seen
}

/** Weakly connected groups, each listed in component id (input) order. */
function groupsOf(graph: ComponentGraph, members: Set<number>): number[][] {
  const remaining = new Set([...members].sort((left, right) => left - right))
  const groups: number[][] = []
  while (remaining.size > 0) {
    const root = remaining.values().next().value as number
    remaining.delete(root)
    const group = [root]
    for (let index = 0; index < group.length; index += 1) {
      const component = group[index]!
      for (const neighbor of [...graph.outgoing.get(component)!.keys(), ...graph.incoming.get(component)!]) {
        if (remaining.delete(neighbor)) {
          group.push(neighbor)
        }
      }
    }
    groups.push(group.sort((left, right) => left - right))
  }
  return groups
}

/** Longest distance from a source, on the acyclic component graph. */
function layersOf(graph: ComponentGraph, members: number[], start?: number): Map<number, number> {
  const included = new Set(members)
  const indegree = new Map<number, number>()
  const layers = new Map<number, number>()
  const ready: number[] = []

  for (const component of members) {
    const count = [...graph.incoming.get(component)!].filter((source) => included.has(source) && component !== start).length
    indegree.set(component, count)
    if (count === 0) {
      ready.push(component)
      layers.set(component, 0)
    }
  }

  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const component = ready[cursor]!
    const layer = layers.get(component) ?? 0
    for (const target of graph.outgoing.get(component)!.keys()) {
      if (!included.has(target) || target === start) {
        continue
      }
      layers.set(target, Math.max(layers.get(target) ?? 0, layer + 1))
      const remaining = indegree.get(target)! - 1
      indegree.set(target, remaining)
      if (remaining === 0) {
        ready.push(target)
      }
    }
  }

  for (const component of members) {
    if (!layers.has(component)) {
      layers.set(component, 0)
    }
  }

  return layers
}

function blockHeight(members: string[], heights: Map<string, number>): number {
  return members.reduce((total, node) => total + heights.get(node)!, 0) + ROW_GAP * (members.length - 1)
}

type GroupLayout = {
  columns: Item[][]
  /** Centre y of each item, keyed by item key. */
  centers: Map<number, number>
  /** Lane items per original component edge "from:to". */
  lanes: Map<string, Item[]>
}

function buildColumns(
  graph: ComponentGraph,
  members: number[],
  layers: Map<number, number>,
  heights: Map<string, number>,
): { columns: Item[][]; lanes: Map<string, Item[]> } {
  let nextKey = 0
  const columns: Item[][] = []
  const itemByComponent = new Map<number, Item>()
  const lanes = new Map<string, Item[]>()
  const place = (item: Item): Item => {
    ;(columns[item.layer] ??= []).push(item)
    return item
  }

  for (const component of members) {
    const nodes = graph.components[component]!
    itemByComponent.set(component, place({
      key: nextKey++,
      layer: layers.get(component)!,
      height: blockHeight(nodes, heights),
      component,
      rank: component,
      incoming: [],
      outgoing: [],
    }))
  }

  const link = (from: Item, to: Item, order: number): void => {
    const hop = { from, to, order }
    from.outgoing.push(hop)
    to.incoming.push(hop)
  }

  for (const component of members) {
    const source = itemByComponent.get(component)!
    const targets = [...graph.outgoing.get(component)!.entries()].sort((left, right) => left[1] - right[1] || left[0] - right[0])
    for (const [targetComponent, order] of targets) {
      const target = itemByComponent.get(targetComponent)
      if (target === undefined || target.layer <= source.layer) {
        continue
      }
      let previous = source
      const chain: Item[] = []
      for (let layer = source.layer + 1; layer < target.layer; layer += 1) {
        const lane = place({
          key: nextKey++,
          layer,
          height: LANE_HEIGHT,
          component: -1,
          rank: source.rank + (order + 1) / 1000,
          incoming: [],
          outgoing: [],
        })
        link(previous, lane, previous === source ? order : 0)
        chain.push(lane)
        previous = lane
      }
      link(previous, target, previous === source ? order : 0)
      if (chain.length > 0) {
        lanes.set(`${component}:${targetComponent}`, chain)
      }
    }
  }

  for (let layer = 0; layer < columns.length; layer += 1) {
    columns[layer] ??= []
  }

  return { columns, lanes }
}

/** Initial order: depth first from the column-0 items, following outputs in order. */
function initialOrder(columns: Item[][]): void {
  const seen = new Set<number>()
  const sequence = new Map<number, number>()
  let counter = 0
  const visit = (root: Item): void => {
    const stack = [root]
    while (stack.length > 0) {
      const item = stack.pop()!
      if (seen.has(item.key)) continue
      seen.add(item.key)
      sequence.set(item.key, counter++)
      const next = [...item.outgoing].sort((left, right) => left.order - right.order || left.to.rank - right.to.rank)
      for (let index = next.length - 1; index >= 0; index -= 1) {
        stack.push(next[index]!.to)
      }
    }
  }
  for (const column of columns) {
    for (const item of [...column].sort((left, right) => left.rank - right.rank)) {
      visit(item)
    }
  }
  for (const column of columns) {
    column.sort((left, right) => sequence.get(left.key)! - sequence.get(right.key)!)
  }
}

function crossings(columns: Item[][]): number {
  let total = 0
  for (let layer = 0; layer + 1 < columns.length; layer += 1) {
    const upper = new Map(columns[layer]!.map((item, index) => [item.key, index]))
    const lower = new Map(columns[layer + 1]!.map((item, index) => [item.key, index]))
    const hops: Array<[number, number]> = []
    for (const item of columns[layer]!) {
      for (const hop of item.outgoing) {
        const target = lower.get(hop.to.key)
        if (target !== undefined) hops.push([upper.get(item.key)! + hop.order / 1000, target])
      }
    }
    if (hops.length > 400) continue
    for (let left = 0; left < hops.length; left += 1) {
      for (let right = left + 1; right < hops.length; right += 1) {
        const [a1, a2] = hops[left]!
        const [b1, b2] = hops[right]!
        if ((a1 - b1) * (a2 - b2) < 0) total += 1
      }
    }
  }
  return total
}

/**
 * Barycentric sweeps, both directions. A hop's position on the upper column
 * includes its output order as a fraction, so siblings keep the order of the
 * outputs they hang from (the "true" branch above the "false" one).
 */
function orderColumns(columns: Item[][]): void {
  initialOrder(columns)
  let best = columns.map((column) => [...column])
  let bestCrossings = crossings(columns)
  const sortColumn = (column: Item[], value: (item: Item) => number | undefined): void => {
    const current = new Map(column.map((item, index) => [item.key, index]))
    const values = new Map(column.map((item) => [item.key, value(item)]))
    column.sort((left, right) => {
      const leftValue = values.get(left.key)
      const rightValue = values.get(right.key)
      if (leftValue !== undefined && rightValue !== undefined && leftValue !== rightValue) return leftValue - rightValue
      return current.get(left.key)! - current.get(right.key)!
    })
  }
  const index = (column: Item[]): Map<number, number> => new Map(column.map((item, position) => [item.key, position]))

  for (let sweep = 0; sweep < SWEEPS && bestCrossings > 0; sweep += 1) {
    for (let layer = 1; layer < columns.length; layer += 1) {
      const upper = index(columns[layer - 1]!)
      sortColumn(columns[layer]!, (item) => {
        const related = item.incoming.filter((hop) => upper.has(hop.from.key))
        if (related.length === 0) return undefined
        return related.reduce((total, hop) => {
          const siblings = hop.from.outgoing.length
          const slot = [...hop.from.outgoing].sort((left, right) => left.order - right.order).indexOf(hop)
          return total + upper.get(hop.from.key)! + (slot + 0.5) / Math.max(1, siblings)
        }, 0) / related.length
      })
    }
    for (let layer = columns.length - 2; layer >= 0; layer -= 1) {
      const lower = index(columns[layer + 1]!)
      sortColumn(columns[layer]!, (item) => {
        const related = item.outgoing.filter((hop) => lower.has(hop.to.key))
        if (related.length === 0) return undefined
        return related.reduce((total, hop) => total + lower.get(hop.to.key)!, 0) / related.length
      })
    }
    const count = crossings(columns)
    if (count < bestCrossings) {
      bestCrossings = count
      best = columns.map((column) => [...column])
    }
  }

  best.forEach((column, layer) => {
    columns[layer] = column
  })
}

/**
 * Centres for one column that stay as close as possible to where each item
 * wants to be (its parents' centre) while keeping the order and a gap between
 * neighbours: isotonic regression by pooling adjacent violators.
 */
function placeColumn(column: Item[], desired: number[]): number[] {
  // Shift every centre by the space the items above it need, which turns the
  // spacing constraint into a plain ordering constraint.
  const offsets: number[] = []
  let offset = 0
  column.forEach((item, position) => {
    if (position > 0) offset += column[position - 1]!.height / 2 + ROW_GAP + item.height / 2
    offsets.push(offset)
  })
  type Block = { start: number; end: number; sum: number; count: number }
  const blocks: Block[] = []
  desired.forEach((value, position) => {
    blocks.push({ start: position, end: position, sum: value - offsets[position]!, count: 1 })
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!
      const previous = blocks[blocks.length - 2]!
      if (previous.sum / previous.count <= last.sum / last.count) break
      blocks.splice(blocks.length - 2, 2, {
        start: previous.start,
        end: last.end,
        sum: previous.sum + last.sum,
        count: previous.count + last.count,
      })
    }
  })
  const centers: number[] = []
  for (const block of blocks) {
    const mean = block.sum / block.count
    for (let position = block.start; position <= block.end; position += 1) {
      centers[position] = mean + offsets[position]!
    }
  }
  return centers
}

function layoutGroup(
  graph: ComponentGraph,
  members: number[],
  heights: Map<string, number>,
  start?: number,
): GroupLayout {
  const layers = layersOf(graph, members, start)
  const { columns, lanes } = buildColumns(graph, members, layers, heights)
  orderColumns(columns)
  const centers = new Map<number, number>()

  columns.forEach((column, layer) => {
    const desired = column.map((item, position) => {
      const parents = item.incoming.filter((hop) => centers.has(hop.from.key))
      if (layer === 0 || parents.length === 0) {
        // Roots stack from the top in their order.
        return column.slice(0, position).reduce((total, above) => total + above.height + ROW_GAP, 0) + item.height / 2
      }
      return parents.reduce((total, hop) => total + centers.get(hop.from.key)!, 0) / parents.length
    })
    placeColumn(column, desired).forEach((center, position) => centers.set(column[position]!.key, center))
  })

  return { columns, centers, lanes }
}

/**
 * The editor's automatic layout. Columns run strictly left to right (a node
 * sits one column after its furthest predecessor), branches fan out vertically
 * around the node they leave in output order, and an edge that jumps columns
 * gets a free lane in every column it crosses. Groups not reachable from the
 * start stack below. The result depends only on the input: no randomness, and
 * ties resolve by input order.
 */
export function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[], startId: string): LayoutResult {
  const ids = uniqueNodeIds(nodes.map((node) => node.id))
  const positions: Record<string, Point> = Object.create(null)
  const result: LayoutResult = { positions, lanes: edges.map(() => undefined) }
  if (ids.length === 0) {
    return result
  }

  const heights = new Map<string, number>()
  for (const node of nodes) {
    if (!heights.has(node.id)) {
      const height = node.height
      heights.set(node.id, typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : NODE_MIN_HEIGHT)
    }
  }

  const graph = componentGraph(ids, edges)
  const start = graph.componentByNode.get(startId) ?? graph.componentByNode.get(ids[0]!)!
  const primary = reachable(graph, start)
  const rest = new Set<number>()
  graph.components.forEach((_, component) => {
    if (!primary.has(component)) rest.add(component)
  })
  const groups: Array<{ members: number[]; start?: number }> = [
    { members: [...primary].sort((left, right) => left - right), start },
    ...groupsOf(graph, rest).map((members) => ({ members })),
  ]

  let top = CANVAS_ORIGIN.y
  const laneByEdge = new Map<string, EdgeLane[]>()
  for (const group of groups) {
    const layout = layoutGroup(graph, group.members, heights, group.start)
    let minTop = Infinity
    let maxBottom = -Infinity
    for (const column of layout.columns) {
      for (const item of column) {
        const center = layout.centers.get(item.key)!
        minTop = Math.min(minTop, center - item.height / 2)
        maxBottom = Math.max(maxBottom, center + item.height / 2)
      }
    }
    const shift = top - minTop
    layout.columns.forEach((column, layer) => {
      const x = CANVAS_ORIGIN.x + layer * (NODE_WIDTH + LAYER_GAP)
      for (const item of column) {
        if (item.component < 0) continue
        let y = layout.centers.get(item.key)! - item.height / 2 + shift
        for (const node of graph.components[item.component]!) {
          positions[node] = { x, y: Math.round(y) }
          y += heights.get(node)! + ROW_GAP
        }
      }
    })
    for (const [key, chain] of layout.lanes) {
      laneByEdge.set(key, chain.map((lane) => ({
        x: CANVAS_ORIGIN.x + lane.layer * (NODE_WIDTH + LAYER_GAP),
        y: Math.round(layout.centers.get(lane.key)! + shift),
      })))
    }
    top = maxBottom + shift + COMPONENT_GAP
  }

  edges.forEach((edge, index) => {
    const from = graph.componentByNode.get(edge.from)
    const to = graph.componentByNode.get(edge.to)
    if (from === undefined || to === undefined) return
    const chain = laneByEdge.get(`${from}:${to}`)
    if (chain !== undefined) result.lanes[index] = chain.map((lane) => ({ ...lane }))
  })

  return result
}

/** Positions only, every node at the default height. */
export function hierarchicalLayout(
  nodeIds: string[],
  edges: Array<{ from: string; to: string; order?: number }>,
  startId: string,
): Record<string, Point> {
  return layoutGraph(nodeIds.map((id) => ({ id })), edges, startId).positions
}

function outputCount(type: string, definitions: Record<string, GraphComponentPayload>): number {
  return Object.prototype.hasOwnProperty.call(definitions, type) ? definitions[type]!.outputs?.length ?? 0 : 0
}

function outputOrder(type: string | undefined, output: string | null | undefined, definitions: Record<string, GraphComponentPayload>): number {
  if (type === undefined || output === null || output === undefined || !Object.prototype.hasOwnProperty.call(definitions, type)) return 0
  const index = (definitions[type]!.outputs as readonly string[] | undefined)?.indexOf(output) ?? -1
  return index < 0 ? 0 : index
}

/**
 * The laid-out canvas geometry of a stored graph. Stored coordinates are not
 * read: every graph opens tidy, and the same graph always opens the same way.
 */
export function layoutForGraph(
  graph: Graph,
  definitions: Record<string, GraphComponentPayload> = Object.create(null),
  measured?: (id: string) => number | undefined,
): LayoutResult {
  const nodes = graph.nodes ?? []
  const typeById = new Map<string, string>()
  for (const node of nodes) {
    if (!typeById.has(node.id)) typeById.set(node.id, node.type)
  }
  return layoutGraph(
    nodes.map((node) => ({
      id: node.id,
      height: Math.max(estimatedNodeHeight(outputCount(node.type, definitions)), measured?.(node.id) ?? 0),
    })),
    (graph.edges ?? []).map((edge) => ({ from: edge.from, to: edge.to, order: outputOrder(typeById.get(edge.from), edge.output, definitions) })),
    graph.start !== null && graph.start !== undefined && graph.start !== '' ? graph.start : nodes[0]?.id ?? '',
  )
}

export function positionsForGraph(
  graph: Graph,
  definitions: Record<string, GraphComponentPayload> = Object.create(null),
): Record<string, Point> {
  return layoutForGraph(graph, definitions).positions
}
