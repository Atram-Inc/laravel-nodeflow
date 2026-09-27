import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasActions } from '../canvas/Canvas'
import { lanePath } from '../canvas/WorkflowEdge'
import { NODE_WIDTH } from '../canvas/layout'
import type { Graph, NodeTypePayload } from '../graph/types'
import { FlowEditor } from './FlowEditor'
import { laidOutDocument, useEditorController } from './useEditorController'
import { defsByType } from '../graph/toGraph'

afterEach(() => vi.unstubAllGlobals())

const flow = { id: 1, name: 'Flood alert', status: 'active', version: 3, draft_revision: 7, draft_updated_at: null }
const urls = {
    draft: '/draft', publish: '/publish', validate: '/validate', options: '/options/__NODEFLOW_TYPE__/__NODEFLOW_FIELD__',
    trigger_options: '/trigger-options/__NODEFLOW_TYPE__/__NODEFLOW_FIELD__',
    trigger_source_options: '/trigger-source-options/__NODEFLOW_TYPE__/__NODEFLOW_SOURCE__/__NODEFLOW_FIELD__',
    rotate_webhook_secret: '/webhook-secret/rotate',
}
const condition: NodeTypePayload = {
    kind: 'executable', type: 'core.condition', label: 'Condition', group: 'Logic', icon: null, description: null,
    outputs: ['true', 'false'], fields: [], default_config: {}, cardinality: ['subject'],
}
const send: NodeTypePayload = {
    kind: 'executable', type: 'app.send', label: 'Send message', group: 'Messaging', icon: null, description: null,
    outputs: ['sent'],
    fields: [{ key: 'template', type: 'text', label: 'Template', help: null, default: null, required: false, options: {}, dynamic_options: false }],
    default_config: { template: null }, cardinality: ['subject'],
}
const exit: NodeTypePayload = {
    kind: 'executable', type: 'core.exit', label: 'Exit', group: 'Core', icon: null, description: null,
    outputs: [], fields: [], default_config: {}, cardinality: ['subject'],
}
const palette = [condition, send, exit]
const graph: Graph = {
    start: 'check',
    nodes: [
        { id: 'check', type: 'core.condition', config: {}, position: { x: 900, y: 900 } },
        { id: 'yes', type: 'app.send', config: { template: 'Stay safe' }, position: { x: 0, y: 0 } },
        { id: 'no', type: 'core.exit', config: {}, position: { x: 5, y: 5 } },
    ],
    edges: [
        { from: 'check', to: 'yes', output: 'true' },
        { from: 'check', to: 'no', output: 'false' },
    ],
}

function controller(overrides: Partial<Parameters<typeof useEditorController>[0]> = {}) {
    return renderHook(() => useEditorController({
        flow, graph, palette, trigger_nodes: [], trigger_sources: {}, webhook: null, urls, autosaveDebounceMs: 1, ...overrides,
    }))
}

function positions(view: ReturnType<typeof controller>) {
    return Object.fromEntries(view.result.current.document.nodes.map((node) => [node.id, node.position]))
}

describe('automatic layout in the editor', () => {
    it('opens every flow laid out left to right, branches fanned out in output order', () => {
        const view = controller()
        const at = positions(view)

        expect(at.check!.x).toBeLessThan(at.yes!.x)
        expect(at.yes!.x).toBe(at.no!.x)
        expect(at.yes!.y).toBeLessThan(at.no!.y)
        // Opening is not an edit: nothing to save, nothing unpublished.
        expect(view.result.current.toolbarProps.unpublishedChanges).toBe(false)
        expect(view.result.current.toolbarProps.canUndo).toBe(false)
    })

    it('re-lays out after a connection, a removal and an added node, but not after a drag', () => {
        const view = controller()
        const opened = positions(view)

        act(() => view.result.current.actions.nodesChange([{ id: 'yes', type: 'position', position: { x: 2000, y: 2000 }, dragging: false }]))
        expect(positions(view).yes).toEqual({ x: 2000, y: 2000 })

        act(() => view.result.current.actions.addNode(exit, { x: -500, y: -500 }))
        const added = positions(view)
        expect(added.yes).toEqual(opened.yes)
        expect(added.exit1!.x).toBeGreaterThanOrEqual(opened.check!.x)

        act(() => view.result.current.actions.connect({ source: 'yes', target: 'exit1', sourceHandle: 'sent', targetHandle: null }))
        const connected = positions(view)
        expect(connected.exit1!.x).toBeGreaterThan(connected.yes!.x)

        act(() => view.result.current.actions.deleteNode('no'))
        const removed = positions(view)
        expect(removed.no).toBeUndefined()
        expect(removed.exit1!.x).toBeGreaterThan(removed.yes!.x)
    })

    it('keeps the objects of nodes the layout does not move, so React Flow keeps them measured through edits', () => {
        const view = controller()
        const before = view.result.current.document
        const again = laidOutDocument(before, defsByType(palette))

        expect(again.nodes).toEqual(before.nodes)
        again.nodes.forEach((node, index) => expect(node).toBe(before.nodes[index]))
        again.edges.forEach((edge, index) => expect(edge).toBe(before.edges[index]))
    })

    it('Tidy restores the layout after manual dragging and frames it', async () => {
        const view = controller()
        const canvas: CanvasActions = { fit: vi.fn(), centerNode: vi.fn(), screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })) }
        act(() => view.result.current.actions.registerCanvas(canvas))
        const opened = positions(view)
        act(() => view.result.current.actions.nodesChange([{ id: 'no', type: 'position', position: { x: 10, y: 10 }, dragging: false }]))

        act(() => view.result.current.actions.autoLayout())

        expect(positions(view)).toEqual(opened)
        await waitFor(() => expect(canvas.fit).toHaveBeenCalledOnce())
    })

    it('brings a newly added node into view', async () => {
        const view = controller()
        const canvas: CanvasActions = { fit: vi.fn(), centerNode: vi.fn(), screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })) }
        act(() => view.result.current.actions.registerCanvas(canvas))

        act(() => view.result.current.actions.addNode(send))

        await waitFor(() => expect(canvas.centerNode).toHaveBeenCalledWith('send1'))
    })
})

describe('publish feedback', () => {
    it('answers a publish with a success toast, the new version text and no unpublished state', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url === urls.publish
            ? Response.json({ version: 4, draft_revision: 8, published_at: '2026-09-27T10:00:00Z', published_by: 'Thomas' })
            : Response.json({ draft_revision: 8 })))
        const view = controller({ flow: { ...flow, has_unpublished_changes: true, published_at: '2026-09-20T10:00:00Z', published_by: 'Ana' } })
        expect(view.result.current.toolbarProps.unpublishedChanges).toBe(true)
        expect(view.result.current.toolbarProps.publication).toEqual({ version: 3, publishedAt: '2026-09-20T10:00:00Z', publishedBy: 'Ana' })

        await act(async () => view.result.current.actions.publish())

        expect(view.result.current.toastProps.toast).toMatchObject({ kind: 'success', version: 4 })
        expect(view.result.current.toolbarProps.publication).toEqual({ version: 4, publishedAt: '2026-09-27T10:00:00Z', publishedBy: 'Thomas' })
        expect(view.result.current.toolbarProps.unpublishedChanges).toBe(false)

        act(() => view.result.current.actions.configure('yes', 'template', 'Evacuate'))
        expect(view.result.current.toolbarProps.unpublishedChanges).toBe(true)
    })

    it('answers a refused publish with an error toast that gives the reason', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url === urls.publish
            ? Response.json({ message: 'The flow could not be published.', errors: ['A message node has no text.'], node_errors: [] }, { status: 422 })
            : Response.json({ draft_revision: 8 })))
        const view = controller()

        await act(async () => view.result.current.actions.publish())

        expect(view.result.current.toastProps.toast).toMatchObject({ kind: 'error', reason: 'A message node has no text.' })
        expect(view.result.current.toolbarProps.publication?.version).toBe(3)
    })

    it('shows the toast in the editor and lets the author dismiss an error', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url === urls.publish
            ? Response.json({ message: 'Server busy.' }, { status: 503 })
            : Response.json({ draft_revision: 8 })))
        render(<FlowEditor flow={flow} graph={graph} palette={palette} trigger_nodes={[]} trigger_sources={{}} webhook={null} urls={urls} autosaveDebounceMs={1} />)

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

        const toast = await screen.findByTestId('nodeflow-publish-toast')
        expect(toast).toHaveAttribute('role', 'alert')
        expect(toast).toHaveTextContent('Could not publish')
        expect(toast).toHaveTextContent('Server busy.')
        fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))
        expect(screen.queryByTestId('nodeflow-publish-toast')).toBeNull()
    })
})

describe('read-only mode', () => {
    it('refuses every change, never saves and never publishes', async () => {
        const fetchMock = vi.fn(async () => Response.json({ draft_revision: 8 }))
        vi.stubGlobal('fetch', fetchMock)
        const view = controller({ readOnly: true })
        const before = view.result.current.document

        act(() => view.result.current.actions.nodesChange([{ id: 'yes', type: 'position', position: { x: 1, y: 1 }, dragging: false }]))
        act(() => view.result.current.actions.addNode(exit))
        act(() => view.result.current.actions.deleteNode('no'))
        act(() => view.result.current.actions.configure('yes', 'template', 'changed'))
        act(() => view.result.current.actions.autoLayout())
        await act(async () => view.result.current.actions.publish())
        await act(async () => view.result.current.actions.validate())

        expect(view.result.current.document).toBe(before)
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(fetchMock).not.toHaveBeenCalled()
        expect(view.result.current.canvasProps.interactive).toBe(false)
        expect(view.result.current.canvasProps.onConnect).toBeUndefined()
        expect(view.result.current.canvasProps.onDropNodeType).toBeUndefined()
    })

    it('shows the same canvas and forms, every field disabled, with a View only badge and no editing chrome', () => {
        render(<FlowEditor readOnly labels={{ viewOnly: 'Solo lectura' }} flow={flow} graph={graph} palette={palette} trigger_nodes={[]} trigger_sources={{}} webhook={null} urls={urls} />)

        expect(screen.getByTestId('nodeflow-view-only')).toHaveTextContent('Solo lectura')
        for (const name of ['Publish', 'Validate flow', 'Undo', 'Tidy', 'Open Node Library', 'Collapse Node Library']) {
            expect(screen.queryByRole('button', { name })).toBeNull()
        }
        expect(screen.queryByRole('complementary', { name: 'Node Library' })).toBeNull()

        const node = document.querySelector('.react-flow__node[data-id="yes"]')
        fireEvent.click(node!)
        const inspector = screen.getByRole('complementary', { name: 'Node inspector' })
        const template = within(inspector).getByLabelText(/Template/)
        expect(template).toBeDisabled()
        expect(template).toHaveValue('Stay safe')
        fireEvent.click(within(inspector).getByRole('tab', { name: 'Advanced' }))
        expect(within(inspector).queryByRole('button', { name: 'Delete node' })).toBeNull()
    })
})

describe('lane routing', () => {
    it('routes a column-jumping edge through its lane, turning only between columns', () => {
        const lanes = [{ x: 480, y: 400 }]
        const route = lanePath({ x: 330, y: 150 }, { x: 886, y: 180 }, lanes)!

        expect(route).not.toBeNull()
        const corners = [...route.path.matchAll(/Q ([\d.]+),([\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
        expect(corners.map((corner) => corner.x)).toEqual([404, 404, 480 + NODE_WIDTH + 76, 480 + NODE_WIDTH + 76])
        expect(corners.map((corner) => corner.y)).toEqual([150, 400, 400, 180])
    })

    it('falls back when a node was dragged across the lane', () => {
        expect(lanePath({ x: 600, y: 150 }, { x: 886, y: 180 }, [{ x: 480, y: 400 }])).toBeNull()
        expect(lanePath({ x: 330, y: 150 }, { x: 500, y: 180 }, [{ x: 480, y: 400 }])).toBeNull()
    })
})
