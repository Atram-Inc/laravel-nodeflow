import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CanvasHud } from './CanvasHud'
import { EditorNotices, type EditorNoticesProps } from './EditorNotices'
import { EditorToolbar, PublicationStatus, type EditorToolbarProps } from './EditorToolbar'
import { defaultEditorLabels, resolveEditorLabels } from './labels'

function toolbar(overrides: Partial<EditorToolbarProps> = {}) {
    const props: EditorToolbarProps = {
        flowName: 'Welcome shoppers',
        triggerLabel: 'Order placed',
        publishedVersion: 7,
        save: { status: 'saved' },
        validation: { status: 'unchecked' },
        publish: { status: 'idle' },
        canUndo: true,
        canRedo: false,
        hasSelection: false,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onAutoLayout: vi.fn(),
        onFit: vi.fn(),
        onDeleteSelected: vi.fn(),
        onValidate: vi.fn(),
        onPublish: vi.fn(),
        ...overrides,
    }
    return { props, ...render(<EditorToolbar {...props} />) }
}

describe('EditorToolbar publication status', () => {
    const now = Date.parse('2026-09-27T12:00:00Z')

    it('shows the live version, when and by whom, as text separate from the Publish button', () => {
        render(<PublicationStatus publication={{ version: 3, publishedAt: '2026-09-27T11:58:00Z', publishedBy: 'Thomas' }} unpublishedChanges={false} labels={defaultEditorLabels} now={now} />)

        expect(screen.getByTestId('nodeflow-version-summary')).toHaveTextContent('v3 · published 2 minutes ago by Thomas')
        expect(screen.queryByTestId('nodeflow-unpublished')).toBeNull()
    })

    it('says so when the draft differs from the live version, and when nothing is live yet', () => {
        const { rerender } = render(<PublicationStatus publication={{ version: 3, publishedAt: '2026-09-27T11:59:40Z', publishedBy: null }} unpublishedChanges labels={defaultEditorLabels} now={now} />)
        expect(screen.getByTestId('nodeflow-version-summary')).toHaveTextContent('v3 · published just now')
        expect(screen.getByTestId('nodeflow-unpublished')).toHaveTextContent('Unpublished changes')

        rerender(<PublicationStatus publication={{ version: null, publishedAt: null, publishedBy: null }} unpublishedChanges labels={defaultEditorLabels} now={now} />)
        expect(screen.getByTestId('nodeflow-version-summary')).toHaveTextContent('Not published')
        expect(screen.queryByTestId('nodeflow-unpublished')).toBeNull()
    })

    it('uses host translations and the host locale for relative times', () => {
        const labels = resolveEditorLabels({
            locale: 'es',
            unpublishedChanges: 'Cambios sin publicar',
            versionSummary: ({ version, when, by }) => `v${version} · publicada ${when} por ${by}`,
        })
        render(<PublicationStatus publication={{ version: 2, publishedAt: '2026-09-27T09:00:00Z', publishedBy: 'Ana' }} unpublishedChanges labels={labels} now={now} />)

        expect(screen.getByTestId('nodeflow-version-summary')).toHaveTextContent('v2 · publicada hace 3 horas por Ana')
        expect(screen.getByTestId('nodeflow-unpublished')).toHaveTextContent('Cambios sin publicar')
    })

    it('keeps the Publish label while publishing and shows a busy spinner instead', () => {
        toolbar({ publish: { status: 'publishing' }, labels: resolveEditorLabels({ publish: 'Publicar' }) })
        const button = screen.getByRole('button', { name: 'Publicar' })

        expect(button).toHaveTextContent(/^Publicar$/)
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('aria-busy', 'true')
        expect(button.querySelector('svg')).toHaveClass('animate-spin')
    })

    it('says what is being edited ahead of the trigger', () => {
        toolbar({ context: 'Default template, applies to new FSPs' })

        expect(screen.getByTestId('nodeflow-editor-context')).toHaveTextContent('Default template, applies to new FSPs·Trigger: Order placed')
    })

    it('keeps only viewing actions in read-only mode, with a View only badge', () => {
        toolbar({ readOnly: true, publication: { version: 4, publishedAt: null, publishedBy: null } })

        expect(screen.getByTestId('nodeflow-view-only')).toHaveTextContent('View only')
        expect(screen.getByTestId('nodeflow-version-summary')).toHaveTextContent('v4')
        for (const name of ['Publish', 'Validate flow', 'Undo', 'Redo', 'Tidy']) {
            expect(screen.queryByRole('button', { name })).toBeNull()
        }
        expect(screen.queryByRole('status', { name: /Save status/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Fit canvas' })).toBeInTheDocument()
    })
})

describe('EditorToolbar', () => {
    it('keeps human workflow context and package controls ahead of optional slots', () => {
        toolbar({ slots: { leading: <span>Host back link</span>, trailing: <span>Host help</span> } })

        expect(screen.getByRole('heading', { name: 'Welcome shoppers' })).toBeInTheDocument()
        expect(screen.getByText('Trigger: Order placed')).toBeInTheDocument()
        expect(screen.getByTestId('nodeflow-version-summary')).toHaveTextContent('v7')
        expect(screen.getByText('Host back link')).toBeInTheDocument()
        expect(screen.getByText('Host help')).toBeInTheDocument()
        expect(screen.getByRole('status', { name: 'Save status: Saved' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Validate flow' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    })

    it('exposes disabled history and invokes visible canvas actions including contextual deletion', async () => {
        const user = userEvent.setup()
        const { props, rerender } = toolbar({ canUndo: false, canRedo: false, hasSelection: false })
        expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
        expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull()

        rerender(<EditorToolbar {...props} canUndo canRedo hasSelection />)
        await user.click(screen.getByRole('button', { name: 'Undo' }))
        await user.click(screen.getByRole('button', { name: 'Redo' }))
        await user.click(screen.getByRole('button', { name: 'Tidy' }))
        await user.click(screen.getByRole('button', { name: 'Fit canvas' }))
        await user.click(screen.getByRole('button', { name: 'Delete selected' }))
        expect(props.onUndo).toHaveBeenCalledOnce()
        expect(props.onRedo).toHaveBeenCalledOnce()
        expect(props.onAutoLayout).toHaveBeenCalledOnce()
        expect(props.onFit).toHaveBeenCalledOnce()
        expect(props.onDeleteSelected).toHaveBeenCalledOnce()
    })

    // An edit waiting for its debounce is not saved yet; saying so hid unsaved work.
    it('reports an idle draft with pending edits as unsaved', () => {
        toolbar({ save: { status: 'idle', unsaved: true } })
        expect(screen.getByRole('status', { name: 'Save status: Unsaved changes' })).toHaveTextContent('Unsaved changes')
    })

    it.each([
        ['idle', 'Save status: Changes saved'],
        ['saving', 'Save status: Saving changes'],
        ['saved', 'Save status: Saved'],
        ['error', 'Save status: Save failed'],
        ['conflict', 'Save status: Save conflict'],
    ] as const)('keeps %s save feedback visible and live', (status, name) => {
        toolbar({ save: { status } })
        const indicator = screen.getByRole('status', { name })
        expect(indicator).toHaveTextContent(name.replace('Save status: ', ''))
        expect(indicator).toHaveAttribute('aria-live', 'polite')
        expect(indicator).toHaveAttribute('title')
        expect(indicator).not.toHaveAttribute('tabindex')
        expect(screen.queryByRole('button', { name })).toBeNull()
    })

    it('represents validation and publishing actions, results, and disabled work states', async () => {
        const user = userEvent.setup()
        const { props, rerender } = toolbar({ validation: { status: 'warning', count: 2 }, publish: { status: 'published', version: 8 } })
        expect(screen.getByText('Ready with 2 warnings')).toBeInTheDocument()
        // The button keeps its label; the version is separate text next to it.
        expect(screen.getByRole('button', { name: 'Publish' })).toHaveTextContent(/^Publish$/)
        await user.click(screen.getByRole('button', { name: 'Validate flow' }))
        await user.click(screen.getByRole('button', { name: 'Publish' }))
        expect(props.onValidate).toHaveBeenCalledOnce()
        expect(props.onPublish).toHaveBeenCalledOnce()

        rerender(<EditorToolbar {...props} validation={{ status: 'checking' }} publish={{ status: 'publishing' }} />)
        expect(screen.getByRole('button', { name: 'Validate flow' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    })

    it('describes disabled publish readiness through a live region and announces becoming ready', () => {
        const { props, rerender } = toolbar({ publishDisabledReason: 'Add a trigger before publishing this flow.' })
        const publish = screen.getByRole('button', { name: 'Publish' })
        const readiness = screen.getByRole('status', { name: 'Publish readiness' })
        expect(publish).toBeDisabled()
        expect(publish).toHaveAccessibleDescription('Add a trigger before publishing this flow.')
        expect(readiness).toHaveAttribute('aria-live', 'polite')

        rerender(<EditorToolbar {...props} publishDisabledReason={null} />)

        expect(publish).toBeEnabled()
        expect(publish).toHaveAccessibleDescription('Flow is ready to publish.')
        expect(readiness).toHaveTextContent('Flow is ready to publish.')
    })

    it('keeps secondary actions in a named narrow overflow without duplicating primary actions', () => {
        toolbar()
        const overflow = screen.getByRole('group', { name: 'More workflow actions' })
        expect(within(overflow).getByRole('button', { name: 'Tidy (more actions)' })).toBeInTheDocument()
        expect(within(overflow).getByRole('button', { name: 'Fit canvas (more actions)' })).toBeInTheDocument()
        expect(within(overflow).getByRole('button', { name: 'Undo (more actions)' })).toBeInTheDocument()
        expect(within(overflow).getByRole('button', { name: 'Redo (more actions)' })).toBeInTheDocument()
        expect(screen.getAllByRole('status', { name: 'Save status: Saved' })).toHaveLength(1)
        expect(screen.getAllByRole('button', { name: 'Validate flow' })).toHaveLength(1)
        expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1)
        const details = overflow.querySelector('details')
        const menu = details?.querySelector(':scope > div')
        expect(details).toHaveClass('relative')
        expect(menu).toHaveClass('absolute', 'right-0', 'top-full', 'mt-1', 'z-20')
    })
})

describe('EditorToolbar overflow menu', () => {
    function openMenu() {
        const overflow = screen.getByRole('group', { name: 'More workflow actions' })
        const details = overflow.querySelector('details')!
        fireEvent.click(details.querySelector('summary')!)
        expect(details.open).toBe(true)
        return details
    }

    // A native details menu stayed open after an action and on outside clicks.
    it('closes after choosing an action', async () => {
        const user = userEvent.setup()
        const { props } = toolbar()
        const details = openMenu()
        await user.click(within(details).getByRole('button', { name: 'Tidy (more actions)' }))
        expect(props.onAutoLayout).toHaveBeenCalledOnce()
        expect(details.open).toBe(false)
    })

    it('closes on an outside pointer press and on Escape, returning focus to its button', () => {
        toolbar()
        const details = openMenu()
        fireEvent.pointerDown(document.body)
        expect(details.open).toBe(false)

        openMenu()
        const summary = details.querySelector('summary')!
        fireEvent.keyDown(within(details).getByRole('button', { name: 'Undo (more actions)' }), { key: 'Escape' })
        expect(details.open).toBe(false)
        expect(summary).toHaveFocus()
    })

    it('stays open for a press inside the menu', () => {
        toolbar()
        const details = openMenu()
        fireEvent.pointerDown(within(details).getByRole('button', { name: 'Redo (more actions)' }))
        expect(details.open).toBe(true)
    })
})

describe('EditorNotices and CanvasHud', () => {
    // The conflict actions are part of the view contract, not optional wiring a caller may forget.
    // @ts-expect-error EditorNotices requires both conflict-resolution callbacks.
    const incompleteNoticeProps: EditorNoticesProps = { save: { status: 'idle' } }
    void incompleteNoticeProps

    it('renders persistent resolution, save, structural, graph, publish and validation feedback using their alert semantics', async () => {
        const user = userEvent.setup()
        const keepMine = vi.fn()
        const useTheirs = vi.fn()
        render(<EditorNotices
            save={{ status: 'conflict', message: 'A newer revision exists.' }}
            structuralError="The editor could not build this graph."
            graphMessages={['Start node is required', 'The node legacy is unplaceable']}
            validation={{ status: 'failed' }}
            validationMessage="Validation service unavailable."
            onKeepMine={keepMine}
            onUseTheirs={useTheirs}
        />)
        expect(screen.getAllByRole('alert')).toHaveLength(4)
        expect(screen.getByText('Start node is required')).toBeInTheDocument()
        expect(screen.getByText('The node legacy is unplaceable')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Keep mine' }))
        await user.click(screen.getByRole('button', { name: 'Use theirs' }))
        expect(keepMine).toHaveBeenCalledOnce()
        expect(useTheirs).toHaveBeenCalledOnce()
    })

    it('does not duplicate routine saved feedback or publish outcomes (the publish toast answers those)', () => {
        const callbacks = { onKeepMine: vi.fn(), onUseTheirs: vi.fn() }
        const { rerender } = render(<EditorNotices save={{ status: 'saved' }} {...callbacks} />)
        expect(screen.queryByRole('alert')).toBeNull()
        rerender(<EditorNotices save={{ status: 'idle' }} publish={{ status: 'published', version: 4 }} {...callbacks} />)
        expect(screen.queryByRole('status')).toBeNull()
        rerender(<EditorNotices save={{ status: 'idle' }} publish={{ status: 'error', message: 'Publish failed.' }} {...callbacks} />)
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('shows count grammar and readiness without taking canvas pointer events', () => {
        const { rerender } = render(<CanvasHud nodeCount={1} connectionCount={2} validation={{ status: 'unchecked' }} />)
        const hud = screen.getByRole('status')
        expect(hud).toHaveClass('pointer-events-none')
        expect(hud).toHaveTextContent('1 node')
        expect(hud).toHaveTextContent('2 connections')
        expect(hud).toHaveTextContent('Not validated')
        rerender(<CanvasHud nodeCount={2} connectionCount={1} validation={{ status: 'warning', count: 3 }} />)
        expect(hud).toHaveTextContent('Ready with 3 warnings')
        rerender(<CanvasHud nodeCount={0} connectionCount={0} validation={{ status: 'invalid', count: 1 }} />)
        expect(hud).toHaveTextContent('1 issue')
    })

    it.each([
        [{ status: 'checking' }, 'Checking'],
        [{ status: 'valid' }, 'Ready to publish'],
        [{ status: 'failed' }, 'Validation failed'],
        [{ status: 'warning', count: 1 }, 'Ready with 1 warning'],
        [{ status: 'invalid', count: 2 }, '2 issues'],
    ] as const)('directly labels %o readiness in the HUD', (validation, label) => {
        render(<CanvasHud nodeCount={2} connectionCount={1} validation={validation} />)
        expect(screen.getByRole('status')).toHaveTextContent(label)
    })
})
