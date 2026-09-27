import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { NodeflowIcon } from '../presentation/icons'
import { defaultEditorLabels, relativeTime, type EditorLabels } from './labels'

export type SaveIndicator = {
    status: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
    message?: string
    /** An edit the server does not hold yet, for example one waiting for the autosave debounce. */
    unsaved?: boolean
}

export type ValidationIndicator = {
    status: 'unchecked' | 'checking' | 'valid' | 'warning' | 'invalid' | 'failed'
    count?: number
}

export type PublishIndicator = {
    status: 'idle' | 'publishing' | 'published' | 'error'
    message?: string
    version?: number
}

/** The live version and who published it; the toolbar shows it next to Publish. */
export type PublicationState = {
    version: number | null
    publishedAt: string | null
    publishedBy: string | null
}

export type EditorToolbarProps = {
    flowName: string
    /** What is being edited, in the host's words (for example "Default template, applies to new FSPs"). */
    context?: string | null
    labels?: EditorLabels
    publication?: PublicationState
    /** The draft differs from the live version. */
    unpublishedChanges?: boolean
    /** Read-only mode: only viewing actions remain. */
    readOnly?: boolean
    triggerLabel: string
    publishedVersion: number | null
    save: SaveIndicator
    validation: ValidationIndicator
    publish: PublishIndicator
    publishDisabledReason?: string | null
    credentialBusy?: boolean
    canUndo: boolean
    canRedo: boolean
    hasSelection: boolean
    onUndo: () => void
    onRedo: () => void
    onAutoLayout: () => void
    onFit: () => void
    onDeleteSelected: () => void
    onValidate: () => void
    onPublish: () => void
    slots?: { leading?: ReactNode; trailing?: ReactNode }
}

type IconName = React.ComponentProps<typeof NodeflowIcon>['name']

function saveCopy(save: SaveIndicator): string {
    if (save.status === 'idle' && save.unsaved === true) return 'Unsaved changes'
    return ({ idle: 'Changes saved', saving: 'Saving changes', saved: 'Saved', error: 'Save failed', conflict: 'Save conflict' })[save.status]
}

function saveIcon(save: SaveIndicator): IconName {
    if (save.status === 'error' || save.status === 'conflict') return 'alert'
    if (save.status === 'saving' || save.unsaved === true) return 'pause'
    return 'check'
}

function validationCopy(validation: ValidationIndicator): string {
    const count = validation.count ?? 0
    if (validation.status === 'unchecked') return 'Not validated'
    if (validation.status === 'checking') return 'Checking'
    if (validation.status === 'valid') return 'Ready to publish'
    if (validation.status === 'warning') return `Ready with ${count} warning${count === 1 ? '' : 's'}`
    if (validation.status === 'invalid') return `${count} issue${count === 1 ? '' : 's'}`
    return 'Validation failed'
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card'
const outlineButton = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`
const iconButton = `inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${focusRing}`

function IconAction({ label, icon, disabled, onClick }: { label: string; icon: IconName; disabled?: boolean; onClick: () => void }) {
    return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={iconButton}>
        <NodeflowIcon name={icon} className="size-4" />
    </button>
}

function MenuAction({ label, icon, disabled, onClick }: { label: string; icon: IconName; disabled?: boolean; onClick: () => void }) {
    return <button type="button" aria-label={`${label} (more actions)`} title={label} disabled={disabled} onClick={onClick} className={`flex h-8 w-full items-center gap-2 whitespace-nowrap rounded px-2 text-sm text-popover-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}>
        <NodeflowIcon name={icon} className="size-4 text-muted-foreground" />
        <span>{label}</span>
    </button>
}

type SecondaryAction = { label: string; icon: IconName; disabled?: boolean; onClick: () => void }

function secondaryActions(props: EditorToolbarProps, labels: EditorLabels): SecondaryAction[][] {
    if (props.readOnly === true) return [[{ label: labels.fitCanvas, icon: 'fit', onClick: props.onFit }]]
    return [
        [
            { label: 'Undo', icon: 'undo', disabled: !props.canUndo, onClick: props.onUndo },
            { label: 'Redo', icon: 'redo', disabled: !props.canRedo, onClick: props.onRedo },
        ],
        [
            { label: labels.tidy, icon: 'layout', onClick: props.onAutoLayout },
            { label: labels.fitCanvas, icon: 'fit', onClick: props.onFit },
        ],
        props.hasSelection ? [{ label: 'Delete selected', icon: 'trash', onClick: props.onDeleteSelected }] : [],
    ]
}

/** A clock for relative times, refreshed every 30 seconds. */
function useNow(fixed?: number): number {
    const [now, setNow] = useState(() => fixed ?? Date.now())
    useEffect(() => {
        if (fixed !== undefined) return
        const timer = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(timer)
    }, [fixed])
    return fixed ?? now
}

/** "v3 · published 2 minutes ago by Thomas", or "Not published", plus the unpublished changes state. */
export function PublicationStatus({ publication, unpublishedChanges, labels, now }: { publication: PublicationState; unpublishedChanges: boolean; labels: EditorLabels; now?: number }) {
    const time = useNow(now)
    const summary = publication.version === null
        ? labels.notPublished
        : labels.versionSummary({ version: publication.version, when: relativeTime(publication.publishedAt, time, labels.locale, labels.justNow), by: publication.publishedBy })
    return <span className="flex min-w-0 items-center gap-2 text-xs leading-4">
        <span data-testid="nodeflow-version-summary" title={publication.publishedAt ?? undefined} className="hidden truncate text-muted-foreground md:inline">{summary}</span>
        {unpublishedChanges && publication.version !== null && <span data-testid="nodeflow-unpublished" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--nodeflow-unpublished,#b45309)]" />
            {labels.unpublishedChanges}
        </span>}
    </span>
}

/**
 * The narrow overflow menu. A bare details element stays open after an action
 * and on outside clicks, so it closes on both and on Escape.
 */
function OverflowMenu({ actions }: { actions: SecondaryAction[] }) {
    const details = useRef<HTMLDetailsElement>(null)

    useEffect(() => {
        const element = details.current
        if (element === null) return
        const onPointerDown = (event: PointerEvent) => {
            if (element.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
        }
        element.ownerDocument.addEventListener('pointerdown', onPointerDown, true)
        return () => element.ownerDocument.removeEventListener('pointerdown', onPointerDown, true)
    }, [])

    function close(returnFocus: boolean) {
        const element = details.current
        if (element === null) return
        element.open = false
        if (returnFocus) element.querySelector('summary')?.focus()
    }

    function onKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
        if (event.key !== 'Escape' || details.current?.open !== true) return
        event.preventDefault()
        event.stopPropagation()
        close(true)
    }

    return <details ref={details} className="relative" onKeyDown={onKeyDown}>
        <summary aria-label="More workflow actions" title="More workflow actions" className={`flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted [&::-webkit-details-marker]:hidden ${focusRing}`}>
            <NodeflowIcon name="more" className="size-4" />
        </summary>
        <div className="absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md">
            {actions.map((action) => <MenuAction key={action.label} {...action} onClick={() => { close(false); action.onClick() }} />)}
        </div>
    </details>
}

/** Package-owned workflow context and command controls; server/controller state stays outside. */
export function EditorToolbar(props: EditorToolbarProps) {
    const labels = props.labels ?? defaultEditorLabels
    const readOnly = props.readOnly === true
    const publishDescriptionId = `nodeflow-publish-description-${useId().replace(/:/g, '')}`
    const saveText = saveCopy(props.save)
    const validationText = validationCopy(props.validation)
    const publication = props.publication ?? { version: props.publishedVersion, publishedAt: null, publishedBy: null }
    const publishing = props.publish.status === 'publishing'
    const publishDescription = props.publishDisabledReason
        ?? (publishing ? 'Publishing is in progress.' : 'Flow is ready to publish.')
    const saveTone = props.save.status === 'error' || props.save.status === 'conflict' ? 'text-destructive' : 'text-muted-foreground'
    const validationTone = props.validation.status === 'invalid' || props.validation.status === 'failed'
        ? 'bg-destructive/10 text-foreground'
        : 'bg-muted text-foreground'
    const groups = secondaryActions(props, labels).filter((group) => group.length > 0)
    const subtitle = [props.context, `Trigger: ${props.triggerLabel}`].filter((part): part is string => typeof part === 'string' && part !== '')

    return <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2 text-card-foreground sm:px-4">
        {props.slots?.leading}
        <div className="min-w-0 grow basis-40">
            <h1 title={props.flowName} className="flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-5">
                <span className="truncate">{props.flowName}</span>
                {readOnly && <span data-testid="nodeflow-view-only" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium leading-4 text-foreground"><NodeflowIcon name="eye" className="size-3" />{labels.viewOnly}</span>}
            </h1>
            <p data-testid="nodeflow-editor-context" className="flex min-w-0 gap-1 truncate text-xs leading-4 text-muted-foreground">{subtitle.map((part, index) => <span key={part} className={index === 0 && subtitle.length > 1 ? 'shrink-0 font-medium text-foreground' : 'truncate'}>{index > 0 && <span aria-hidden="true" className="mr-1">·</span>}{part}</span>)}</p>
        </div>
        <div className="flex items-center gap-1" aria-label="Workflow editing actions" role="group">
            <div className="hidden items-center gap-1 lg:flex">
                {groups.map((group, index) => <div key={group[0]!.label} className={`flex items-center gap-0.5${index > 0 ? ' border-l border-border pl-1' : ''}`}>
                    {group.map((action) => <IconAction key={action.label} {...action} />)}
                </div>)}
            </div>
            <div className="lg:hidden" aria-label="More workflow actions" role="group">
                <OverflowMenu actions={groups.flat()} />
            </div>
        </div>
        <div className="flex min-w-0 items-center gap-2" aria-label="Workflow persistence actions" role="group">
            <PublicationStatus publication={publication} unpublishedChanges={props.unpublishedChanges === true} labels={labels} />
            {!readOnly && <>
                <span role="status" aria-live="polite" aria-label={`Save status: ${saveText}`} title={props.save.message ?? saveText} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${saveTone}`}>
                    <NodeflowIcon name={saveIcon(props.save)} className="size-3.5" />
                    <span className="hidden sm:inline">{saveText}</span>
                </span>
                <button type="button" aria-label="Validate flow" title={validationText} disabled={props.validation.status === 'checking'} onClick={props.onValidate} className={outlineButton}>
                    <NodeflowIcon name={props.validation.status === 'invalid' || props.validation.status === 'failed' ? 'alert' : 'check'} className={`size-4${props.validation.status === 'invalid' || props.validation.status === 'failed' ? ' text-destructive' : ''}`} />
                    <span>Validate</span>
                    <span className={`hidden rounded px-1.5 py-px text-[11px] font-medium leading-4 xl:inline ${validationTone}`}>{validationText}</span>
                </button>
                <span id={publishDescriptionId} role="status" aria-live="polite" aria-label="Publish readiness" className="sr-only">{publishDescription}</span>
                <button type="button" aria-label={labels.publish} aria-describedby={publishDescriptionId} aria-busy={props.credentialBusy ?? publishing} title={props.publishDisabledReason ?? props.publish.message ?? labels.publish} disabled={publishing || props.publishDisabledReason != null} onClick={props.onPublish} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}>
                    <NodeflowIcon name={publishing ? 'spinner' : props.publish.status === 'error' ? 'alert' : 'play'} className={`size-4${publishing ? ' animate-spin motion-reduce:animate-none' : ''}`} />
                    <span>{labels.publish}</span>
                </button>
            </>}
        </div>
        {props.slots?.trailing}
    </header>
}
