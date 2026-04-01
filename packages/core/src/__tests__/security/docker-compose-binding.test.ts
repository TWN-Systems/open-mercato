/**
 * Security test: F17 — Meilisearch must not be bound to all network interfaces
 *
 * Meilisearch port 7700 must be bound to 127.0.0.1 in the dev docker-compose
 * so it is not reachable from the LAN. Internal Docker service-to-service
 * communication uses container-name DNS (not the host port binding) and is
 * unaffected by this restriction.
 */

import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

describe('docker-compose network binding (F17)', () => {
    const composeFiles = [
        path.join(REPO_ROOT, 'docker-compose.yml'),
        path.join(REPO_ROOT, 'packages/create-app/template/docker-compose.yml'),
    ]

    test.each(composeFiles)('%s — Meilisearch port must be bound to 127.0.0.1', (filePath) => {
        const content = fs.readFileSync(filePath, 'utf-8')

        // Find port mapping lines for Meilisearch (7700).
        // Match only lines that look like `- "...7700"` (Docker port declarations),
        // not healthcheck test commands that also mention the port number.
        const portLines = content
            .split('\n')
            .filter((line) => /^\s+-\s+"[^"]*7700[^"]*"/.test(line))
            .map((line) => line.trim())

        // There must be at least one port declaration
        expect(portLines.length).toBeGreaterThan(0)

        // Every 7700 port declaration must be bound to 127.0.0.1
        for (const line of portLines) {
            expect(line).toMatch(/127\.0\.0\.1.*7700/)
        }
    })
})
