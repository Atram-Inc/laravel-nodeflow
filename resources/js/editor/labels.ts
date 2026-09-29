/**
 * Host-translatable copy for the editor's publish, layout and read-only chrome.
 * Every key has an English default; a host passes the keys it translates.
 */
export type EditorLabels = {
    /** BCP 47 tag used for relative times ("2 minutes ago"). */
    locale: string
    publish: string
    tidy: string
    fitCanvas: string
    viewOnly: string
    notPublished: string
    unpublishedChanges: string
    deleteConnection: string
    dismiss: string
    /** The toast after a successful publish. */
    publishedToast: (version: number) => string
    /** The toast heading when publishing fails; the reason follows it. */
    publishFailed: string
    /** The reason when the server refused the graph (the issues are listed on the canvas). */
    publishInvalid: (count: number) => string
    /** The text next to Publish, for example "v3 · published 2 minutes ago by Thomas". */
    versionSummary: (details: { version: number; when: string | null; by: string | null }) => string
    justNow: string
}

export const defaultEditorLabels: EditorLabels = {
    locale: 'en',
    publish: 'Publish',
    tidy: 'Tidy',
    fitCanvas: 'Fit canvas',
    viewOnly: 'View only',
    notPublished: 'Not published',
    unpublishedChanges: 'Unpublished changes',
    deleteConnection: 'Delete connection',
    dismiss: 'Dismiss',
    publishedToast: (version) => `Published v${version}`,
    publishFailed: 'Could not publish',
    publishInvalid: (count) => `${count} issue${count === 1 ? '' : 's'} to fix first, shown on the canvas.`,
    versionSummary: ({ version, when, by }) => [
        `v${version}`,
        when === null ? null : `published ${when}${by === null ? '' : ` by ${by}`}`,
    ].filter((part) => part !== null).join(' · '),
    justNow: 'just now',
}

export function resolveEditorLabels(labels?: Partial<EditorLabels>): EditorLabels {
    if (labels === undefined) return defaultEditorLabels
    const resolved = { ...defaultEditorLabels }
    for (const key of Object.keys(labels) as Array<keyof EditorLabels>) {
        if (labels[key] !== undefined) (resolved as Record<string, unknown>)[key] = labels[key]
    }
    return resolved
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
]

/** "2 minutes ago" in the given locale; under a minute is `justNow`; null for a missing or invalid time. */
export function relativeTime(iso: string | null | undefined, now: number, locale: string, justNow: string): string | null {
    if (iso === null || iso === undefined || iso === '') return null
    const time = Date.parse(iso)
    if (!Number.isFinite(time)) return null
    const seconds = Math.max(0, Math.round((now - time) / 1000))
    if (seconds < 60) return justNow
    let format: Intl.RelativeTimeFormat
    try {
        format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    } catch {
        format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    }
    for (const [unit, size] of UNITS) {
        if (seconds >= size) return format.format(-Math.floor(seconds / size), unit)
    }
    return justNow
}
