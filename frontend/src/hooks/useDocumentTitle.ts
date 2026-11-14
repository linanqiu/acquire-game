import { useEffect } from 'react'
import { useServerRuleset } from '../ruleset/useRules'

/**
 * Sets `document.title` while the calling page is mounted and restores the product name
 * (the server ruleset's title) when it unmounts.
 */
export function useDocumentTitle(title: string) {
  const product = useServerRuleset().title
  useEffect(() => {
    document.title = title
    return () => {
      document.title = product
    }
  }, [title, product])
}
