'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { ReactNode, useEffect } from 'react'
import { ANALYTICS_CONSENT_EVENT, readAnalyticsConsent } from '@/lib/analyticsConsent'

function isPostHogLoaded(): boolean {
    return Boolean((posthog as unknown as { __loaded?: boolean }).__loaded)
}

export function PHProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
        const initIfConsented = () => {
            const consent = readAnalyticsConsent()
            if (consent !== 'accepted') return

            const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
            const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'

            if (!key) return

            // Avoid re-init warnings (especially under React strict mode).
            if (!isPostHogLoaded()) {
                posthog.init(key, {
                    api_host: host,
                    person_profiles: 'always',
                    capture_pageview: true, // Automagically capture pageviews
                    // If a user later opts out, disable persistence as well.
                    opt_out_persistence_by_default: true,
                })
            }

            // If PostHog previously stored an opt-out, ensure consent is reflected.
            posthog.opt_in_capturing?.({ captureEventName: false })
        }

        const handleConsentChange = () => {
            const consent = readAnalyticsConsent()
            if (consent === 'accepted') {
                initIfConsented()
                return
            }

            // Stop capturing if the user rejected analytics after previously accepting.
            if (isPostHogLoaded()) {
                posthog.opt_out_capturing?.()
                posthog.persistence?.clear?.()
                posthog.sessionPersistence?.clear?.()
            }
        }

        initIfConsented()
        window.addEventListener(ANALYTICS_CONSENT_EVENT, handleConsentChange)
        return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, handleConsentChange)
    }, [])

    return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
