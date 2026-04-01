/**
 * Security test: F03 — Next.js must emit required HTTP security headers
 *
 * Missing security headers confirmed in evidence:
 *   - X-Frame-Options          (clickjacking)
 *   - X-Content-Type-Options   (MIME sniffing)
 *   - Strict-Transport-Security (HTTPS enforcement)
 *   - Referrer-Policy          (referrer leakage)
 *   - Permissions-Policy       (browser feature restriction)
 *
 * Additionally: X-Powered-By: Next.js must be suppressed (fingerprinting).
 */

import nextConfig from '../../../next.config'

const REQUIRED_HEADERS: Record<string, string | RegExp> = {
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'strict-transport-security': /max-age=\d+/,
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': /.+/,
}

describe('Next.js security headers (F03)', () => {
    let headerMap: Record<string, string>

    beforeAll(async () => {
        expect(typeof nextConfig.headers).toBe('function')
        const entries = await (nextConfig.headers as () => Promise<any[]>)()
        expect(entries.length).toBeGreaterThan(0)

        // Merge all headers from all entries into a flat map
        headerMap = {}
        for (const entry of entries) {
            for (const { key, value } of entry.headers) {
                headerMap[key.toLowerCase()] = value
            }
        }
    })

    test.each(Object.entries(REQUIRED_HEADERS))(
        'must set %s header',
        (headerName, expected) => {
            expect(headerMap).toHaveProperty(headerName)
            if (typeof expected === 'string') {
                expect(headerMap[headerName]).toBe(expected)
            } else {
                expect(headerMap[headerName]).toMatch(expected)
            }
        }
    )

    test('must suppress X-Powered-By header', () => {
        expect(nextConfig.poweredByHeader).toBe(false)
    })
})
