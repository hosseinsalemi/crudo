---
layout: home

hero:
  name: Kavo
  text: Turn models into APIs
  tagline: Define an entity once and get a complete REST, GraphQL, and MCP CRUD API with filtering, sorting, pagination, and generated routes. Vibe code it in minutes, on a fraction of the tokens.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/kavo-labs/kavo
---

<script setup lang="ts">
import { ref } from "vue";
import QueryGrammarTabs from "./.vitepress/theme/components/QueryGrammarTabs.vue";
import McpChatDemo from "./.vitepress/theme/components/McpChatDemo.vue";

const queryGrammarTabs = [
  { id: "filter-sort", label: "Filter & sort" },
  { id: "includes", label: "Includes" },
  { id: "fields", label: "Field selection" },
  { id: "pagination", label: "Pagination" },
  { id: "soft-delete", label: "Soft delete" },
];
const activeQueryGrammarTab = ref(queryGrammarTabs[0].id);
</script>

<div class="tool-logos-section">
  <div class="tool-logos">
  <span class="tool-chip">
      <svg class="tool-chip-icon" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M14.131.047c-.173 0-.334.037-.483.087.316.21.49.49.576.806.007.043.019.074.025.117a.681.681 0 0 1 .013.112c.024.545-.143.614-.26.936-.18.415-.13.861.086 1.22a.74.74 0 0 0 .074.137c-.235-1.568 1.073-1.803 1.314-2.293.019-.428-.334-.713-.613-.911a1.37 1.37 0 0 0-.732-.21zM16.102.4c-.024.143-.006.106-.012.18-.006.05-.006.112-.012.161-.013.05-.025.1-.044.149-.012.05-.03.1-.05.149l-.067.142c-.02.025-.031.05-.05.075l-.037.055a2.152 2.152 0 0 1-.093.124c-.037.038-.068.081-.112.112v.006c-.037.031-.074.068-.118.1-.13.099-.278.173-.415.266-.043.03-.087.056-.124.093a.906.906 0 0 0-.118.099c-.043.037-.074.074-.111.118-.031.037-.068.08-.093.124a1.582 1.582 0 0 0-.087.13c-.025.05-.043.093-.068.142-.019.05-.037.093-.05.143a2.007 2.007 0 0 0-.043.155c-.006.025-.006.056-.012.08-.007.025-.007.05-.013.075 0 .05-.006.105-.006.155 0 .037 0 .074.006.111 0 .05.006.1.019.155.006.05.018.1.03.15.02.049.032.098.05.148.013.03.031.062.044.087l-1.426-.552c-.241-.068-.477-.13-.719-.186l-.39-.093c-.372-.074-.75-.13-1.128-.167-.013 0-.019-.006-.031-.006A11.082 11.082 0 0 0 8.9 2.855c-.378.025-.756.074-1.134.136a12.45 12.45 0 0 0-.837.174l-.279.074c-.092.037-.18.08-.266.118l-.205.093c-.012.006-.024.006-.03.012-.063.031-.118.056-.174.087a2.738 2.738 0 0 0-.236.118c-.043.018-.086.043-.124.062a.559.559 0 0 1-.055.03c-.056.032-.112.063-.162.094a1.56 1.56 0 0 0-.148.093c-.044.03-.087.055-.124.086-.006.007-.013.007-.019.013-.037.025-.08.056-.118.087l-.012.012-.093.074c-.012.007-.025.019-.037.025-.031.025-.062.056-.093.08-.006.013-.019.02-.025.025-.037.038-.074.069-.111.106-.007 0-.007.006-.013.012a1.742 1.742 0 0 0-.111.106c-.007.006-.007.012-.013.012a1.454 1.454 0 0 0-.093.1c-.012.012-.03.024-.043.036a1.374 1.374 0 0 1-.106.112c-.006.012-.018.019-.024.03-.05.05-.093.1-.143.15l-.018.018c-.1.106-.205.211-.317.304-.111.1-.229.192-.347.273a3.777 3.777 0 0 1-.762.421c-.13.056-.267.106-.403.149-.26.056-.527.161-.756.18-.05 0-.105.012-.155.018l-.155.037-.149.056c-.05.019-.099.044-.148.068-.044.031-.093.056-.137.087a1.011 1.011 0 0 0-.124.106c-.043.03-.087.074-.124.111-.037.043-.074.08-.105.124-.031.05-.068.093-.093.143a1.092 1.092 0 0 0-.087.142c-.025.056-.05.106-.068.161-.019.05-.037.106-.056.161-.012.05-.025.1-.03.15 0 .005-.007.012-.007.018-.012.056-.012.13-.019.167C.006 7.95 0 7.986 0 8.03a.657.657 0 0 0 .074.31v.006c.019.037.044.075.069.112.024.037.05.074.08.111.031.031.068.069.106.1a.906.906 0 0 0 .117.099c.149.13.186.173.378.272.031.019.062.031.1.05.006 0 .012.006.018.006 0 .013 0 .019.006.031a1.272 1.272 0 0 0 .08.298c.02.037.032.074.05.111.007.013.013.025.02.031.024.05.049.093.073.137l.093.13c.031.037.069.08.106.118.037.037.074.068.118.105 0 0 .006.006.012.006.037.031.074.062.112.087a.986.986 0 0 0 .136.08c.043.025.093.05.142.069a.73.73 0 0 0 .124.043c.007.006.013.006.025.012.025.007.056.013.08.019-.018.335-.024.65.026.762.055.124.328-.254.6-.688-.036.428-.061.93 0 1.079.069.155.44-.329.763-.862 4.395-1.016 8.405 2.02 8.826 6.31-.08-.67-.905-1.041-1.283-.948-.186.458-.502 1.047-1.01 1.413.043-.41.025-.83-.062-1.24a4.009 4.009 0 0 1-.769 1.562c-.588.043-1.177-.242-1.487-.67-.025-.018-.031-.055-.05-.08-.018-.043-.037-.087-.05-.13a.515.515 0 0 1-.037-.13c-.006-.044-.006-.087-.006-.137v-.093a.992.992 0 0 1 .031-.13c.013-.043.025-.086.044-.13.024-.043.043-.087.074-.13.105-.298.105-.54-.087-.682a.706.706 0 0 0-.118-.062c-.024-.006-.055-.018-.08-.025l-.05-.018a.847.847 0 0 0-.13-.031.472.472 0 0 0-.13-.019 1.01 1.01 0 0 0-.136-.012c-.031 0-.062.006-.093.006a.484.484 0 0 0-.137.019c-.043.006-.086.012-.13.024a1.068 1.068 0 0 0-.13.044c-.043.018-.08.037-.124.056-.037.018-.074.043-.118.062-1.444.942-.582 3.148.403 3.787-.372.068-.75.148-.855.229l-.013.012c.267.161.546.298.837.416.397.13.818.247 1.004.297v.006a5.996 5.996 0 0 0 1.562.112c2.746-.192 4.996-2.281 5.405-5.033l.037.161c.019.112.043.23.056.347v.006c.012.056.018.112.025.162v.024c.006.056.012.112.012.162.006.068.012.136.012.204v.1c0 .03.007.067.007.098 0 .038-.007.075-.007.112v.087c0 .043-.006.08-.006.124 0 .025 0 .05-.006.08 0 .044-.006.087-.006.137-.006.018-.006.037-.006.055l-.02.143c0 .019 0 .037-.005.056-.007.062-.019.118-.025.18v.012l-.037.174v.018l-.037.167c0 .007-.007.02-.007.025a1.663 1.663 0 0 1-.043.168v.018c-.019.062-.037.118-.05.174-.006.006-.006.012-.006.012l-.056.186c-.024.062-.043.118-.068.18-.025.062-.043.124-.068.18-.025.062-.05.117-.074.18h-.007c-.024.055-.05.117-.08.173a.302.302 0 0 1-.019.043c-.006.006-.006.013-.012.019a5.867 5.867 0 0 1-1.742 2.082c-.05.031-.099.069-.149.106-.012.012-.03.018-.043.03a2.603 2.603 0 0 1-.136.094l.018.037h.007l.26-.037h.006c.161-.025.322-.056.483-.087.044-.006.093-.019.137-.031l.087-.019c.043-.006.086-.018.13-.024.037-.013.074-.02.111-.031.62-.15 1.221-.354 1.798-.595a9.926 9.926 0 0 1-3.85 3.142c.714-.05 1.426-.167 2.114-.366a9.903 9.903 0 0 0 5.857-4.68 9.893 9.893 0 0 1-1.667 3.986 9.758 9.758 0 0 0 1.655-1.376 9.824 9.824 0 0 0 2.61-5.268c.21.98.272 1.99.18 2.987 4.474-6.241.371-12.712-1.346-14.416-.006-.013-.012-.019-.012-.031-.006.006-.006.006-.006.012 0-.006 0-.006-.007-.012 0 .074-.006.148-.012.223a8.34 8.34 0 0 1-.062.415c-.03.136-.068.273-.105.41-.044.13-.093.266-.15.396a5.322 5.322 0 0 1-.185.378 4.735 4.735 0 0 1-.477.688c-.093.111-.192.21-.292.31a3.994 3.994 0 0 1-.18.155l-.142.124a3.459 3.459 0 0 1-.347.241 4.295 4.295 0 0 1-.366.211c-.13.062-.26.118-.39.174a4.364 4.364 0 0 1-.818.223c-.143.025-.285.037-.422.05a4.914 4.914 0 0 1-.297.012 4.66 4.66 0 0 1-.422-.025 3.137 3.137 0 0 1-.421-.062 3.136 3.136 0 0 1-.415-.105h-.007c.137-.013.273-.025.41-.05a4.493 4.493 0 0 0 .818-.223c.136-.05.266-.112.39-.174.13-.062.248-.13.372-.204.118-.08.235-.161.347-.248.112-.087.217-.18.316-.279.105-.093.198-.198.291-.304.093-.111.18-.223.26-.334.013-.019.026-.044.038-.062.062-.1.124-.199.18-.298a4.272 4.272 0 0 0 .334-.775c.044-.13.075-.266.106-.403.025-.142.05-.278.062-.415.012-.142.025-.285.025-.421 0-.1-.007-.199-.013-.298a6.726 6.726 0 0 0-.05-.415 4.493 4.493 0 0 0-.092-.415c-.044-.13-.087-.267-.137-.397-.05-.13-.111-.26-.173-.384-.069-.124-.137-.248-.211-.366a6.843 6.843 0 0 0-.248-.34c-.093-.106-.186-.212-.285-.317a3.878 3.878 0 0 0-.161-.155c-.28-.217-.57-.421-.862-.607a1.154 1.154 0 0 0-.124-.062 2.415 2.415 0 0 0-.589-.26Z"/></svg>
      <span>NestJS</span>
    </span>
    <span class="tool-chip">
      <svg class="tool-chip-icon" viewBox="0 0 160 115" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M104.554 6.06518C105.723 4.89128 107.619 4.89128 108.788 6.06519L157.883 55.3561C159.052 56.53 159.052 58.4333 157.883 59.6072L108.784 108.902C107.615 110.076 105.719 110.076 104.55 108.902L55.4553 59.6114C54.2861 58.4375 54.2861 56.5342 55.4553 55.3603L104.554 6.06518Z"/><path d="M36.5814 59.6263C35.4154 58.4557 35.4153 56.5626 36.5814 55.392L77.6636 14.1472C79.0436 12.7617 78.7501 10.4446 77.0016 9.56896C69.8697 5.99744 61.8462 3.95789 53.3319 3.95789C23.8818 3.95789 0 27.9352 0 57.5091C0 87.0831 23.8818 111.06 53.3319 111.06C61.8445 111.06 69.8693 109.019 77.0015 105.447C78.7501 104.572 79.0436 102.255 77.6634 100.869L36.5814 59.6263Z"/></svg>
      <span>TypeORM</span>
    </span>
    <span class="tool-chip">
      <svg class="tool-chip-icon" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M21.8068 18.2848L13.5528.7565c-.207-.4382-.639-.7273-1.1286-.7541-.5023-.0293-.9523.213-1.2062.6253L2.266 15.1271c-.2773.4518-.2718 1.0091.0158 1.4555l4.3759 6.7786c.2608.4046.7127.6388 1.1823.6388.1332 0 .267-.0188.3987-.0577l12.7019-3.7568c.3891-.1151.7072-.3904.8737-.7553s.1633-.7828-.0075-1.1454zm-1.8481.7519L9.1814 22.2242c-.3292.0975-.6448-.1873-.5756-.5194l3.8501-18.4386c.072-.3448.5486-.3996.699-.0803l7.1288 15.138c.1344.2856-.019.6224-.325.7128z"/></svg>
      <span>Prisma</span>
    </span>
    <span class="tool-chip">
      <svg class="tool-chip-icon" viewBox="16 9 280 211" xmlns="http://www.w3.org/2000/svg"><g transform="translate(0,310) scale(0.1,-0.1)" fill="#fff" stroke="none"><path d="M942 2990 c-205 -29 -379 -132 -484 -288 -19 -29 -38 -49 -41 -45 -4
3 -7 58 -7 122 0 172 8 161 -120 161 -103 0 -108 -1 -114 -22 -8 -30 -8 -1956
0 -1986 6 -21 11 -22 114 -22 l108 0 6 31 c3 17 6 292 6 610 0 354 4 608 11
656 40 295 158 460 394 549 60 22 87 26 190 27 212 3 312 -44 379 -179 60
-120 59 -110 63 -937 l4 -758 112 3 112 3 5 645 c6 672 7 687 52 830 27 86 47
124 99 189 58 73 143 133 242 172 76 30 91 32 207 33 144 1 215 -16 283 -68
86 -65 131 -163 147 -322 5 -49 10 -403 10 -786 l0 -698 109 0 c90 0 110 3
115 16 10 26 6 1248 -4 1401 -16 228 -52 350 -138 465 -52 68 -151 141 -228
167 -187 63 -437 45 -620 -44 -88 -43 -198 -143 -255 -231 -23 -36 -47 -63
-53 -61 -6 2 -31 41 -56 87 -100 183 -250 270 -495 283 -49 3 -118 2 -153 -3z"/></g></svg>
      <span>Mongoose</span>
    </span>
    <span class="tool-chip">
      <svg class="tool-chip-icon" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M12.002 0a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm8.54 4.931a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm0 9.862a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm-8.54 4.931a2.138 2.138 0 1 0 0 4.276 2.138 2.138 0 1 0 0-4.276zm-8.542-4.93a2.138 2.138 0 1 0 0 4.276 2.138 2.138 0 1 0 0-4.277zm0-9.863a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm8.542-3.378L2.953 6.777v10.448l9.049 5.224 9.047-5.224V6.777zm0 1.601 7.66 13.27H4.34zm-1.387.371L3.97 15.037V7.363zm2.774 0 6.646 3.838v7.674zM5.355 17.44h13.293l-6.646 3.836z"/></svg>
      <span>GraphQL</span>
    </span>
  </div>
  <p class="tool-logos-title">Works with your stack</p>
</div>

<style scoped>
.tool-logos-section {
  margin: 75px 0 50px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tool-logos {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.tool-logos-title {
  margin: 25px 0 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  opacity: 0.5;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  letter-spacing: -0.005em;
  opacity: 0.5;
}

.tool-chip-icon {
  width: 24px;
  height: 24px;
  flex: none;
}
</style>

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

<div class="mcp-section">
  <p class="mcp-title">Expose your API to agents with MCP</p>
  <p class="mcp-subtitle">The same engine behind REST and GraphQL exposes every entity as an MCP toolset — no second registry, no hand-written schemas.</p>

  <McpChatDemo />

  <p class="mcp-note">Every standard operation, for every <code>@Kavo</code> entity, unconditionally — an agent gets the same filtering, pagination, and soft-delete semantics a REST or GraphQL client does, because it calls the same engine.</p>
</div>

<style scoped>
.mcp-section {
  margin: 64px 0;
  text-align: center;
}

.mcp-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.mcp-subtitle {
  margin: 0 0 28px;
  font-size: 14.5px;
  color: var(--vp-c-text-2);
}

.mcp-note {
  max-width: 640px;
  margin: 24px auto 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-3);
}

.mcp-note code {
  font-size: 12px;
}
</style>

<div class="query-section">
  <p class="query-title">The query grammar, on the wire</p>
  <p class="query-subtitle">Filtering, sorting, pagination, and includes — all driven by the query string, no extra code.</p>
  <QueryGrammarTabs v-model="activeQueryGrammarTab" :tabs="queryGrammarTabs" />

  <div class="query-demo">
    <div class="query-demo-col">
      <span class="query-demo-label">Request</span>
      <div v-show="activeQueryGrammarTab === 'filter-sort'">

```http
GET /books
  ?filter[status][eq]=published
  &filter[publishedAt][gte]=2020-01-01
  &sort=-publishedAt
  &include=author
  &limit=2
```

  </div>
      <div v-show="activeQueryGrammarTab === 'includes'">

```http
GET /books/42
  ?include=author,reviews.user
```

  </div>
      <div v-show="activeQueryGrammarTab === 'fields'">

```http
GET /books
  ?fields=id,title,status
  &fields[author]=id,name
```

  </div>
      <div v-show="activeQueryGrammarTab === 'pagination'">

```http
GET /books
  ?sort=title
  &limit=25
  &offset=50
```

  </div>
      <div v-show="activeQueryGrammarTab === 'soft-delete'">

```http
GET /books
  ?withDeleted=true
  &filter[status][eq]=archived
```

  </div>
    </div>
    <div class="query-demo-col">
      <span class="query-demo-label">Response</span>
      <div v-show="activeQueryGrammarTab === 'filter-sort'">

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
      <div v-show="activeQueryGrammarTab === 'includes'">

```json
{
  "id": 42,
  "title": "The Left Hand of Darkness",
  "author": { "id": 7, "name": "Ursula K. Le Guin" },
  "reviews": [
    {
      "id": 101,
      "rating": 5,
      "user": { "id": 3, "name": "Alex Chen" }
    }
  ]
}
```

  </div>
      <div v-show="activeQueryGrammarTab === 'fields'">

```json
{
  "items": [
    { "id": 42, "title": "The Left Hand of Darkness", "status": "published" },
    { "id": 41, "title": "Kindred", "status": "published" }
  ],
  "limit": 20,
  "offset": 0,
  "total": 128
}
```

  </div>
      <div v-show="activeQueryGrammarTab === 'pagination'">

```json
{
  "items": [
    { "id": 63, "title": "Annihilation", "status": "published" },
    { "id": 88, "title": "Binti", "status": "published" }
  ],
  "limit": 25,
  "offset": 50,
  "total": 128
}
```

  </div>
      <div v-show="activeQueryGrammarTab === 'soft-delete'">

```json
{
  "items": [
    {
      "id": 17,
      "title": "The Dispossessed",
      "status": "archived",
      "deletedAt": "2026-03-14T09:22:00.000Z"
    }
  ],
  "limit": 20,
  "offset": 0,
  "total": 1
}
```

  </div>
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
  font-size: 15px;
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
  <div class="equation-frame">
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

.equation-frame {
  max-width: 940px;
  margin: 0 auto;
  padding: 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: linear-gradient(180deg, var(--vp-c-bg-soft) 0%, var(--vp-c-bg) 100%);
  box-shadow: 0 8px 24px -18px rgba(0, 0, 0, 0.3);
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
  background: var(--vp-c-bg);
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
