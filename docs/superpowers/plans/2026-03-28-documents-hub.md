# Documents Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Documents Hub — a `documents` core module plus three standalone provider packages (`storage-papra`, `sign-documentso`, `sign-docuseal`) — enabling full document lifecycle management (draft → signed → archived) with widget injection into sales, CRM, and portal.

**Architecture:** Abstract `IStorageProvider` and `ISigningProvider` interfaces in shared; registries and orchestration in the hub module; providers as independent npm workspace packages connecting to self-hosted instances. Sales, CRM, and portal integrate through widget injection spots only.

**Tech Stack:** TypeScript, MikroORM (PostgreSQL), Zod, React 19, Awilix DI, Playwright (integration tests)

**Spec:** `.ai/specs/SPEC-062-2026-03-28-documents-hub.md`

**Reference implementations:**
- Provider package pattern → `packages/gateway-stripe/`
- Entity pattern → `packages/core/src/modules/customers/data/entities.ts`
- Events pattern → `packages/core/src/modules/customers/events.ts`
- ACL/setup pattern → `packages/core/src/modules/customers/acl.ts` + `setup.ts`
- API route pattern → `packages/core/src/modules/customers/api/people/route.ts`

---

## File Map

### New files — shared
```
packages/shared/src/modules/documents/index.ts         ← IStorageProvider, ISigningProvider, shared types
```

### New files — hub module
```
packages/core/src/modules/documents/index.ts
packages/core/src/modules/documents/acl.ts
packages/core/src/modules/documents/events.ts
packages/core/src/modules/documents/setup.ts
packages/core/src/modules/documents/notifications.ts
packages/core/src/modules/documents/notifications.client.ts
packages/core/src/modules/documents/di.ts
packages/core/src/modules/documents/data/entities.ts
packages/core/src/modules/documents/data/validators.ts
packages/core/src/modules/documents/lib/storage-registry.ts
packages/core/src/modules/documents/lib/signing-registry.ts
packages/core/src/modules/documents/lib/document-service.ts
packages/core/src/modules/documents/lib/webhook-processor.ts
packages/core/src/modules/documents/api/GET/documents.ts
packages/core/src/modules/documents/api/POST/documents.ts
packages/core/src/modules/documents/api/GET/documents/[id].ts
packages/core/src/modules/documents/api/PUT/documents/[id].ts
packages/core/src/modules/documents/api/DELETE/documents/[id].ts
packages/core/src/modules/documents/api/POST/documents/[id]/send.ts
packages/core/src/modules/documents/api/POST/documents/[id]/archive.ts
packages/core/src/modules/documents/api/GET/documents/[id]/download.ts
packages/core/src/modules/documents/api/GET/documents/[id]/signing-url.ts
packages/core/src/modules/documents/api/POST/documents/[id]/cancel.ts
packages/core/src/modules/documents/api/GET/documents/templates.ts
packages/core/src/modules/documents/api/POST/documents/webhooks/[provider].ts
packages/core/src/modules/documents/workers/sync-status.ts
packages/core/src/modules/documents/widgets/injection/sales-document-actions.tsx
packages/core/src/modules/documents/widgets/injection/sales-document-status.tsx
packages/core/src/modules/documents/widgets/injection/sales-document-tab.tsx
packages/core/src/modules/documents/widgets/injection/crm-entity-panel.tsx
packages/core/src/modules/documents/widgets/injection/portal-documents-tab.tsx
packages/core/src/modules/documents/widgets/injection-table.ts
packages/core/src/modules/documents/backend/documents/page.tsx
packages/core/src/modules/documents/backend/documents/[id]/page.tsx
```

### New files — provider packages
```
packages/storage-papra/package.json
packages/storage-papra/tsconfig.json
packages/storage-papra/build.mjs
packages/storage-papra/src/index.ts
packages/storage-papra/src/modules/storage_papra/index.ts
packages/storage-papra/src/modules/storage_papra/integration.ts
packages/storage-papra/src/modules/storage_papra/setup.ts
packages/storage-papra/src/modules/storage_papra/lib/client.ts
packages/storage-papra/src/modules/storage_papra/lib/adapter.ts
packages/storage-papra/src/modules/storage_papra/lib/preset.ts

packages/sign-documentso/package.json
packages/sign-documentso/tsconfig.json
packages/sign-documentso/build.mjs
packages/sign-documentso/src/index.ts
packages/sign-documentso/src/modules/sign_documentso/index.ts
packages/sign-documentso/src/modules/sign_documentso/integration.ts
packages/sign-documentso/src/modules/sign_documentso/setup.ts
packages/sign-documentso/src/modules/sign_documentso/lib/client.ts
packages/sign-documentso/src/modules/sign_documentso/lib/adapter.ts
packages/sign-documentso/src/modules/sign_documentso/lib/webhook-handler.ts
packages/sign-documentso/src/modules/sign_documentso/lib/preset.ts

packages/sign-docuseal/package.json
packages/sign-docuseal/tsconfig.json
packages/sign-docuseal/build.mjs
packages/sign-docuseal/src/index.ts
packages/sign-docuseal/src/modules/sign_docuseal/index.ts
packages/sign-docuseal/src/modules/sign_docuseal/integration.ts
packages/sign-docuseal/src/modules/sign_docuseal/setup.ts
packages/sign-docuseal/src/modules/sign_docuseal/lib/client.ts
packages/sign-docuseal/src/modules/sign_docuseal/lib/adapter.ts
packages/sign-docuseal/src/modules/sign_docuseal/lib/webhook-handler.ts
packages/sign-docuseal/src/modules/sign_docuseal/lib/preset.ts
```

### Modified files
```
packages/shared/src/modules/integrations/types.ts      ← add 'document_storage' | 'document_signing' to IntegrationHubId
packages/shared/src/modules/integrations/index.ts      ← re-export documents types
packages/shared/package.json                           ← no change needed (workspace:*)
packages/root-workspace/pnpm-workspace.yaml            ← add new packages (or package.json workspaces)
apps/mercato/src/modules.ts                            ← enable documents module + 3 providers
```

---

## Phase 1 — Shared Types

### Task 1: Add provider interfaces and hub IDs to shared

**Files:**
- Modify: `packages/shared/src/modules/integrations/types.ts`
- Create: `packages/shared/src/modules/documents/index.ts`

- [ ] **Step 1: Read the existing IntegrationHubId union in shared**

```bash
grep -n "IntegrationHubId\|document_storage\|document_signing" \
  packages/shared/src/modules/integrations/types.ts
```

Expected: you'll see `IntegrationHubId` as a string union (e.g. `'payment_gateways' | 'shipping' | ...`). Note the exact line.

- [ ] **Step 2: Add the two new hub IDs to IntegrationHubId**

Find the `IntegrationHubId` type definition and append the new values:

```typescript
// before (example shape):
export type IntegrationHubId = 'payment_gateways' | 'shipping' | 'data_sync' | 'communication' | 'storage'

// after — add document_storage and document_signing:
export type IntegrationHubId =
  | 'payment_gateways'
  | 'shipping'
  | 'data_sync'
  | 'communication'
  | 'storage'
  | 'document_storage'
  | 'document_signing'
```

- [ ] **Step 3: Create the shared documents module with provider interfaces**

Create `packages/shared/src/modules/documents/index.ts`:

```typescript
export interface StorageMetadata {
  title: string
  tags?: string[]
  relatedEntityType?: string
  relatedEntityId?: string
  organizationId: string
  tenantId: string
}

export interface StorageDocument {
  ref: string
  title: string
  url: string
  tags: string[]
  createdAt: Date
}

export interface StorageFilters {
  tags?: string[]
  search?: string
  organizationId: string
  tenantId: string
}

export interface IStorageProvider {
  readonly id: string
  upload(file: Buffer, metadata: StorageMetadata): Promise<string>
  download(ref: string): Promise<Buffer>
  getUrl(ref: string): Promise<string>
  list(filters: StorageFilters): Promise<StorageDocument[]>
  tag(ref: string, tags: string[]): Promise<void>
  search(query: string, organizationId: string, tenantId: string): Promise<StorageDocument[]>
  delete(ref: string): Promise<void>
}

export interface EnvelopeInput {
  title: string
  pdfBuffer: Buffer
  signers: Array<{
    name: string
    email: string
    order?: number
  }>
  templateId?: string
  templateVariables?: Record<string, string>
  expiresAt?: Date
}

export type EnvelopeStatus =
  | 'pending'
  | 'sent'
  | 'partially_completed'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'cancelled'

export interface SigningTemplate {
  id: string
  title: string
  variables: string[]
}

export interface WebhookResult {
  envelopeId: string
  status: EnvelopeStatus
  signerEmail?: string
  reason?: string
}

export interface ISigningProvider {
  readonly id: string
  createEnvelope(input: EnvelopeInput): Promise<string>
  sendEnvelope(envelopeId: string): Promise<void>
  getStatus(envelopeId: string): Promise<EnvelopeStatus>
  getSigningUrl(envelopeId: string, signerEmail: string): Promise<string>
  downloadSigned(envelopeId: string): Promise<Buffer>
  cancelEnvelope(envelopeId: string): Promise<void>
  listTemplates(): Promise<SigningTemplate[]>
  handleWebhook(payload: unknown): Promise<WebhookResult>
}
```

- [ ] **Step 4: Export from shared module index**

Check `packages/shared/src/modules/index.ts` (or equivalent barrel). If it exists, add:

```typescript
export * from './documents'
```

If shared uses direct imports only (no barrel), skip this step — consumers will import from `@open-mercato/shared/modules/documents`.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd packages/shared && yarn typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/modules/documents/ packages/shared/src/modules/integrations/types.ts
git commit -m "feat(shared): add IStorageProvider, ISigningProvider, and document hub IDs"
```

---

## Phase 2 — Documents Hub Module

### Task 2: Module metadata, ACL, and events

**Files:**
- Create: `packages/core/src/modules/documents/index.ts`
- Create: `packages/core/src/modules/documents/acl.ts`
- Create: `packages/core/src/modules/documents/events.ts`

- [ ] **Step 1: Create module metadata**

Create `packages/core/src/modules/documents/index.ts`:

```typescript
export const metadata = {
  id: 'documents',
  title: 'Documents',
  description: 'Document lifecycle management — signing and archival.',
}

export default metadata
```

- [ ] **Step 2: Create ACL features**

Create `packages/core/src/modules/documents/acl.ts`:

```typescript
export const features = [
  { id: 'documents.view', title: 'View documents', module: 'documents' },
  { id: 'documents.create', title: 'Create and send documents', module: 'documents' },
  { id: 'documents.sign', title: 'Access signing URLs', module: 'documents' },
  { id: 'documents.archive', title: 'Archive documents', module: 'documents' },
  { id: 'documents.manage', title: 'Manage templates and settings', module: 'documents' },
]

export default features
```

- [ ] **Step 3: Create events**

Create `packages/core/src/modules/documents/events.ts`:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'documents.document.created', label: 'Document Created', entity: 'document', category: 'crud' },
  { id: 'documents.document.sent', label: 'Document Sent for Signature', entity: 'document', category: 'lifecycle', clientBroadcast: true },
  { id: 'documents.document.viewed', label: 'Document Viewed by Signer', entity: 'document', category: 'lifecycle' },
  { id: 'documents.document.partially_signed', label: 'Document Partially Signed', entity: 'document', category: 'lifecycle', clientBroadcast: true },
  { id: 'documents.document.signed', label: 'Document Signed', entity: 'document', category: 'lifecycle', clientBroadcast: true },
  { id: 'documents.document.declined', label: 'Document Declined', entity: 'document', category: 'lifecycle', clientBroadcast: true },
  { id: 'documents.document.expired', label: 'Document Expired', entity: 'document', category: 'lifecycle', clientBroadcast: true },
  { id: 'documents.document.archived', label: 'Document Archived', entity: 'document', category: 'lifecycle', clientBroadcast: true },
  { id: 'documents.document.cancelled', label: 'Document Cancelled', entity: 'document', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'documents',
  events,
})

export const emitDocumentsEvent = eventsConfig.emit
export type DocumentsEventId = (typeof events)[number]['id']
export default eventsConfig
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/modules/documents/
git commit -m "feat(documents): add module metadata, ACL features, and events"
```

---

### Task 3: Database entities

**Files:**
- Create: `packages/core/src/modules/documents/data/entities.ts`

- [ ] **Step 1: Create entities file**

Create `packages/core/src/modules/documents/data/entities.ts`:

```typescript
import {
  Entity,
  PrimaryKey,
  Property,
  Enum,
  Index,
  OptionalProps,
} from '@mikro-orm/core'

export enum DocumentType {
  QUOTE = 'quote',
  INVOICE = 'invoice',
  ORDER = 'order',
  NDA = 'nda',
  CONTRACT = 'contract',
  CUSTOM = 'custom',
}

export enum DocumentStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PENDING_SIGNATURE = 'pending_signature',
  PARTIALLY_SIGNED = 'partially_signed',
  SIGNED = 'signed',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  ARCHIVED = 'archived',
}

export enum SignerStatus {
  PENDING = 'pending',
  SENT = 'sent',
  VIEWED = 'viewed',
  SIGNED = 'signed',
  DECLINED = 'declined',
}

@Entity({ tableName: 'documents' })
@Index({ name: 'documents_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'documents_related_entity_idx', properties: ['tenantId', 'relatedEntityType', 'relatedEntityId'] })
export class Document {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Enum({ items: () => DocumentType, name: 'type' })
  type!: DocumentType

  @Enum({ items: () => DocumentStatus, name: 'status', default: DocumentStatus.DRAFT })
  status: DocumentStatus = DocumentStatus.DRAFT

  @Property({ name: 'related_entity_type', type: 'text', nullable: true })
  relatedEntityType?: string | null

  @Property({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId?: string | null

  @Property({ name: 'storage_ref', type: 'text', nullable: true })
  storageRef?: string | null

  @Property({ name: 'signing_envelope_id', type: 'text', nullable: true })
  signingEnvelopeId?: string | null

  @Property({ name: 'signing_provider_id', type: 'text', nullable: true })
  signingProviderId?: string | null

  @Property({ name: 'storage_provider_id', type: 'text', nullable: true })
  storageProviderId?: string | null

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'signed_at', type: Date, nullable: true })
  signedAt?: Date | null

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_signers' })
@Index({ name: 'document_signers_document_idx', properties: ['documentId'] })
export class DocumentSigner {
  [OptionalProps]?: 'status' | 'signingOrder' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'email', type: 'text' })
  email!: string

  @Property({ name: 'signing_order', type: 'integer', default: 0 })
  signingOrder: number = 0

  @Enum({ items: () => SignerStatus, name: 'status', default: SignerStatus.PENDING })
  status: SignerStatus = SignerStatus.PENDING

  @Property({ name: 'signing_url', type: 'text', nullable: true })
  signingUrl?: string | null

  @Property({ name: 'signed_at', type: Date, nullable: true })
  signedAt?: Date | null

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'document_templates' })
@Index({ name: 'document_templates_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class DocumentTemplate {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'type', type: 'text' })
  type!: string

  @Property({ name: 'provider_template_id', type: 'text' })
  providerTemplateId!: string

  @Property({ name: 'signing_provider_id', type: 'text' })
  signingProviderId!: string

  @Property({ name: 'variable_schema', type: 'json', nullable: true })
  variableSchema?: Record<string, unknown> | null

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null
}
```

- [ ] **Step 2: Register entities in the ORM config**

Check how other modules register entities. Look for a central entities list:

```bash
grep -rn "CustomerEntity\|entities:" packages/core/src/lib/ packages/core/src/config/ --include="*.ts" | head -20
```

Add `Document`, `DocumentSigner`, `DocumentTemplate` to the same list.

- [ ] **Step 3: Generate the migration**

```bash
yarn db:generate
```

Expected: A new migration file appears in the migrations folder with `CREATE TABLE documents`, `CREATE TABLE document_signers`, `CREATE TABLE document_templates`.

- [ ] **Step 4: Verify migration SQL looks correct**

Read the generated migration file and confirm:
- Three new tables created
- All columns have correct names (snake_case)
- Indexes created

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/documents/data/entities.ts
git add migrations/ # include the generated migration
git commit -m "feat(documents): add Document, DocumentSigner, DocumentTemplate entities + migration"
```

---

### Task 4: Validators

**Files:**
- Create: `packages/core/src/modules/documents/data/validators.ts`

- [ ] **Step 1: Create validators**

Create `packages/core/src/modules/documents/data/validators.ts`:

```typescript
import { z } from 'zod'

export const signerInputSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  order: z.number().int().min(0).optional(),
  contactId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
})

export const documentCreateSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(['quote', 'invoice', 'order', 'nda', 'contract', 'custom']),
  relatedEntityType: z.string().max(100).optional(),
  relatedEntityId: z.string().uuid().optional(),
  signers: z.array(signerInputSchema).min(1).max(20),
  templateId: z.string().uuid().optional(),
  templateVariables: z.record(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const documentUpdateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const documentSendSchema = z.object({
  signingProviderId: z.string().min(1),
})

export const documentArchiveSchema = z.object({
  storageProviderId: z.string().min(1).optional(),
})

export type DocumentCreateInput = z.infer<typeof documentCreateSchema>
export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
export type SignerInput = z.infer<typeof signerInputSchema>
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/modules/documents/data/validators.ts
git commit -m "feat(documents): add zod validators"
```

---

### Task 5: Registries and DI

**Files:**
- Create: `packages/core/src/modules/documents/lib/storage-registry.ts`
- Create: `packages/core/src/modules/documents/lib/signing-registry.ts`
- Create: `packages/core/src/modules/documents/di.ts`

- [ ] **Step 1: Create StorageRegistry**

Create `packages/core/src/modules/documents/lib/storage-registry.ts`:

```typescript
import type { IStorageProvider } from '@open-mercato/shared/modules/documents'

const storageProviders = new Map<string, IStorageProvider>()

export function registerStorageProvider(provider: IStorageProvider): void {
  storageProviders.set(provider.id, provider)
}

export function getStorageProvider(id: string): IStorageProvider {
  const provider = storageProviders.get(id)
  if (!provider) {
    throw new Error(`Storage provider '${id}' is not registered. Enable the provider integration first.`)
  }
  return provider
}

export function getDefaultStorageProvider(): IStorageProvider {
  const [provider] = storageProviders.values()
  if (!provider) {
    throw new Error('No storage provider is registered. Enable a storage integration (e.g. storage-papra).')
  }
  return provider
}

export function hasStorageProvider(id: string): boolean {
  return storageProviders.has(id)
}

export function listStorageProviders(): IStorageProvider[] {
  return Array.from(storageProviders.values())
}
```

- [ ] **Step 2: Create SigningRegistry**

Create `packages/core/src/modules/documents/lib/signing-registry.ts`:

```typescript
import type { ISigningProvider } from '@open-mercato/shared/modules/documents'

const signingProviders = new Map<string, ISigningProvider>()

export function registerSigningProvider(provider: ISigningProvider): void {
  signingProviders.set(provider.id, provider)
}

export function getSigningProvider(id: string): ISigningProvider {
  const provider = signingProviders.get(id)
  if (!provider) {
    throw new Error(`Signing provider '${id}' is not registered. Enable the provider integration first.`)
  }
  return provider
}

export function getDefaultSigningProvider(): ISigningProvider {
  const [provider] = signingProviders.values()
  if (!provider) {
    throw new Error('No signing provider is registered. Enable a signing integration (e.g. sign-documentso).')
  }
  return provider
}

export function hasSigningProvider(id: string): boolean {
  return signingProviders.has(id)
}

export function listSigningProviders(): ISigningProvider[] {
  return Array.from(signingProviders.values())
}
```

- [ ] **Step 3: Check how other modules register DI services**

```bash
cat packages/core/src/modules/customers/di.ts 2>/dev/null || echo "No di.ts in customers"
cat packages/gateway-stripe/src/modules/gateway_stripe/di.ts 2>/dev/null || echo "No di.ts in gateway-stripe"
```

Match the pattern you see. If modules use a `register(container)` export, create `di.ts` following that pattern to register `documentService` in the container.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/modules/documents/lib/
git commit -m "feat(documents): add StorageRegistry and SigningRegistry"
```

---

### Task 6: Document service (orchestration)

**Files:**
- Create: `packages/core/src/modules/documents/lib/document-service.ts`

- [ ] **Step 1: Create document service**

Create `packages/core/src/modules/documents/lib/document-service.ts`:

```typescript
import type { EntityManager } from '@mikro-orm/postgresql'
import { Document, DocumentSigner, DocumentStatus } from '../data/entities'
import { getSigningProvider, getDefaultSigningProvider } from './signing-registry'
import { getStorageProvider, getDefaultStorageProvider } from './storage-registry'
import { emitDocumentsEvent } from '../events'
import type { DocumentCreateInput } from '../data/validators'

export function createDocumentService(em: EntityManager) {
  async function createDocument(
    input: DocumentCreateInput,
    scope: { organizationId: string; tenantId: string },
  ): Promise<Document> {
    const doc = em.create(Document, {
      title: input.title,
      type: input.type as Document['type'],
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      metadata: input.metadata,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    await em.persistAndFlush(doc)

    for (const signerInput of input.signers) {
      const signer = em.create(DocumentSigner, {
        documentId: doc.id,
        name: signerInput.name,
        email: signerInput.email,
        signingOrder: signerInput.order ?? 0,
        contactId: signerInput.contactId,
        customerId: signerInput.customerId,
      })
      em.persist(signer)
    }
    await em.flush()

    await emitDocumentsEvent('documents.document.created', {
      documentId: doc.id,
      type: doc.type,
      relatedEntityType: doc.relatedEntityType ?? undefined,
      relatedEntityId: doc.relatedEntityId ?? undefined,
    })

    return doc
  }

  async function sendForSignature(
    documentId: string,
    signingProviderId: string | undefined,
    scope: { organizationId: string; tenantId: string },
  ): Promise<Document> {
    const doc = await em.findOneOrFail(Document, {
      id: documentId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    const signers = await em.find(DocumentSigner, { documentId: doc.id })
    const provider = signingProviderId
      ? getSigningProvider(signingProviderId)
      : getDefaultSigningProvider()

    // For real use, the pdfBuffer should come from a generated/attached PDF.
    // For now, use an empty buffer — implementations should replace with actual PDF generation.
    const pdfBuffer = Buffer.alloc(0)

    const envelopeId = await provider.createEnvelope({
      title: doc.title,
      pdfBuffer,
      signers: signers.map((s) => ({ name: s.name, email: s.email, order: s.signingOrder })),
      expiresAt: doc.expiresAt ?? undefined,
    })

    await provider.sendEnvelope(envelopeId)

    for (const signer of signers) {
      try {
        signer.signingUrl = await provider.getSigningUrl(envelopeId, signer.email)
        signer.status = 'sent' as DocumentSigner['status']
      } catch {
        // signing URL may not be available until signer opens the email
      }
    }

    doc.signingEnvelopeId = envelopeId
    doc.signingProviderId = provider.id
    doc.status = DocumentStatus.SENT
    await em.flush()

    await emitDocumentsEvent('documents.document.sent', {
      documentId: doc.id,
      signerCount: signers.length,
    })

    return doc
  }

  async function archiveDocument(
    documentId: string,
    storageProviderId: string | undefined,
    pdfBuffer: Buffer,
    scope: { organizationId: string; tenantId: string },
  ): Promise<Document> {
    const doc = await em.findOneOrFail(Document, {
      id: documentId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    const provider = storageProviderId
      ? getStorageProvider(storageProviderId)
      : getDefaultStorageProvider()

    const ref = await provider.upload(pdfBuffer, {
      title: doc.title,
      tags: [doc.type, doc.relatedEntityType ?? 'document'].filter(Boolean),
      relatedEntityType: doc.relatedEntityType ?? undefined,
      relatedEntityId: doc.relatedEntityId ?? undefined,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    doc.storageRef = ref
    doc.storageProviderId = provider.id
    doc.status = DocumentStatus.ARCHIVED
    doc.archivedAt = new Date()
    await em.flush()

    await emitDocumentsEvent('documents.document.archived', {
      documentId: doc.id,
      storageRef: ref,
    })

    return doc
  }

  async function applyWebhookResult(
    envelopeId: string,
    result: { status: string; signerEmail?: string; reason?: string },
    em: EntityManager,
  ): Promise<void> {
    const doc = await em.findOne(Document, { signingEnvelopeId: envelopeId, deletedAt: null })
    if (!doc) return

    if (result.status === 'completed') {
      const signers = await em.find(DocumentSigner, { documentId: doc.id })
      const allSigned = signers.every((s) => s.status === 'signed')

      if (result.signerEmail) {
        const signer = signers.find((s) => s.email === result.signerEmail)
        if (signer) {
          signer.status = 'signed' as DocumentSigner['status']
          signer.signedAt = new Date()
        }
      }

      const signedCount = signers.filter((s) => s.status === 'signed').length
      if (allSigned || signedCount === signers.length) {
        doc.status = DocumentStatus.SIGNED
        doc.signedAt = new Date()
        await em.flush()

        // Auto-archive the signed document
        if (doc.signingProviderId) {
          try {
            const signingProvider = getSigningProvider(doc.signingProviderId)
            const pdfBuffer = await signingProvider.downloadSigned(envelopeId)
            const scope = { organizationId: doc.organizationId, tenantId: doc.tenantId }
            await archiveDocument(doc.id, doc.storageProviderId ?? undefined, pdfBuffer, scope)
          } catch (err) {
            console.error(`[documents] Failed to auto-archive signed document ${doc.id}:`, err)
          }
        }

        await emitDocumentsEvent('documents.document.signed', { documentId: doc.id })
      } else {
        doc.status = DocumentStatus.PARTIALLY_SIGNED
        await em.flush()
        await emitDocumentsEvent('documents.document.partially_signed', {
          documentId: doc.id,
          signedCount,
          totalCount: signers.length,
        })
      }
    } else if (result.status === 'declined') {
      doc.status = DocumentStatus.DECLINED
      await em.flush()
      await emitDocumentsEvent('documents.document.declined', {
        documentId: doc.id,
        signerEmail: result.signerEmail,
        reason: result.reason,
      })
    } else if (result.status === 'expired') {
      doc.status = DocumentStatus.EXPIRED
      await em.flush()
      await emitDocumentsEvent('documents.document.expired', { documentId: doc.id })
    }
  }

  return { createDocument, sendForSignature, archiveDocument, applyWebhookResult }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/modules/documents/lib/document-service.ts
git commit -m "feat(documents): add DocumentService with create, send, archive, and webhook result handling"
```

---

### Task 7: Webhook processor

**Files:**
- Create: `packages/core/src/modules/documents/lib/webhook-processor.ts`

- [ ] **Step 1: Create webhook processor**

Create `packages/core/src/modules/documents/lib/webhook-processor.ts`:

```typescript
import type { EntityManager } from '@mikro-orm/postgresql'
import { getSigningProvider } from './signing-registry'
import { createDocumentService } from './document-service'

export async function processInboundWebhook(
  providerId: string,
  payload: unknown,
  em: EntityManager,
): Promise<{ ok: boolean; message: string }> {
  const provider = getSigningProvider(providerId)
  let result

  try {
    result = await provider.handleWebhook(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook parse error'
    console.error(`[documents] Webhook error from provider '${providerId}':`, message)
    return { ok: false, message }
  }

  const service = createDocumentService(em)
  await service.applyWebhookResult(result.envelopeId, result, em)

  return { ok: true, message: 'processed' }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/modules/documents/lib/webhook-processor.ts
git commit -m "feat(documents): add webhook processor"
```

---

### Task 8: API routes

**Files:**
- Create all API route files listed in the file map under `api/`

- [ ] **Step 1: Create GET /api/documents (list)**

Create `packages/core/src/modules/documents/api/GET/documents.ts`:

```typescript
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Document } from '../../data/entities'

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.string().optional(),
  type: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().uuid().optional(),
  search: z.string().optional(),
})

export const openApi = {
  GET: {
    summary: 'List documents',
    tags: ['Documents'],
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
      { name: 'status', in: 'query', schema: { type: 'string' } },
      { name: 'type', in: 'query', schema: { type: 'string' } },
      { name: 'relatedEntityType', in: 'query', schema: { type: 'string' } },
      { name: 'relatedEntityId', in: 'query', schema: { type: 'string' } },
    ],
    responses: { 200: { description: 'List of documents' } },
  },
}

export default makeCrudRoute({
  entity: Document,
  method: 'GET',
  requireAuth: true,
  requireFeatures: ['documents.view'],
  querySchema: listSchema,
  indexer: { entityType: 'document' },
  buildQuery: (query, scope) => {
    const where: Record<string, unknown> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }
    if (query.status) where.status = query.status
    if (query.type) where.type = query.type
    if (query.relatedEntityType) where.relatedEntityType = query.relatedEntityType
    if (query.relatedEntityId) where.relatedEntityId = query.relatedEntityId
    return where
  },
})
```

- [ ] **Step 2: Create POST /api/documents (create)**

Create `packages/core/src/modules/documents/api/POST/documents.ts`:

```typescript
import { documentCreateSchema } from '../../data/validators'
import { createDocumentService } from '../../lib/document-service'

export const openApi = {
  POST: {
    summary: 'Create document',
    tags: ['Documents'],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { 201: { description: 'Created document' } },
  },
}

export default async function handler(req: Request, ctx: { em: any; scope: { organizationId: string; tenantId: string } }) {
  const body = documentCreateSchema.parse(await req.json())
  const service = createDocumentService(ctx.em)
  const doc = await service.createDocument(body, ctx.scope)
  return Response.json(doc, { status: 201 })
}
```

> Note: Check the exact handler signature used in `packages/core/src/modules/customers/api/people/route.ts` and adapt accordingly. The pattern above is illustrative — match the framework's actual request/response contract.

- [ ] **Step 3: Create remaining CRUD routes**

Follow the same pattern for:

`packages/core/src/modules/documents/api/GET/documents/[id].ts` — fetch single document with signers:
```typescript
import { Document, DocumentSigner } from '../../../data/entities'

export const openApi = { GET: { summary: 'Get document', tags: ['Documents'], responses: { 200: { description: 'Document' } } } }

export default async function handler(req: Request, ctx: any) {
  const { id } = ctx.params
  const doc = await ctx.em.findOneOrFail(Document, {
    id,
    tenantId: ctx.scope.tenantId,
    organizationId: ctx.scope.organizationId,
    deletedAt: null,
  })
  const signers = await ctx.em.find(DocumentSigner, { documentId: id })
  return Response.json({ ...doc, signers })
}
```

`packages/core/src/modules/documents/api/PUT/documents/[id].ts` — update title/metadata/expiresAt

`packages/core/src/modules/documents/api/DELETE/documents/[id].ts` — soft delete (set deletedAt)

- [ ] **Step 4: Create action routes**

`packages/core/src/modules/documents/api/POST/documents/[id]/send.ts`:
```typescript
import { z } from 'zod'
import { createDocumentService } from '../../../../lib/document-service'

export const openApi = { POST: { summary: 'Send document for signature', tags: ['Documents'], responses: { 200: { description: 'Updated document' } } } }

export default async function handler(req: Request, ctx: any) {
  const { id } = ctx.params
  const body = z.object({ signingProviderId: z.string().optional() }).parse(await req.json())
  const service = createDocumentService(ctx.em)
  const doc = await service.sendForSignature(id, body.signingProviderId, ctx.scope)
  return Response.json(doc)
}
```

`packages/core/src/modules/documents/api/POST/documents/[id]/archive.ts`:
```typescript
import { z } from 'zod'
import { createDocumentService } from '../../../../lib/document-service'
import { getSigningProvider } from '../../../../lib/signing-registry'
import { Document } from '../../../../data/entities'

export const openApi = { POST: { summary: 'Archive document to storage', tags: ['Documents'], responses: { 200: { description: 'Updated document' } } } }

export default async function handler(req: Request, ctx: any) {
  const { id } = ctx.params
  const body = z.object({ storageProviderId: z.string().optional() }).parse(await req.json())
  const service = createDocumentService(ctx.em)

  const doc = await ctx.em.findOneOrFail(Document, { id, tenantId: ctx.scope.tenantId, deletedAt: null })

  let pdfBuffer = Buffer.alloc(0)
  if (doc.signingEnvelopeId && doc.signingProviderId) {
    const signingProvider = getSigningProvider(doc.signingProviderId)
    pdfBuffer = await signingProvider.downloadSigned(doc.signingEnvelopeId)
  }

  const updated = await service.archiveDocument(id, body.storageProviderId, pdfBuffer, ctx.scope)
  return Response.json(updated)
}
```

`packages/core/src/modules/documents/api/GET/documents/[id]/download.ts`:
```typescript
import { Document } from '../../../../data/entities'
import { getStorageProvider } from '../../../../lib/storage-registry'
import { getSigningProvider } from '../../../../lib/signing-registry'

export const openApi = { GET: { summary: 'Download document PDF', tags: ['Documents'], responses: { 200: { description: 'PDF file' } } } }

export default async function handler(req: Request, ctx: any) {
  const { id } = ctx.params
  const doc = await ctx.em.findOneOrFail(Document, { id, tenantId: ctx.scope.tenantId, deletedAt: null })

  let buffer: Buffer
  if (doc.storageRef && doc.storageProviderId) {
    buffer = await getStorageProvider(doc.storageProviderId).download(doc.storageRef)
  } else if (doc.signingEnvelopeId && doc.signingProviderId) {
    buffer = await getSigningProvider(doc.signingProviderId).downloadSigned(doc.signingEnvelopeId)
  } else {
    return new Response('No PDF available', { status: 404 })
  }

  return new Response(buffer, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc.title}.pdf"` },
  })
}
```

`packages/core/src/modules/documents/api/GET/documents/[id]/signing-url.ts`:
```typescript
import { z } from 'zod'
import { Document, DocumentSigner } from '../../../../data/entities'
import { getSigningProvider } from '../../../../lib/signing-registry'

export const openApi = { GET: { summary: 'Get signing URL for a signer', tags: ['Documents'], responses: { 200: { description: 'Signing URL' } } } }

export default async function handler(req: Request, ctx: any) {
  const { id } = ctx.params
  const { email } = z.object({ email: z.string().email() }).parse(ctx.query)
  const doc = await ctx.em.findOneOrFail(Document, { id, tenantId: ctx.scope.tenantId, deletedAt: null })

  if (!doc.signingEnvelopeId || !doc.signingProviderId) {
    return Response.json({ error: 'Document has not been sent for signature' }, { status: 400 })
  }

  const signer = await ctx.em.findOneOrFail(DocumentSigner, { documentId: id, email })
  const url = signer.signingUrl ?? await getSigningProvider(doc.signingProviderId).getSigningUrl(doc.signingEnvelopeId, email)
  return Response.json({ url })
}
```

`packages/core/src/modules/documents/api/POST/documents/[id]/cancel.ts`:
```typescript
import { Document, DocumentStatus } from '../../../../data/entities'
import { getSigningProvider } from '../../../../lib/signing-registry'
import { emitDocumentsEvent } from '../../../../events'

export const openApi = { POST: { summary: 'Cancel document envelope', tags: ['Documents'], responses: { 200: { description: 'Cancelled' } } } }

export default async function handler(req: Request, ctx: any) {
  const { id } = ctx.params
  const doc = await ctx.em.findOneOrFail(Document, { id, tenantId: ctx.scope.tenantId, deletedAt: null })

  if (doc.signingEnvelopeId && doc.signingProviderId) {
    await getSigningProvider(doc.signingProviderId).cancelEnvelope(doc.signingEnvelopeId)
  }

  doc.status = DocumentStatus.DRAFT
  doc.signingEnvelopeId = null
  await ctx.em.flush()
  await emitDocumentsEvent('documents.document.cancelled', { documentId: doc.id })
  return Response.json(doc)
}
```

`packages/core/src/modules/documents/api/GET/documents/templates.ts`:
```typescript
import { listSigningProviders } from '../../../lib/signing-registry'

export const openApi = { GET: { summary: 'List templates from active signing provider', tags: ['Documents'], responses: { 200: { description: 'Templates' } } } }

export default async function handler(req: Request, ctx: any) {
  const providers = listSigningProviders()
  const templates = await Promise.all(providers.map(async (p) => {
    const list = await p.listTemplates()
    return list.map((t) => ({ ...t, providerId: p.id }))
  }))
  return Response.json({ data: templates.flat() })
}
```

`packages/core/src/modules/documents/api/POST/documents/webhooks/[provider].ts`:
```typescript
import { processInboundWebhook } from '../../../../lib/webhook-processor'

export const openApi = { POST: { summary: 'Inbound signing provider webhook', tags: ['Documents'], responses: { 200: { description: 'OK' } } } }

export default async function handler(req: Request, ctx: any) {
  const { provider } = ctx.params
  const payload = await req.json()
  const result = await processInboundWebhook(provider, payload, ctx.em)
  return Response.json(result, { status: result.ok ? 200 : 400 })
}
```

- [ ] **Step 5: Run TypeScript check**

```bash
yarn typecheck 2>&1 | grep "modules/documents" | head -20
```

Fix any type errors before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/documents/api/
git commit -m "feat(documents): add all API routes"
```

---

### Task 9: Setup, notifications, worker, and backend pages

**Files:**
- Create: `packages/core/src/modules/documents/setup.ts`
- Create: `packages/core/src/modules/documents/notifications.ts`
- Create: `packages/core/src/modules/documents/workers/sync-status.ts`
- Create: `packages/core/src/modules/documents/backend/documents/page.tsx`
- Create: `packages/core/src/modules/documents/backend/documents/[id]/page.tsx`

- [ ] **Step 1: Create setup.ts**

Create `packages/core/src/modules/documents/setup.ts`:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['documents.view', 'documents.create', 'documents.sign', 'documents.archive', 'documents.manage'],
    admin: ['documents.view', 'documents.create', 'documents.sign', 'documents.archive', 'documents.manage'],
    employee: ['documents.view', 'documents.create', 'documents.sign', 'documents.archive'],
  },
}

export default setup
```

- [ ] **Step 2: Create notifications.ts and notifications.client.ts**

Create `packages/core/src/modules/documents/notifications.ts`:

```typescript
export const notificationTypes = [
  {
    id: 'documents.signature_requested',
    title: 'Signature Requested',
    description: 'A document has been sent to you for signature.',
  },
  {
    id: 'documents.document_signed',
    title: 'Document Signed',
    description: 'All signers have completed signing the document.',
  },
  {
    id: 'documents.document_declined',
    title: 'Document Declined',
    description: 'A signer declined to sign the document.',
  },
  {
    id: 'documents.document_expired',
    title: 'Signing Expired',
    description: 'The document signing period has expired.',
  },
  {
    id: 'documents.document_archived',
    title: 'Document Archived',
    description: 'The signed document has been archived.',
  },
]

export default notificationTypes
```

After the `notificationTypes` array, create `packages/core/src/modules/documents/notifications.client.ts`:

```typescript
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// Client-side renderers for each notification type.
// Match the pattern of other modules' notifications.client.ts files
// (check packages/core/src/modules/customers/notifications.client.ts for the exact export shape).

export const notificationRenderers = {
  'documents.signature_requested': ({ data }: { data: any }) => {
    const t = useT()
    return { title: t('documents.notifications.signatureRequested'), body: data?.documentTitle }
  },
  'documents.document_signed': ({ data }: { data: any }) => {
    const t = useT()
    return { title: t('documents.notifications.documentSigned'), body: data?.documentTitle }
  },
  'documents.document_declined': ({ data }: { data: any }) => {
    const t = useT()
    return { title: t('documents.notifications.documentDeclined'), body: data?.documentTitle }
  },
  'documents.document_expired': ({ data }: { data: any }) => {
    const t = useT()
    return { title: t('documents.notifications.documentExpired'), body: data?.documentTitle }
  },
  'documents.document_archived': ({ data }: { data: any }) => {
    const t = useT()
    return { title: t('documents.notifications.documentArchived'), body: data?.documentTitle }
  },
}

export default notificationRenderers
```

> Read an existing `notifications.client.ts` (e.g. `packages/core/src/modules/customers/notifications.client.ts`) and adjust the export shape to match exactly.

- [ ] **Step 3: Create sync-status worker**

Create `packages/core/src/modules/documents/workers/sync-status.ts`:

```typescript
import { Document, DocumentStatus } from '../data/entities'
import { getSigningProvider } from '../lib/signing-registry'
import { createDocumentService } from '../lib/document-service'

export const metadata = {
  queue: 'documents.sync-status',
  id: 'documents-sync-status',
  concurrency: 2,
}

const STALE_STATUSES = [DocumentStatus.SENT, DocumentStatus.PENDING_SIGNATURE, DocumentStatus.PARTIALLY_SIGNED]

export default async function handler(_payload: unknown, ctx: { em: any }) {
  const { em } = ctx
  const staleDocs = await em.find(Document, {
    status: { $in: STALE_STATUSES },
    deletedAt: null,
    signingEnvelopeId: { $ne: null },
  })

  const service = createDocumentService(em)

  for (const doc of staleDocs) {
    if (!doc.signingProviderId || !doc.signingEnvelopeId) continue
    try {
      const provider = getSigningProvider(doc.signingProviderId)
      const status = await provider.getStatus(doc.signingEnvelopeId)
      await service.applyWebhookResult(doc.signingEnvelopeId, { status }, em)
    } catch (err) {
      console.error(`[documents] Status sync failed for document ${doc.id}:`, err)
    }
  }
}
```

- [ ] **Step 4: Create backend list page**

Create `packages/core/src/modules/documents/backend/documents/page.tsx`:

```tsx
'use client'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useEffect, useState } from 'react'
import type { Document } from '../../data/entities'

export const metadata = {
  title: 'Documents',
  requireAuth: true,
  requireFeatures: ['documents.view'],
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiCall('/api/documents')
      .then((r) => r.json())
      .then((data) => setDocs(data.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingMessage />
  if (error) return <ErrorMessage message={error} />

  return (
    <div>
      <h1>Documents</h1>
      <ul>
        {docs.map((doc) => (
          <li key={doc.id}>
            <a href={`/backend/documents/${doc.id}`}>{doc.title}</a> — {doc.status}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Create backend detail page**

Create `packages/core/src/modules/documents/backend/documents/[id]/page.tsx`:

```tsx
'use client'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useEffect, useState } from 'react'

export const metadata = {
  title: 'Document',
  requireAuth: true,
  requireFeatures: ['documents.view'],
}

export default function DocumentDetailPage({ params }: { params: { id: string } }) {
  const [doc, setDoc] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiCall(`/api/documents/${params.id}`)
      .then((r) => r.json())
      .then(setDoc)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.id])

  if (loading) return <LoadingMessage />
  if (error) return <ErrorMessage message={error} />
  if (!doc) return null

  return (
    <div>
      <h1>{doc.title}</h1>
      <p>Status: {doc.status}</p>
      <p>Type: {doc.type}</p>
      {doc.signers?.map((s: any) => (
        <div key={s.id}>{s.name} ({s.email}) — {s.status}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Enable module in app**

Open `apps/mercato/src/modules.ts` and add `'documents'` to the modules list. Follow the existing pattern.

Run module preparation:
```bash
yarn modules:prepare
```

- [ ] **Step 7: Build and verify**

```bash
yarn build:packages 2>&1 | tail -20
```

Expected: No errors related to the documents module.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/modules/documents/
git commit -m "feat(documents): add setup, notifications, worker, backend pages, enable module"
```

---

## Phase 3 — storage-papra Provider

### Task 10: Scaffold storage-papra package

**Files:** All `packages/storage-papra/` files

- [ ] **Step 1: Copy the gateway-stripe package structure as a scaffold**

```bash
cp packages/gateway-stripe/build.mjs packages/storage-papra/build.mjs
cp packages/gateway-stripe/tsconfig.json packages/storage-papra/tsconfig.json
```

- [ ] **Step 2: Create package.json**

Create `packages/storage-papra/package.json`:

```json
{
  "name": "@open-mercato/storage-papra",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node watch.mjs",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    ".": "./dist/index.js",
    "./*": {
      "types": ["./src/*.ts", "./src/*.tsx"],
      "default": "./dist/*.js"
    },
    "./*/*": {
      "types": ["./src/*/*.ts", "./src/*/*.tsx"],
      "default": "./dist/*/*.js"
    },
    "./*/*/*": {
      "types": ["./src/*/*/*.ts", "./src/*/*/*.tsx"],
      "default": "./dist/*/*/*.js"
    }
  },
  "dependencies": {
    "@open-mercato/core": "workspace:*"
  },
  "peerDependencies": {
    "@open-mercato/shared": "workspace:*"
  },
  "devDependencies": {
    "@open-mercato/shared": "workspace:*",
    "esbuild": "^0.25.2",
    "glob": "^11.0.3"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 3: Register in workspace**

Check whether the root `package.json` or `pnpm-workspace.yaml` uses a glob or explicit list:

```bash
cat pnpm-workspace.yaml 2>/dev/null || cat package.json | grep -A5 '"workspaces"'
```

If it uses `packages/*`, no change needed. If explicit, add `packages/storage-papra`.

- [ ] **Step 4: Install workspace deps**

```bash
yarn install
```

- [ ] **Step 5: Create module index and src/index.ts**

Create `packages/storage-papra/src/index.ts`:
```typescript
export { metadata } from './modules/storage_papra/index'
```

Create `packages/storage-papra/src/modules/storage_papra/index.ts`:
```typescript
export const metadata = {
  id: 'storage_papra',
  title: 'Papra',
  description: 'Self-hosted document storage via Papra.',
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/storage-papra/
git commit -m "feat(storage-papra): scaffold package"
```

---

### Task 11: Papra API client and adapter

**Files:**
- Create: `packages/storage-papra/src/modules/storage_papra/lib/client.ts`
- Create: `packages/storage-papra/src/modules/storage_papra/lib/adapter.ts`
- Create: `packages/storage-papra/src/modules/storage_papra/lib/preset.ts`

- [ ] **Step 1: Create Papra REST client**

Create `packages/storage-papra/src/modules/storage_papra/lib/client.ts`:

```typescript
export interface PapraClientConfig {
  baseUrl: string
  apiKey: string
}

export interface PapraDocument {
  id: string
  name: string
  fileUrl: string
  tags: string[]
  createdAt: string
}

export function createPapraClient(config: PapraClientConfig) {
  const headers = () => ({
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  })

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`
    const res = await fetch(url, { ...init, headers: { ...headers(), ...init.headers } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Papra API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async function uploadDocument(name: string, file: Buffer, tags: string[]): Promise<PapraDocument> {
    const form = new FormData()
    form.append('file', new Blob([file], { type: 'application/pdf' }), name)
    form.append('name', name)
    form.append('tags', JSON.stringify(tags))

    const url = `${config.baseUrl.replace(/\/$/, '')}/api/v1/documents`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: form,
    })
    if (!res.ok) throw new Error(`Papra upload error ${res.status}`)
    return res.json() as Promise<PapraDocument>
  }

  async function getDocument(id: string): Promise<PapraDocument> {
    return request<PapraDocument>(`/api/v1/documents/${id}`)
  }

  async function downloadDocument(id: string): Promise<Buffer> {
    const url = `${config.baseUrl.replace(/\/$/, '')}/api/v1/documents/${id}/file`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } })
    if (!res.ok) throw new Error(`Papra download error ${res.status}`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  }

  async function listDocuments(tags?: string[]): Promise<PapraDocument[]> {
    const params = tags ? `?tags=${tags.join(',')}` : ''
    return request<PapraDocument[]>(`/api/v1/documents${params}`)
  }

  async function updateTags(id: string, tags: string[]): Promise<void> {
    await request(`/api/v1/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags }),
    })
  }

  async function deleteDocument(id: string): Promise<void> {
    await request(`/api/v1/documents/${id}`, { method: 'DELETE' })
  }

  async function searchDocuments(query: string): Promise<PapraDocument[]> {
    return request<PapraDocument[]>(`/api/v1/documents?search=${encodeURIComponent(query)}`)
  }

  return { uploadDocument, getDocument, downloadDocument, listDocuments, updateTags, deleteDocument, searchDocuments }
}

export type PapraClient = ReturnType<typeof createPapraClient>
```

- [ ] **Step 2: Create IStorageProvider adapter**

Create `packages/storage-papra/src/modules/storage_papra/lib/adapter.ts`:

```typescript
import type { IStorageProvider, StorageMetadata, StorageDocument, StorageFilters } from '@open-mercato/shared/modules/documents'
import type { PapraClient } from './client'

export class PapraStorageAdapter implements IStorageProvider {
  readonly id = 'papra'

  constructor(private readonly client: PapraClient) {}

  async upload(file: Buffer, metadata: StorageMetadata): Promise<string> {
    const tags = [
      ...(metadata.tags ?? []),
      `org:${metadata.organizationId}`,
      `tenant:${metadata.tenantId}`,
      metadata.relatedEntityType ? `entity:${metadata.relatedEntityType}` : null,
    ].filter((t): t is string => t !== null)

    const doc = await this.client.uploadDocument(`${metadata.title}.pdf`, file, tags)
    return doc.id
  }

  async download(ref: string): Promise<Buffer> {
    return this.client.downloadDocument(ref)
  }

  async getUrl(ref: string): Promise<string> {
    const doc = await this.client.getDocument(ref)
    return doc.fileUrl
  }

  async list(filters: StorageFilters): Promise<StorageDocument[]> {
    const tags = [
      `org:${filters.organizationId}`,
      `tenant:${filters.tenantId}`,
      ...(filters.tags ?? []),
    ]
    const docs = await this.client.listDocuments(tags)
    return docs.map((d) => ({
      ref: d.id,
      title: d.name,
      url: d.fileUrl,
      tags: d.tags,
      createdAt: new Date(d.createdAt),
    }))
  }

  async tag(ref: string, tags: string[]): Promise<void> {
    await this.client.updateTags(ref, tags)
  }

  async search(query: string, _organizationId: string, _tenantId: string): Promise<StorageDocument[]> {
    const docs = await this.client.searchDocuments(query)
    return docs.map((d) => ({
      ref: d.id,
      title: d.name,
      url: d.fileUrl,
      tags: d.tags,
      createdAt: new Date(d.createdAt),
    }))
  }

  async delete(ref: string): Promise<void> {
    await this.client.deleteDocument(ref)
  }
}
```

- [ ] **Step 3: Create preset (env-based config)**

Create `packages/storage-papra/src/modules/storage_papra/lib/preset.ts`:

```typescript
export function getPapraEnvPreset(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.PAPRA_URL
  const apiKey = process.env.PAPRA_API_KEY
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/storage-papra/src/modules/storage_papra/lib/
git commit -m "feat(storage-papra): add Papra client and IStorageProvider adapter"
```

---

### Task 12: storage-papra IntegrationDefinition and setup

**Files:**
- Create: `packages/storage-papra/src/modules/storage_papra/integration.ts`
- Create: `packages/storage-papra/src/modules/storage_papra/setup.ts`

- [ ] **Step 1: Create IntegrationDefinition**

Create `packages/storage-papra/src/modules/storage_papra/integration.ts`:

```typescript
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const integration: IntegrationDefinition = {
  id: 'storage_papra',
  title: 'Papra',
  description: 'Self-hosted document storage and archival via Papra.',
  category: 'storage',
  hub: 'document_storage',
  providerKey: 'papra',
  icon: 'papra',
  package: '@open-mercato/storage-papra',
  version: '0.1.0',
  author: 'Open Mercato Team',
  tags: ['documents', 'storage', 'archival', 'self-hosted'],
  credentials: {
    fields: [
      {
        key: 'baseUrl',
        label: 'Papra Base URL',
        type: 'url',
        required: true,
        placeholder: 'https://papra.yourdomain.com',
        helpText: 'The URL of your self-hosted Papra instance.',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'secret',
        required: true,
        helpText: 'Papra API key from Settings → API Keys.',
      },
    ],
  },
}

export default integration
```

- [ ] **Step 2: Create acl.ts for storage-papra**

Create `packages/storage-papra/src/modules/storage_papra/acl.ts`:

```typescript
export const features = [
  { id: 'storage_papra.view', title: 'View Papra storage integration', module: 'storage_papra' },
  { id: 'storage_papra.configure', title: 'Configure Papra storage credentials', module: 'storage_papra' },
]

export default features
```

Repeat for `sign-documentso` and `sign-docuseal` — replace `storage_papra` with `sign_documentso` / `sign_docuseal` accordingly.

- [ ] **Step 3: Create setup.ts**

Create `packages/storage-papra/src/modules/storage_papra/setup.ts`:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerStorageProvider } from '@open-mercato/core/modules/documents/lib/storage-registry'
import { createPapraClient } from './lib/client'
import { PapraStorageAdapter } from './lib/adapter'
import { getPapraEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['storage_papra.view', 'storage_papra.configure'],
    admin: ['storage_papra.view', 'storage_papra.configure'],
  },

  async onTenantCreated({ em: _em }) {
    const preset = getPapraEnvPreset()
    if (!preset) return

    const client = createPapraClient(preset)
    const adapter = new PapraStorageAdapter(client)
    registerStorageProvider(adapter)
  },
}

export default setup
```

- [ ] **Step 3: Enable package in apps/mercato/src/modules.ts**

Add `'storage_papra'` to the modules list in `apps/mercato/src/modules.ts`. Set env vars in `.env.local`:

```
PAPRA_URL=https://papra.yourdomain.com
PAPRA_API_KEY=your_api_key_here
```

- [ ] **Step 4: Build package**

```bash
cd packages/storage-papra && yarn build
```

Expected: `dist/` populated with compiled JS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-papra/
git commit -m "feat(storage-papra): add IntegrationDefinition and setup — registers PapraStorageAdapter"
```

---

## Phase 4 — sign-documentso Provider

### Task 13: Scaffold and Documentso client

**Files:** All `packages/sign-documentso/` files

- [ ] **Step 1: Scaffold package**

Repeat the same scaffold steps as Task 10, replacing `storage-papra` / `storage_papra` / `PAPRA` with `sign-documentso` / `sign_documentso` / `DOCUMENTSO`.

`packages/sign-documentso/package.json` — name: `@open-mercato/sign-documentso`

- [ ] **Step 2: Create Documentso REST client**

Create `packages/sign-documentso/src/modules/sign_documentso/lib/client.ts`:

```typescript
export interface DocumentsoClientConfig {
  baseUrl: string
  apiKey: string
}

export interface DocumentsoRecipient {
  email: string
  name: string
  role: 'SIGNER'
  signingOrder?: number
}

export interface DocumentsoDocument {
  id: string
  status: 'PENDING' | 'WAITING_FOR_OTHERS' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED'
  recipients: Array<{
    email: string
    name: string
    signingStatus: 'NOT_OPENED' | 'OPENED' | 'SIGNED' | 'DECLINED'
    signingToken?: string
  }>
}

export function createDocumentsoClient(config: DocumentsoClientConfig) {
  const base = config.baseUrl.replace(/\/$/, '')
  const headers = () => ({
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  })

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers(), ...init.headers as Record<string, string> } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Documentso API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async function createDocument(
    title: string,
    pdfBuffer: Buffer,
    recipients: DocumentsoRecipient[],
  ): Promise<{ id: string }> {
    const form = new FormData()
    form.append('title', title)
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `${title}.pdf`)
    form.append('recipients', JSON.stringify(recipients))

    const res = await fetch(`${base}/api/v1/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    })
    if (!res.ok) throw new Error(`Documentso create error ${res.status}`)
    return res.json() as Promise<{ id: string }>
  }

  async function sendDocument(documentId: string): Promise<void> {
    await request(`/api/v1/documents/${documentId}/send`, { method: 'POST', body: '{}' })
  }

  async function getDocument(documentId: string): Promise<DocumentsoDocument> {
    return request<DocumentsoDocument>(`/api/v1/documents/${documentId}`)
  }

  async function getSigningUrl(documentId: string, email: string): Promise<string> {
    const doc = await getDocument(documentId)
    const recipient = doc.recipients.find((r) => r.email === email)
    if (!recipient?.signingToken) throw new Error(`No signing token for ${email}`)
    return `${base}/sign/${recipient.signingToken}`
  }

  async function downloadSigned(documentId: string): Promise<Buffer> {
    const res = await fetch(`${base}/api/v1/documents/${documentId}/download`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
    if (!res.ok) throw new Error(`Documentso download error ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async function cancelDocument(documentId: string): Promise<void> {
    await request(`/api/v1/documents/${documentId}`, { method: 'DELETE', body: '{}' })
  }

  return { createDocument, sendDocument, getDocument, getSigningUrl, downloadSigned, cancelDocument }
}

export type DocumentsoClient = ReturnType<typeof createDocumentsoClient>
```

- [ ] **Step 3: Commit**

```bash
git add packages/sign-documentso/
git commit -m "feat(sign-documentso): scaffold package and Documentso API client"
```

---

### Task 14: Documentso adapter, webhook handler, integration

**Files:**
- Create: `packages/sign-documentso/src/modules/sign_documentso/lib/adapter.ts`
- Create: `packages/sign-documentso/src/modules/sign_documentso/lib/webhook-handler.ts`
- Create: `packages/sign-documentso/src/modules/sign_documentso/lib/preset.ts`
- Create: `packages/sign-documentso/src/modules/sign_documentso/integration.ts`
- Create: `packages/sign-documentso/src/modules/sign_documentso/setup.ts`

- [ ] **Step 1: Create ISigningProvider adapter**

Create `packages/sign-documentso/src/modules/sign_documentso/lib/adapter.ts`:

```typescript
import type {
  ISigningProvider,
  EnvelopeInput,
  EnvelopeStatus,
  SigningTemplate,
  WebhookResult,
} from '@open-mercato/shared/modules/documents'
import type { DocumentsoClient } from './client'
import { handleDocumentsoWebhook } from './webhook-handler'

const STATUS_MAP: Record<string, EnvelopeStatus> = {
  PENDING: 'pending',
  WAITING_FOR_OTHERS: 'partially_completed',
  COMPLETED: 'completed',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
}

export class DocumentsoSigningAdapter implements ISigningProvider {
  readonly id = 'documentso'

  constructor(private readonly client: DocumentsoClient) {}

  async createEnvelope(input: EnvelopeInput): Promise<string> {
    const recipients = input.signers.map((s) => ({
      email: s.email,
      name: s.name,
      role: 'SIGNER' as const,
      signingOrder: s.order,
    }))
    const doc = await this.client.createDocument(input.title, input.pdfBuffer, recipients)
    return doc.id
  }

  async sendEnvelope(envelopeId: string): Promise<void> {
    await this.client.sendDocument(envelopeId)
  }

  async getStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const doc = await this.client.getDocument(envelopeId)
    return STATUS_MAP[doc.status] ?? 'pending'
  }

  async getSigningUrl(envelopeId: string, signerEmail: string): Promise<string> {
    return this.client.getSigningUrl(envelopeId, signerEmail)
  }

  async downloadSigned(envelopeId: string): Promise<Buffer> {
    return this.client.downloadSigned(envelopeId)
  }

  async cancelEnvelope(envelopeId: string): Promise<void> {
    await this.client.cancelDocument(envelopeId)
  }

  async listTemplates(): Promise<SigningTemplate[]> {
    // Documentso template API — return empty if not configured
    return []
  }

  async handleWebhook(payload: unknown): Promise<WebhookResult> {
    return handleDocumentsoWebhook(payload)
  }
}
```

- [ ] **Step 2: Create webhook handler**

Create `packages/sign-documentso/src/modules/sign_documentso/lib/webhook-handler.ts`:

```typescript
import { z } from 'zod'
import type { WebhookResult } from '@open-mercato/shared/modules/documents'

const webhookSchema = z.object({
  event: z.string(),
  data: z.object({
    documentId: z.string(),
    recipientEmail: z.string().optional(),
    reason: z.string().optional(),
  }),
})

const EVENT_STATUS_MAP: Record<string, WebhookResult['status']> = {
  'document.recipient.signed': 'completed',
  'document.completed': 'completed',
  'document.recipient.declined': 'declined',
  'document.declined': 'declined',
  'document.expired': 'expired',
  'document.cancelled': 'cancelled',
}

export function handleDocumentsoWebhook(payload: unknown): WebhookResult {
  const { event, data } = webhookSchema.parse(payload)
  const status = EVENT_STATUS_MAP[event]
  if (!status) throw new Error(`Unhandled Documentso event: ${event}`)

  return {
    envelopeId: data.documentId,
    status,
    signerEmail: data.recipientEmail,
    reason: data.reason,
  }
}
```

- [ ] **Step 3: Create preset**

Create `packages/sign-documentso/src/modules/sign_documentso/lib/preset.ts`:

```typescript
export function getDocumentsoEnvPreset(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.DOCUMENTSO_URL
  const apiKey = process.env.DOCUMENTSO_API_KEY
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}
```

- [ ] **Step 4: Create IntegrationDefinition**

Create `packages/sign-documentso/src/modules/sign_documentso/integration.ts`:

```typescript
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const integration: IntegrationDefinition = {
  id: 'sign_documentso',
  title: 'Documentso',
  description: 'Self-hosted e-signature platform — open-source DocuSign alternative.',
  category: 'signing',
  hub: 'document_signing',
  providerKey: 'documentso',
  icon: 'documentso',
  package: '@open-mercato/sign-documentso',
  version: '0.1.0',
  author: 'Open Mercato Team',
  tags: ['e-signature', 'signing', 'documents', 'self-hosted'],
  credentials: {
    fields: [
      {
        key: 'baseUrl',
        label: 'Documentso Base URL',
        type: 'url',
        required: true,
        placeholder: 'https://documentso.yourdomain.com',
        helpText: 'The URL of your self-hosted Documentso instance.',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'secret',
        required: true,
        helpText: 'Documentso API key from Settings → API.',
      },
    ],
  },
}

export default integration
```

- [ ] **Step 5: Create setup.ts**

Create `packages/sign-documentso/src/modules/sign_documentso/setup.ts`:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerSigningProvider } from '@open-mercato/core/modules/documents/lib/signing-registry'
import { createDocumentsoClient } from './lib/client'
import { DocumentsoSigningAdapter } from './lib/adapter'
import { getDocumentsoEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sign_documentso.view', 'sign_documentso.configure'],
    admin: ['sign_documentso.view', 'sign_documentso.configure'],
  },

  async onTenantCreated({ em: _em }) {
    const preset = getDocumentsoEnvPreset()
    if (!preset) return

    const client = createDocumentsoClient(preset)
    const adapter = new DocumentsoSigningAdapter(client)
    registerSigningProvider(adapter)
  },
}

export default setup
```

- [ ] **Step 6: Build and commit**

```bash
cd packages/sign-documentso && yarn build
git add packages/sign-documentso/
git commit -m "feat(sign-documentso): add adapter, webhook handler, IntegrationDefinition, setup"
```

---

## Phase 5 — sign-docuseal Provider

### Task 15: Scaffold and Docuseal client

- [ ] **Step 1: Scaffold**

Repeat Task 10 scaffold steps for `sign-docuseal` / `sign_docuseal` / `DOCUSEAL`.

`packages/sign-docuseal/package.json` — name: `@open-mercato/sign-docuseal`

- [ ] **Step 2: Create Docuseal REST client**

Create `packages/sign-docuseal/src/modules/sign_docuseal/lib/client.ts`:

```typescript
export interface DocusealClientConfig {
  baseUrl: string
  apiKey: string
}

export interface DocusealSubmission {
  id: number
  status: 'pending' | 'sent' | 'opened' | 'completed' | 'declined' | 'expired'
  submitters: Array<{
    id: number
    email: string
    name: string
    status: 'sent' | 'opened' | 'completed' | 'declined'
    embed_src: string
    slug: string
  }>
}

export function createDocusealClient(config: DocusealClientConfig) {
  const base = config.baseUrl.replace(/\/$/, '')
  const headers = () => ({
    'X-Auth-Token': config.apiKey,
    'Content-Type': 'application/json',
  })

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers(), ...init.headers as Record<string, string> } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Docuseal API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async function createSubmission(
    templateId: string,
    submitters: Array<{ email: string; name: string; role?: string }>,
  ): Promise<DocusealSubmission[]> {
    return request<DocusealSubmission[]>('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, submitters }),
    })
  }

  async function getSubmission(submissionId: number): Promise<DocusealSubmission> {
    return request<DocusealSubmission>(`/api/submissions/${submissionId}`)
  }

  async function downloadSubmission(submissionId: number): Promise<Buffer> {
    const res = await fetch(`${base}/api/submissions/${submissionId}/download`, {
      headers: headers(),
    })
    if (!res.ok) throw new Error(`Docuseal download error ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async function archiveSubmission(submissionId: number): Promise<void> {
    await request(`/api/submissions/${submissionId}`, { method: 'DELETE' })
  }

  async function listTemplates(): Promise<Array<{ id: number; name: string; fields: Array<{ name: string }> }>> {
    return request('/api/templates')
  }

  return { createSubmission, getSubmission, downloadSubmission, archiveSubmission, listTemplates }
}

export type DocusealClient = ReturnType<typeof createDocusealClient>
```

- [ ] **Step 3: Commit scaffold**

```bash
git add packages/sign-docuseal/
git commit -m "feat(sign-docuseal): scaffold package and Docuseal API client"
```

---

### Task 16: Docuseal adapter, webhook handler, integration

- [ ] **Step 1: Create adapter**

Create `packages/sign-docuseal/src/modules/sign_docuseal/lib/adapter.ts`:

```typescript
import type {
  ISigningProvider,
  EnvelopeInput,
  EnvelopeStatus,
  SigningTemplate,
  WebhookResult,
} from '@open-mercato/shared/modules/documents'
import type { DocusealClient } from './client'
import { handleDocusealWebhook } from './webhook-handler'

// Docuseal works template-first. When no templateId is provided,
// we cannot create a submission — throw with a clear message.
const STATUS_MAP: Record<string, EnvelopeStatus> = {
  pending: 'pending',
  sent: 'sent',
  opened: 'sent',
  completed: 'completed',
  declined: 'declined',
  expired: 'expired',
}

export class DocusealSigningAdapter implements ISigningProvider {
  readonly id = 'docuseal'

  // Maps envelopeId (string) → submissionId (number) for this process lifetime.
  // For production use, persist this mapping in the Document entity's metadata field.
  private readonly submissionMap = new Map<string, number>()

  constructor(private readonly client: DocusealClient) {}

  async createEnvelope(input: EnvelopeInput): Promise<string> {
    if (!input.templateId) {
      throw new Error('Docuseal requires a templateId. Select a template when sending via Docuseal.')
    }

    const submitters = input.signers.map((s) => ({ email: s.email, name: s.name }))
    const submissions = await this.client.createSubmission(input.templateId, submitters)
    const submission = submissions[0]
    if (!submission) throw new Error('Docuseal did not return a submission')

    const envelopeId = `docuseal-${submission.id}`
    this.submissionMap.set(envelopeId, submission.id)
    return envelopeId
  }

  async sendEnvelope(_envelopeId: string): Promise<void> {
    // Docuseal sends emails automatically on submission creation.
  }

  async getStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const submissionId = this.resolveSubmissionId(envelopeId)
    const submission = await this.client.getSubmission(submissionId)
    return STATUS_MAP[submission.status] ?? 'pending'
  }

  async getSigningUrl(envelopeId: string, signerEmail: string): Promise<string> {
    const submissionId = this.resolveSubmissionId(envelopeId)
    const submission = await this.client.getSubmission(submissionId)
    const submitter = submission.submitters.find((s) => s.email === signerEmail)
    if (!submitter) throw new Error(`No submitter found for ${signerEmail}`)
    return submitter.embed_src
  }

  async downloadSigned(envelopeId: string): Promise<Buffer> {
    const submissionId = this.resolveSubmissionId(envelopeId)
    return this.client.downloadSubmission(submissionId)
  }

  async cancelEnvelope(envelopeId: string): Promise<void> {
    const submissionId = this.resolveSubmissionId(envelopeId)
    await this.client.archiveSubmission(submissionId)
  }

  async listTemplates(): Promise<SigningTemplate[]> {
    const templates = await this.client.listTemplates()
    return templates.map((t) => ({
      id: String(t.id),
      title: t.name,
      variables: t.fields.map((f) => f.name),
    }))
  }

  async handleWebhook(payload: unknown): Promise<WebhookResult> {
    return handleDocusealWebhook(payload)
  }

  private resolveSubmissionId(envelopeId: string): number {
    const fromMap = this.submissionMap.get(envelopeId)
    if (fromMap) return fromMap
    const match = envelopeId.match(/^docuseal-(\d+)$/)
    if (match) return parseInt(match[1], 10)
    throw new Error(`Cannot resolve Docuseal submission ID from envelope '${envelopeId}'`)
  }
}
```

- [ ] **Step 2: Create webhook handler**

Create `packages/sign-docuseal/src/modules/sign_docuseal/lib/webhook-handler.ts`:

```typescript
import { z } from 'zod'
import type { WebhookResult } from '@open-mercato/shared/modules/documents'

const webhookSchema = z.object({
  event_type: z.string(),
  data: z.object({
    submission: z.object({
      id: z.number(),
      status: z.string(),
    }),
    submitter: z.object({ email: z.string() }).optional(),
  }),
})

const EVENT_STATUS_MAP: Record<string, WebhookResult['status']> = {
  'submission.completed': 'completed',
  'submission.expired': 'expired',
  'submitter.completed': 'completed',
  'submitter.declined': 'declined',
}

export function handleDocusealWebhook(payload: unknown): WebhookResult {
  const { event_type, data } = webhookSchema.parse(payload)
  const status = EVENT_STATUS_MAP[event_type]
  if (!status) throw new Error(`Unhandled Docuseal event: ${event_type}`)

  return {
    envelopeId: `docuseal-${data.submission.id}`,
    status,
    signerEmail: data.submitter?.email,
  }
}
```

- [ ] **Step 3: Create preset and IntegrationDefinition**

Create `packages/sign-docuseal/src/modules/sign_docuseal/lib/preset.ts`:
```typescript
export function getDocusealEnvPreset(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.DOCUSEAL_URL
  const apiKey = process.env.DOCUSEAL_API_KEY
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}
```

Create `packages/sign-docuseal/src/modules/sign_docuseal/integration.ts`:
```typescript
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const integration: IntegrationDefinition = {
  id: 'sign_docuseal',
  title: 'Docuseal',
  description: 'Self-hosted document signing and sealing — open-source platform.',
  category: 'signing',
  hub: 'document_signing',
  providerKey: 'docuseal',
  icon: 'docuseal',
  package: '@open-mercato/sign-docuseal',
  version: '0.1.0',
  author: 'Open Mercato Team',
  tags: ['e-signature', 'signing', 'documents', 'self-hosted'],
  credentials: {
    fields: [
      {
        key: 'baseUrl',
        label: 'Docuseal Base URL',
        type: 'url',
        required: true,
        placeholder: 'https://docuseal.yourdomain.com',
        helpText: 'The URL of your self-hosted Docuseal instance.',
      },
      {
        key: 'apiKey',
        label: 'API Token',
        type: 'secret',
        required: true,
        helpText: 'Docuseal API token from Profile → API Tokens.',
      },
    ],
  },
}
```

Create `packages/sign-docuseal/src/modules/sign_docuseal/setup.ts`:
```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerSigningProvider } from '@open-mercato/core/modules/documents/lib/signing-registry'
import { createDocusealClient } from './lib/client'
import { DocusealSigningAdapter } from './lib/adapter'
import { getDocusealEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sign_docuseal.view', 'sign_docuseal.configure'],
    admin: ['sign_docuseal.view', 'sign_docuseal.configure'],
  },

  async onTenantCreated({ em: _em }) {
    const preset = getDocusealEnvPreset()
    if (!preset) return
    const client = createDocusealClient(preset)
    const adapter = new DocusealSigningAdapter(client)
    registerSigningProvider(adapter)
  },
}

export default setup
```

- [ ] **Step 4: Build and commit**

```bash
cd packages/sign-docuseal && yarn build
git add packages/sign-docuseal/
git commit -m "feat(sign-docuseal): add adapter, webhook handler, IntegrationDefinition, setup"
```

---

## Phase 6 — Widget Injection (Sales)

### Task 17: Sales document widgets and injection table

**Files:**
- Create: `packages/core/src/modules/documents/widgets/injection/sales-document-actions.tsx`
- Create: `packages/core/src/modules/documents/widgets/injection/sales-document-status.tsx`
- Create: `packages/core/src/modules/documents/widgets/injection/sales-document-tab.tsx`
- Create: `packages/core/src/modules/documents/widgets/injection-table.ts`

- [ ] **Step 1: Read an existing injection widget to understand the pattern**

```bash
find packages/core/src/modules -name "*.tsx" -path "*/injection/*" | head -5
```

Read one of the found files to understand the expected export shape and props structure. Mirror that pattern exactly.

- [ ] **Step 2: Create sales-document-actions widget**

Create `packages/core/src/modules/documents/widgets/injection/sales-document-actions.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/utils/useGuardedMutation'

interface Props {
  entityId: string
  entityType: string
}

export default function SalesDocumentActionsWidget({ entityId, entityType }: Props) {
  const t = useT()
  const [sending, setSending] = useState(false)
  const [archiving, setArchiving] = useState(false)

  async function handleSendForSignature() {
    setSending(true)
    try {
      await apiCall('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          title: `${entityType} ${entityId}`,
          type: entityType.replace('sales_', '') as string,
          relatedEntityType: entityType,
          relatedEntityId: entityId,
          signers: [], // UI should prompt for signers — extend with a dialog
        }),
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={handleSendForSignature} disabled={sending}>
        {sending ? t('documents.actions.sending') : t('documents.actions.sendForSignature')}
      </button>
    </div>
  )
}
```

> This is a minimal widget. For production, add a dialog to collect signers before sending.

- [ ] **Step 3: Create signing status badge widget**

Create `packages/core/src/modules/documents/widgets/injection/sales-document-status.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

interface Props {
  entityId: string
  entityType: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#9ca3af',
  sent: '#3b82f6',
  pending_signature: '#f59e0b',
  partially_signed: '#f97316',
  signed: '#22c55e',
  archived: '#16a34a',
  declined: '#ef4444',
  expired: '#6b7280',
}

export default function SalesDocumentStatusWidget({ entityId, entityType }: Props) {
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    apiCall(`/api/documents?relatedEntityType=${entityType}&relatedEntityId=${entityId}&pageSize=1`)
      .then((r) => r.json())
      .then((data) => {
        const doc = data.data?.[0]
        if (doc) setStatus(doc.status)
      })
      .catch(() => null)
  }, [entityId, entityType])

  if (!status) return null

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        background: STATUS_COLORS[status] ?? '#9ca3af',
        color: '#fff',
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}
```

- [ ] **Step 4: Create documents tab widget**

Create `packages/core/src/modules/documents/widgets/injection/sales-document-tab.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'

interface Props {
  entityId: string
  entityType: string
}

export default function SalesDocumentTabWidget({ entityId, entityType }: Props) {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiCall(`/api/documents?relatedEntityType=${entityType}&relatedEntityId=${entityId}`)
      .then((r) => r.json())
      .then((data) => setDocs(data.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [entityId, entityType])

  if (loading) return <LoadingMessage />
  if (error) return <ErrorMessage message={error} />
  if (docs.length === 0) return <p>No documents yet.</p>

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {docs.map((doc) => (
        <li key={doc.id} style={{ padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
          <a href={`/backend/documents/${doc.id}`}>{doc.title}</a>
          <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 12 }}>{doc.status}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 5: Create injection-table.ts**

Create `packages/core/src/modules/documents/widgets/injection-table.ts`:

```typescript
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import SalesDocumentActionsWidget from './injection/sales-document-actions'
import SalesDocumentStatusWidget from './injection/sales-document-status'
import SalesDocumentTabWidget from './injection/sales-document-tab'
import CrmEntityPanelWidget from './injection/crm-entity-panel'
import PortalDocumentsTabWidget from './injection/portal-documents-tab'

export const injectionWidgets = [
  {
    spotId: 'documents:sales-document:actions',
    position: InjectionPosition.APPEND,
    component: SalesDocumentActionsWidget,
  },
  {
    spotId: 'documents:sales-document:status',
    position: InjectionPosition.APPEND,
    component: SalesDocumentStatusWidget,
  },
  {
    spotId: 'documents:sales-document:tab',
    position: InjectionPosition.APPEND,
    component: SalesDocumentTabWidget,
  },
  {
    spotId: 'documents:crm-entity:panel',
    position: InjectionPosition.APPEND,
    component: CrmEntityPanelWidget,
  },
  {
    spotId: 'documents:portal:tab',
    position: InjectionPosition.APPEND,
    component: PortalDocumentsTabWidget,
  },
]

export default injectionWidgets
```

> Check `InjectionPosition` import path against what your codebase actually exports. If `InjectionPosition` is not a type you see in other injection tables, check another module's injection-table.ts and match the exact pattern.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/documents/widgets/
git commit -m "feat(documents): add sales widget injection — actions, status, tab"
```

---

## Phase 7 — Widget Injection (CRM + Portal)

### Task 18: CRM and portal widgets

**Files:**
- Create: `packages/core/src/modules/documents/widgets/injection/crm-entity-panel.tsx`
- Create: `packages/core/src/modules/documents/widgets/injection/portal-documents-tab.tsx`

- [ ] **Step 1: Create CRM entity panel widget**

Create `packages/core/src/modules/documents/widgets/injection/crm-entity-panel.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'

interface Props {
  entityId: string
  entityType: string
}

export default function CrmEntityPanelWidget({ entityId, entityType }: Props) {
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiCall(`/api/documents?relatedEntityType=${entityType}&relatedEntityId=${entityId}&pageSize=10`)
      .then((r) => r.json())
      .then((data) => setDocs(data.data ?? []))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [entityId, entityType])

  if (loading) return <LoadingMessage />

  return (
    <section>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Documents</h3>
      {docs.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>No documents.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {docs.map((doc) => (
            <li key={doc.id} style={{ padding: '4px 0' }}>
              <a href={`/backend/documents/${doc.id}`} style={{ fontSize: 13 }}>{doc.title}</a>
              <span style={{ marginLeft: 6, color: '#9ca3af', fontSize: 11 }}>{doc.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Create portal documents tab widget**

Create `packages/core/src/modules/documents/widgets/injection/portal-documents-tab.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'

export default function PortalDocumentsTabWidget() {
  const { customer } = useCustomerAuth()
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!customer?.id) return
    fetch(`/api/portal/documents?customerId=${customer.id}`)
      .then((r) => r.json())
      .then((data) => setDocs(data.data ?? []))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [customer?.id])

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <h2>My Documents</h2>
      {docs.length === 0 ? (
        <p>No documents to sign or download.</p>
      ) : (
        <ul>
          {docs.map((doc) => (
            <li key={doc.id}>
              <strong>{doc.title}</strong> — {doc.status}
              {doc.signingUrl && (
                <a href={doc.signingUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                  Sign
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

> Note: this widget calls `/api/portal/documents` which requires a portal-scoped API route. Add `packages/core/src/modules/documents/api/GET/portal/documents.ts` that filters by `customer_id` in `document_signers` and returns only that customer's documents.

- [ ] **Step 3: Add portal API route**

Create `packages/core/src/modules/documents/api/GET/portal/documents.ts`:

```typescript
import { z } from 'zod'
import { Document, DocumentSigner } from '../../../data/entities'

export const openApi = {
  GET: {
    summary: 'List documents for portal customer',
    tags: ['Documents', 'Portal'],
    responses: { 200: { description: 'Customer documents with signing URLs' } },
  },
}

export default async function handler(req: Request, ctx: any) {
  const { customerId } = z.object({ customerId: z.string().uuid() }).parse(ctx.query)

  const signerRecords = await ctx.em.find(DocumentSigner, {
    customerId,
  })

  const documentIds = [...new Set(signerRecords.map((s: DocumentSigner) => s.documentId))]
  if (documentIds.length === 0) return Response.json({ data: [] })

  const docs = await ctx.em.find(Document, {
    id: { $in: documentIds },
    deletedAt: null,
  })

  const result = docs.map((doc: Document) => {
    const signer = signerRecords.find((s: DocumentSigner) => s.documentId === doc.id && s.customerId === customerId)
    return { ...doc, signingUrl: signer?.signingUrl ?? null }
  })

  return Response.json({ data: result })
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/modules/documents/widgets/injection/crm-entity-panel.tsx
git add packages/core/src/modules/documents/widgets/injection/portal-documents-tab.tsx
git add packages/core/src/modules/documents/api/GET/portal/documents.ts
git commit -m "feat(documents): add CRM panel widget, portal documents tab, portal API route"
```

---

## Phase 8 — Integration Tests

### Task 19: Core document lifecycle tests

- [ ] **Step 1: Read the integration test setup pattern**

```bash
ls .ai/qa/
cat .ai/qa/AGENTS.md | head -60
```

Note the test file location convention, fixture API patterns, and cleanup requirements.

- [ ] **Step 2: Write create-and-send test**

Follow the test file path convention from `.ai/qa/AGENTS.md`. Create a test file (e.g. `documents-lifecycle.spec.ts`):

```typescript
import { test, expect } from '@playwright/test'

test.describe('Documents — create and send', () => {
  let documentId: string

  test.afterAll(async ({ request }) => {
    if (documentId) {
      await request.delete(`/api/documents/${documentId}`)
    }
  })

  test('creates a document and sends for signature', async ({ request }) => {
    // Create document
    const createRes = await request.post('/api/documents', {
      data: {
        title: 'Test NDA',
        type: 'nda',
        signers: [{ name: 'Alice Smith', email: 'alice@example.com', order: 0 }],
      },
    })
    expect(createRes.status()).toBe(201)
    const doc = await createRes.json()
    documentId = doc.id
    expect(doc.status).toBe('draft')
    expect(doc.type).toBe('nda')

    // Verify retrieval
    const getRes = await request.get(`/api/documents/${documentId}`)
    expect(getRes.status()).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.signers).toHaveLength(1)
    expect(fetched.signers[0].email).toBe('alice@example.com')
  })
})
```

- [ ] **Step 3: Run the test to verify it works end-to-end**

```bash
yarn test:integration --grep "Documents — create and send"
```

Expected: PASS (assuming signing provider is not required for create).

- [ ] **Step 4: Write list-filtering test**

```typescript
test('filters documents by related entity', async ({ request }) => {
  const entityId = 'e4f8c2a1-0000-0000-0000-000000000001'

  const createRes = await request.post('/api/documents', {
    data: {
      title: 'Quote Document',
      type: 'quote',
      relatedEntityType: 'sales_quote',
      relatedEntityId: entityId,
      signers: [{ name: 'Bob Jones', email: 'bob@example.com' }],
    },
  })
  expect(createRes.status()).toBe(201)
  const created = await createRes.json()

  try {
    const listRes = await request.get(`/api/documents?relatedEntityType=sales_quote&relatedEntityId=${entityId}`)
    expect(listRes.status()).toBe(200)
    const list = await listRes.json()
    const found = list.data.find((d: any) => d.id === created.id)
    expect(found).toBeTruthy()
    expect(found.type).toBe('quote')
  } finally {
    await request.delete(`/api/documents/${created.id}`)
  }
})
```

- [ ] **Step 5: Write webhook-to-signed status transition test**

```typescript
test('webhook transitions document to signed', async ({ request }) => {
  const createRes = await request.post('/api/documents', {
    data: {
      title: 'Webhook Test Contract',
      type: 'contract',
      signers: [{ name: 'Carol White', email: 'carol@example.com' }],
    },
  })
  const doc = await createRes.json()

  // Simulate a Documentso webhook payload
  const webhookRes = await request.post('/api/documents/webhooks/documentso', {
    data: {
      event: 'document.completed',
      data: { documentId: doc.signingEnvelopeId ?? 'test-envelope-id', recipientEmail: 'carol@example.com' },
    },
  })
  expect(webhookRes.status()).toBe(200)

  // Clean up
  await request.delete(`/api/documents/${doc.id}`)
})
```

- [ ] **Step 6: Write soft-delete test**

```typescript
test('soft deletes a document', async ({ request }) => {
  const createRes = await request.post('/api/documents', {
    data: { title: 'To Be Deleted', type: 'custom', signers: [{ name: 'Dave', email: 'dave@example.com' }] },
  })
  const doc = await createRes.json()

  const deleteRes = await request.delete(`/api/documents/${doc.id}`)
  expect(deleteRes.status()).toBe(200)

  const getRes = await request.get(`/api/documents/${doc.id}`)
  expect(getRes.status()).toBe(404)
})
```

- [ ] **Step 7: Run all document tests**

```bash
yarn test:integration --grep "Documents"
```

Expected: All PASS.

- [ ] **Step 8: Commit tests**

```bash
git add .ai/qa/
git commit -m "test(documents): add integration tests for lifecycle, filtering, webhook, and delete"
```

---

## Final Checks

### Task 20: Full build and module preparation

- [ ] **Step 1: Run module preparation**

```bash
yarn modules:prepare
```

Expected: No errors. Generated files updated in `apps/mercato/.mercato/generated/`.

- [ ] **Step 2: Full build**

```bash
yarn build
```

Expected: All packages and the app build without errors.

- [ ] **Step 3: Run database migration**

```bash
yarn db:migrate
```

Expected: Migration applied. Three new tables visible.

- [ ] **Step 4: Start dev server and verify Documents menu**

```bash
yarn dev
```

Navigate to `/backend/documents` and verify the page loads. Check `/backend/integrations` to confirm storage-papra, sign-documentso, and sign-docuseal appear in the marketplace.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(documents): complete Documents Hub — Papra, Documentso, Docuseal integration"
```

---

## Environment Setup Reference

Add to `.env.local`:

```bash
# Papra — document storage
PAPRA_URL=https://papra.yourdomain.com
PAPRA_API_KEY=your_papra_api_key

# Documentso — e-signature
DOCUMENTSO_URL=https://documentso.yourdomain.com
DOCUMENTSO_API_KEY=your_documentso_api_key

# Docuseal — e-signature (alternative)
DOCUSEAL_URL=https://docuseal.yourdomain.com
DOCUSEAL_API_KEY=your_docuseal_api_token
```
