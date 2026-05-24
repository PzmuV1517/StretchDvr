import { useEffect, useRef } from 'react'

// Extend window so TypeScript knows about adsbygoogle
declare global {
  interface Window {
    adsbygoogle: Record<string, unknown>[]
  }
}

interface AdBannerProps {
  /** Your AdSense publisher ID — replace with your own ca-pub-XXXXXXXXXXXXXXXX */
  client: string
  /** The ad slot ID from your AdSense dashboard */
  slot: string
  className?: string
}

/**
 * Renders a single AdSense ad unit and initialises it on mount.
 * Safe to use in dev / with ad blockers — errors are silently swallowed.
 */
export function AdBanner({ client, slot, className }: AdBannerProps) {
  const pushed = useRef(false)

  useEffect(() => {
    if (pushed.current) return
    pushed.current = true
    try {
      ;(window.adsbygoogle = window.adsbygoogle ?? []).push({})
    } catch {
      // AdSense script not loaded (dev mode, ad blocker, etc.)
    }
  }, [])

  return (
    <ins
      className={`adsbygoogle${className ? ` ${className}` : ''}`}
      style={{ display: 'block' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="false"
    />
  )
}
