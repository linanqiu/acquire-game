import type { ReactNode } from 'react'
import { useChangeFlash } from '../../hooks/useChangeFlash'

interface FlashValueProps {
  /** The number whose changes flash (the text shown is `children`). */
  value: number | null | undefined
  children: ReactNode
  className?: string
  'data-testid'?: string
}

/** A span that flashes briefly (up: positive tint, down: negative) when `value` changes. */
export function FlashValue({ value, children, className, ...rest }: FlashValueProps) {
  const ref = useChangeFlash<HTMLSpanElement>(value)
  return (
    <span ref={ref} className={className} data-testid={rest['data-testid']}>
      {children}
    </span>
  )
}
