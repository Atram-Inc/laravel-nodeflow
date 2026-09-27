import { useEffect } from 'react'
import { NodeflowIcon } from '../presentation/icons'
import type { EditorLabels } from './labels'

export type PublishToastState =
    | { kind: 'success'; version: number; key: number }
    | { kind: 'error'; reason: string; key: number }
    | null

export type PublishToastProps = {
    toast: PublishToastState
    labels: EditorLabels
    onDismiss: () => void
    /** How long a success stays up. Errors stay until dismissed. */
    successMs?: number
}

/**
 * The answer to a Publish click: "Published v4" for a moment, or the reason it
 * failed until the author dismisses it. Screen readers hear both (status /
 * alert live regions).
 */
export function PublishToast({ toast, labels, onDismiss, successMs = 4000 }: PublishToastProps) {
    useEffect(() => {
        if (toast?.kind !== 'success') return
        const timer = setTimeout(onDismiss, successMs)
        return () => clearTimeout(timer)
    }, [toast, onDismiss, successMs])

    if (toast === null) return null
    const success = toast.kind === 'success'

    return <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end">
        <div
            data-testid="nodeflow-publish-toast"
            role={success ? 'status' : 'alert'}
            aria-live={success ? 'polite' : 'assertive'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg ${success ? 'border-border' : 'border-destructive/50'}`}
        >
            <span aria-hidden="true" className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${success ? 'bg-primary text-primary-foreground' : 'bg-destructive/10 text-destructive'}`}>
                <NodeflowIcon name={success ? 'check' : 'alert'} className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="font-semibold leading-5">{success ? labels.publishedToast(toast.version) : labels.publishFailed}</p>
                {!success && <p className="mt-0.5 break-words leading-5 text-muted-foreground">{toast.reason}</p>}
            </div>
            <button type="button" aria-label={labels.dismiss} title={labels.dismiss} onClick={onDismiss} className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <NodeflowIcon name="close" className="size-4" />
            </button>
        </div>
    </div>
}
