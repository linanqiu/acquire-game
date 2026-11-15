import { useEffect } from 'react'
import { useBrand } from '../ruleset/useRules'

/**
 * Sets `document.title` while the calling page is mounted and restores the product name
 * (the brand, server setting GAME_BRAND_NAME) when it unmounts.
 */
export function useDocumentTitle(title: string) {
  const product = useBrand()
  useEffect(() => {
    document.title = title
    return () => {
      document.title = product
    }
  }, [title, product])
}
