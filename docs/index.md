---
layout: home

hero:
  name: Kavo
  text: Turn models into APIs
  tagline: Define an entity once and get a complete REST and GraphQL CRUD API with filtering, sorting, pagination, and generated routes.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/kavo-labs/kavo
---

<div class="before-after">
  <p class="before-after-lead">Stop writing repetitive CRUD endpoints.</p>
  <div class="before-after-col before-after-col--before">
    <div class="before-after-header before-after-header--before before-after-header--stacked">
      <div class="before-after-header-row">
        <span class="before-after-label-title"><span class="before-after-dot before-after-dot--before"></span>Without Kavo</span>
        <span class="before-after-count before-after-count--before">77 lines</span>
      </div>
      <p class="before-after-subtitle before-after-subtitle--before">No pagination, filtering, sorting, or field selection.</p>
    </div>

```ts
@Controller("books")
export class BooksController {
  constructor(private readonly repository: BookRepository) {}

  @Post()
  create(@Body() body: { title: string; author: string }) {
    return this.repository.create({
      data: {
        title: body.title,
        author: body.author,
      },
    });
  }

  @Get()
  findAll() {
    return this.repository.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        id: "desc",
      },
    });
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.repository.findOne({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  @Patch(":id")
  update(@Param("id", ParseIntPipe) id: number, @Body() body: { title?: string; author?: string }) {
    return this.repository.update({
      where: {
        id,
        deletedAt: null,
      },
      data: {
        title: body.title,
        author: body.author,
      },
    });
  }

  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.repository.delete({
      where: {
        id,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  @Patch(":id/restore")
  restore(@Param("id", ParseIntPipe) id: number) {
    return this.repository.restore({
      where: {
        id,
      },
      data: {
        deletedAt: null,
      },
    });
  }
}
```

  </div>
  <div class="before-after-col before-after-col--after">
    <div class="before-after-header before-after-header--after before-after-header--stacked">
      <div class="before-after-header-row">
        <span class="before-after-label-title"><span class="before-after-dot before-after-dot--after"></span>With Kavo</span>
        <span class="before-after-count before-after-count--after">3 lines</span>
      </div>
      <p class="before-after-subtitle before-after-subtitle--after">
        <strong>Pagination</strong>, <strong>filtering</strong>, <strong>sorting</strong>, <strong>field selection</strong>, and more — all included.
      </p>
    </div>

```ts
@Kavo(Book)
@Controller("books")
export class BooksController {}
```

  </div>
</div>

<style scoped>
.before-after {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin: 48px 0;
  align-items: start;
}

@media (max-width: 719px) {
  .before-after {
    grid-template-columns: 1fr;
  }
}

.before-after-lead {
  grid-column: 1 / -1;
  margin: 46px 0 4px;
  text-align: center;
  font-size: 15px;
  color: var(--vp-c-text-2);
}

.before-after-lead strong {
  color: var(--vp-c-text-1);
}

.before-after-col {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-code-block-bg);
}

.before-after-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.before-after-label-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  letter-spacing: -0.01em;
}

.before-after-header--after .before-after-label-title {
  color: var(--vp-c-text-1);
}

.before-after-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--vp-c-text-3);
}

.before-after-dot--after {
  background: var(--vp-c-brand-1);
}

.before-after-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.before-after-header--after .before-after-count {
  color: var(--vp-c-brand-1);
}

.before-after-header--stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.before-after-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.before-after-subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.before-after-subtitle--before {
  color: var(--vp-c-text-3);
}

.before-after-subtitle--after {
  color: var(--vp-c-text-2);
}

.before-after-subtitle--after strong {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.before-after-col :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 0;
}

.before-after-col :deep(button.copy) {
  display: none;
}

.before-after-col--after {
  justify-content: center;
}

.before-after-col--after :deep(div[class*='language-']) {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.before-after-col--before {
  position: relative;
  max-height: 320px;
  overflow: hidden;
}

.before-after-col--before::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 72px;
  background: linear-gradient(to bottom, transparent, var(--vp-code-block-bg));
}
</style>

<div class="ai-section">
  <p class="ai-title">Built for agentic development</p>
  <p class="ai-subtitle">Built with Claude Code, and shipped with skills so your agent moves just as fast.</p>
  <div class="ai-install">

```
/plugin marketplace add kavo-labs/kavo
/plugin install kavo-skills@kavo-marketplace
```

  <p class="ai-install-note">Fewer tokens, ship faster.</p>
  </div>
</div>

<style scoped>
.ai-section {
  margin: 64px 0;
  text-align: center;
}

.ai-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.ai-subtitle {
  margin: 0 0 28px;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.ai-install {
  max-width: 480px;
  margin: 24px auto 0;
  text-align: left;
}

.ai-install-note {
  margin: 10px 0 0;
  font-size: 13.5px;
  text-align: center;
  color: var(--vp-c-text-3);
}

.ai-install :deep(div[class*='language-']) {
  border-radius: 12px;
}
</style>

<div class="feature-section">
  <p class="feature-title">Everything a CRUD API needs</p>
  <p class="feature-subtitle">One decorator, the full surface — configurable at global, entity, operation, and per-call scope.</p>
  <div class="feature-grid">
    <div class="feature-item">
      <span class="feature-index">01</span>
      <span class="feature-name">Filtering</span>
      <span class="feature-desc">A full operator grammar — eq, gt, in, isNull, and more — parsed straight from the query string.</span>
    </div>
    <div class="feature-item">
      <span class="feature-index">02</span>
      <span class="feature-name">Sorting &amp; pagination</span>
      <span class="feature-desc">Multi-field sort and limit/offset paging with consistent envelope fields on every list route.</span>
    </div>
    <div class="feature-item">
      <span class="feature-index">03</span>
      <span class="feature-name">Nested includes</span>
      <span class="feature-desc">Pull related entities into the response with field-path recursion, capped for safety.</span>
    </div>
    <div class="feature-item">
      <span class="feature-index">04</span>
      <span class="feature-name">Field selection</span>
      <span class="feature-desc">Ask for exactly the fields you need and leave the rest off the wire.</span>
    </div>
    <div class="feature-item">
      <span class="feature-index">05</span>
      <span class="feature-name">Per-operation DTOs</span>
      <span class="feature-desc">Optional create, update, patch, query, item, and list shapes — derived or hand-written.</span>
    </div>
    <div class="feature-item">
      <span class="feature-index">06</span>
      <span class="feature-name">And more</span>
      <span class="feature-desc">Soft delete, transactions, problem-details errors, GraphQL binding, and the rest of the surface.</span>
    </div>
  </div>
</div>

<style scoped>
.feature-section {
  margin: 64px 0;
  text-align: center;
}

.feature-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.feature-subtitle {
  margin: 0 0 28px;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  max-width: 900px;
  margin: 0 auto;
  text-align: left;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-divider);
}

@media (max-width: 768px) {
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
}

.feature-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 22px 20px;
  background: var(--vp-c-bg-soft);
}

.feature-index {
  font-family: var(--vp-font-family-mono);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: var(--vp-c-brand-1);
  opacity: 0.5;
  margin-bottom: 4px;
}

.feature-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.feature-desc {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}
</style>

<div class="query-section">
  <p class="query-title">The query grammar, on the wire</p>
  <p class="query-subtitle">Filtering, sorting, pagination, and includes — all driven by the query string, no extra code.</p>
  <div class="query-demo">
    <div class="query-demo-col">
      <span class="query-demo-label">Request</span>

```http
GET /books
  ?filter[status][eq]=published
  &filter[publishedAt][gte]=2020-01-01
  &sort=-publishedAt
  &include=author
  &limit=2
```

  </div>
  <div class="query-demo-col">
    <span class="query-demo-label">Response</span>

```json
{
  "items": [
    {
      "id": 42,
      "title": "The Left Hand of Darkness",
      "status": "published",
      "author": { "id": 7, "name": "Ursula K. Le Guin" }
    },
    {
      "id": 41,
      "title": "Kindred",
      "status": "published",
      "author": { "id": 3, "name": "Octavia E. Butler" }
    }
  ],
  "limit": 2,
  "offset": 0,
  "total": 128
}
```

  </div>
  </div>
</div>

<style scoped>
.query-section {
  margin: 64px 0;
  text-align: center;
}

.query-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.query-subtitle {
  margin: 0 0 28px;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.query-demo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  max-width: 900px;
  margin: 0 auto;
  text-align: left;
  min-width: 0;
}

@media (max-width: 719px) {
  .query-demo {
    grid-template-columns: 1fr;
  }
}

.query-demo-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.query-demo-label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  padding-left: 2px;
}

.query-demo-col :deep(div[class*='language-']) {
  margin: 0;
  border-radius: 12px;
  flex: 1;
  min-width: 0;
}

.query-demo-col :deep(pre) {
  overflow-x: auto;
}

.query-demo-col :deep(button.copy) {
  display: none;
}
</style>

<div class="config-section">
  <p class="config-title">Customize it to fit your needs</p>
  <p class="config-subtitle">Every setting is optional at every scope — start with the defaults and override only where your app needs to differ.</p>
  <p class="config-scopes">
    <span>Global</span>
    <span class="config-sep">→</span>
    <span>Entity</span>
    <span class="config-sep">→</span>
    <span>Operation</span>
    <span class="config-sep">→</span>
    <span>Per-call</span>
  </p>
  <p class="config-note">No config at all still works — built-in defaults cover every setting until you decide to change one.</p>
</div>

<style scoped>
.config-section {
  margin: 64px 0;
  text-align: center;
}

.config-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.config-subtitle {
  margin: 0 0 28px;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.config-scopes {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 15px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.config-sep {
  color: var(--vp-c-text-3);
  font-size: 13px;
}

.config-note {
  margin: 24px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
}
</style>

<div class="layer-section">
  <p class="layer-title">Not a replacement for your ORM</p>
  <p class="layer-subtitle">Kavo doesn't own your data model — it sits on top of the entity you already defined.</p>
  <div class="equation">
    <div class="eq-card">
      <span class="eq-label">Your ORM</span>
      <span class="eq-desc">Entity, migrations, and relations — unchanged.</span>
    </div>
    <span class="eq-op">+</span>
    <div class="eq-card eq-card--kavo">
      <span class="eq-label eq-label--kavo">Kavo</span>
      <span class="eq-desc">Reads the entity's metadata, generates the CRUD surface.</span>
    </div>
    <span class="eq-op eq-op--equals">=</span>
    <div class="eq-card">
      <span class="eq-label">REST + GraphQL API</span>
      <span class="eq-desc">Filtering, sorting, pagination, includes, DTOs, errors.</span>
    </div>
  </div>
  <p class="layer-note">Swap ORMs later and the API surface doesn't move — <code>RepositoryAdapter</code> is the only seam that changes.</p>
</div>

<style scoped>
.layer-section {
  margin: 72px 0;
  text-align: center;
}

.layer-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.layer-subtitle {
  margin: 0 0 36px;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.equation {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 16px;
  max-width: 900px;
  margin: 0 auto;
}

@media (max-width: 860px) {
  .equation {
    flex-direction: column;
    align-items: stretch;
    max-width: 380px;
  }
}

.eq-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 18px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-align: left;
}

.eq-card--kavo {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.eq-label {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.eq-label--kavo {
  font-family: var(--vp-font-family-base);
  font-size: 15px;
  font-weight: 700;
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.eq-desc {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.eq-op {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--vp-c-text-3);
}

@media (max-width: 860px) {
  .eq-op {
    padding: 2px 0;
  }
}

.layer-note {
  margin: 32px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.layer-note code {
  font-size: 12px;
}
</style>

<div class="stack-section">
  <p class="stack-title">Works With Your Stack</p>
  <p class="stack-subtitle">First-class support for the tools you already use.</p>
  <div class="stack-badges">
    <span class="stack-badge">TypeORM</span>
    <span class="stack-badge">Prisma</span>
    <span class="stack-badge">Mongoose</span>
    <span class="stack-badge">NestJS</span>
    <span class="stack-badge">GraphQL</span>
  </div>
</div>

<style scoped>
.stack-section {
  margin: 64px 0;
  text-align: center;
}

.stack-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.stack-subtitle {
  margin: 0;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.stack-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin: 24px auto 0;
  max-width: 480px;
}

.stack-badge {
  padding: 7px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
}
</style>
