/**
 * Security test: NEW-02 — Dockerfile should not grant NOPASSWD sudo at runtime
 *
 * The runner stage previously added an omuser sudoers entry allowing passwordless
 * `chown`, which enables a privilege escalation path to container root post-RCE.
 * This test ensures that entry is absent from the production image definition.
 */

import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const DOCKERFILE_PATH = path.join(REPO_ROOT, 'Dockerfile')

function getRunnerStage(content: string): string {
    const marker = 'FROM node:24-alpine AS runner'
    const start = content.indexOf(marker)
    expect(start).not.toBe(-1)
    return content.slice(start)
}

describe('Dockerfile hardening (NEW-02)', () => {
    let dockerfile: string
    let runnerStage: string

    beforeAll(() => {
        dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf-8')
        runnerStage = getRunnerStage(dockerfile)
    })

    test('runner stage must not contain any NOPASSWD sudoers entry', () => {
        expect(runnerStage).not.toMatch(/NOPASSWD/)
    })

    test('runner stage must not install sudo', () => {
        expect(runnerStage).not.toMatch(/apk add[^\n]*\bsudo\b/)
    })

    test('runner stage must not write to /etc/sudoers', () => {
        expect(runnerStage).not.toMatch(/sudoers/)
    })
})
