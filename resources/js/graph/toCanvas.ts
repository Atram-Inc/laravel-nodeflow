import { resolveOutputs } from './outputs'
import { CANVAS_ORIGIN } from '../canvas/layout'
import { layoutForGraph } from './layout'
import { cloneGraphConfig } from './json'
import type { CanvasEdge, CanvasNode, Graph, GraphComponentPayload, GraphNode } from './types'

function toConfig(config: GraphNode['config']): Record<string, unknown> {
  return cloneGraphConfig(config)
}

/**
 * A pure graph adapter: the same stored draft always produces the same canvas,
 * laid out left to right (stored coordinates are not read, see layoutForGraph).
 */
export function toCanvas(
  graph: Graph,
  definitions: Record<string, GraphComponentPayload> = Object.create(null),
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const layout = layoutForGraph(graph, definitions)
  const nodes = (graph.nodes ?? []).map((node): CanvasNode => ({
    id: node.id,
    type: 'nodeflowNode',
    position: layout.positions[node.id] ?? CANVAS_ORIGIN,
    data: {
      id: node.id,
      type: node.type,
      kind: Object.prototype.hasOwnProperty.call(definitions, node.type) ? definitions[node.type]!.kind : null,
      config: toConfig(node.config),
      isStart: node.id === graph.start,
    },
  }))

  const edges = (graph.edges ?? []).map((edge, index): CanvasEdge => {
    const lanes = layout.lanes[index]
    const source = nodes.find((node) => node.id === edge.from)
    const outputs = resolveOutputs(source ? definitions[source.data.type] : undefined, source?.data.config)
    return {
      // The index makes even parallel, otherwise-identical draft edges collision-safe.
      id: `nf${index}-${edge.from}-${edge.output ?? ''}-${edge.to}`,
      type: 'nodeflowEdge',
      source: edge.from,
      sourceHandle: edge.output ?? null,
      target: edge.to,
      label: outputs.find((output) => output.id === edge.output)?.label ?? edge.output ?? undefined,
      ...(lanes === undefined ? {} : { data: { lanes } }),
    }
  })

  return { nodes, edges }
}
