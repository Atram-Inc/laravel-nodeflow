import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { CanvasEdgeLane } from '../graph/types'
import { LAYER_GAP, NODE_WIDTH } from './layout'

const CORNER_RADIUS = 10

type Point = { x: number; y: number }

function lanesOf(data: unknown): CanvasEdgeLane[] | undefined {
    if (typeof data !== 'object' || data === null || !('lanes' in data)) return undefined
    const lanes = (data as { lanes?: unknown }).lanes
    if (!Array.isArray(lanes) || lanes.length === 0) return undefined
    return lanes.every((lane) => typeof lane === 'object' && lane !== null
        && Number.isFinite((lane as CanvasEdgeLane).x) && Number.isFinite((lane as CanvasEdgeLane).y))
        ? lanes as CanvasEdgeLane[]
        : undefined
}

/** Rounded orthogonal polyline through the given corners. */
function roundedPath(points: Point[], radius: number): string {
    let path = `M ${points[0]!.x},${points[0]!.y}`
    for (let index = 1; index < points.length - 1; index += 1) {
        const previous = points[index - 1]!
        const corner = points[index]!
        const next = points[index + 1]!
        const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y)
        const outLength = Math.hypot(next.x - corner.x, next.y - corner.y)
        const r = Math.min(radius, inLength / 2, outLength / 2)
        if (r <= 0) {
            path += ` L ${corner.x},${corner.y}`
            continue
        }
        const before = { x: corner.x - ((corner.x - previous.x) / inLength) * r, y: corner.y - ((corner.y - previous.y) / inLength) * r }
        const after = { x: corner.x + ((next.x - corner.x) / outLength) * r, y: corner.y + ((next.y - corner.y) / outLength) * r }
        path += ` L ${before.x},${before.y} Q ${corner.x},${corner.y} ${after.x},${after.y}`
    }
    const last = points[points.length - 1]!
    return `${path} L ${last.x},${last.y}`
}

/**
 * The route of an edge that jumps columns: out of the source, then through the
 * free lane the layout kept in every column it crosses, turning only in the
 * empty gaps between columns, then into the target. Returns null when the
 * nodes no longer sit where the lanes were laid out for (a node was dragged
 * sideways), so the caller falls back to a plain step path.
 */
export function lanePath(
    source: Point,
    target: Point,
    lanes: CanvasEdgeLane[],
): { path: string; labelX: number; labelY: number } | null {
    const first = lanes[0]!
    const last = lanes[lanes.length - 1]!
    if (source.x >= first.x || target.x <= last.x + NODE_WIDTH) return null
    for (let index = 1; index < lanes.length; index += 1) {
        if (lanes[index]!.x <= lanes[index - 1]!.x) return null
    }

    const points: Point[] = [source]
    let y = source.y
    const turn = (x: number, nextY: number): void => {
        if (nextY === y) return
        points.push({ x, y }, { x, y: nextY })
        y = nextY
    }
    for (const lane of lanes) {
        turn(lane.x - LAYER_GAP / 2, lane.y)
    }
    turn(Math.max(last.x + NODE_WIDTH + LAYER_GAP / 2, target.x - LAYER_GAP / 2), target.y)
    points.push(target)

    const firstTurn = points.length > 2 ? points[1]!.x : target.x
    return {
        path: roundedPath(points, CORNER_RADIUS),
        labelX: (source.x + firstTurn) / 2,
        labelY: source.y,
    }
}

/** A readable route with the declared output shown just above its midpoint. */
export function WorkflowEdge({
    id,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    label,
    style,
    markerStart,
    markerEnd,
    selected,
    data,
}: EdgeProps) {
    const lanes = lanesOf(data)
    const routed = lanes === undefined ? null : lanePath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, lanes)
    const [path, labelX, labelY] = routed !== null
        ? [routed.path, routed.labelX, routed.labelY]
        : getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
            borderRadius: CORNER_RADIUS,
        })
    const labelText = typeof label === 'string' || typeof label === 'number' ? String(label) : ''

    return (
        <>
            <BaseEdge
                id={id}
                path={path}
                style={style}
                markerStart={markerStart}
                markerEnd={markerEnd}
                className="react-flow__edge-path"
            />
            {labelText !== '' && (
                <EdgeLabelRenderer>
                    <div
                        aria-label={`Connection output: ${labelText}`}
                        className={`pointer-events-none nodrag nopan rounded border bg-card px-1.5 py-px text-[11px] font-medium leading-4 shadow-xs ${selected ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}
                        style={{ position: 'absolute', transform: `translate(-50%, -100%) translate(${labelX}px,${labelY - 6}px)` }}
                    >
                        {labelText}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    )
}
