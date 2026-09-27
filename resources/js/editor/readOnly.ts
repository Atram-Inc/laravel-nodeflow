import { createContext, useContext } from 'react'

/**
 * True inside a read-only editor's inspector. Host controls that render their
 * own actions (attach, upload, remove) read it to hide them; native inputs are
 * already disabled by the surrounding fieldset.
 */
export const EditorReadOnlyContext = createContext(false)

export function useEditorReadOnly(): boolean {
    return useContext(EditorReadOnlyContext)
}
