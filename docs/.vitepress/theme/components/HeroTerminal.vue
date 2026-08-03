<template>
  <div class="hero-terminal" aria-hidden="true">
    <div class="hero-terminal-bar">
      <span class="hero-terminal-dot hero-terminal-dot--red"></span>
      <span class="hero-terminal-dot hero-terminal-dot--yellow"></span>
      <span class="hero-terminal-dot hero-terminal-dot--green"></span>
      <span class="hero-terminal-file">books.controller.ts</span>
    </div>

    <pre class="hero-terminal-code"><code><span class="tok-dec">@Kavo</span>(<span class="tok-cls">Book</span>)
<span class="tok-dec">@Controller</span>(<span class="tok-str">"books"</span>)
<span class="tok-kw">export class</span> <span class="tok-cls">BooksController</span> {}<span class="hero-terminal-cursor"></span></code></pre>

    <div class="hero-terminal-routes">
      <div
        v-for="(route, i) in routes"
        :key="route.path + route.method"
        class="hero-terminal-route"
        :style="{ animationDelay: `${1.1 + i * 0.14}s` }"
      >
        <span class="hero-terminal-method" :class="`method-${route.method.toLowerCase()}`">{{ route.method }}</span>
        <span class="hero-terminal-path">{{ route.path }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const routes = [
  { method: "QUERY", path: "/books" },
  { method: "POST", path: "/books" },
  { method: "GET", path: "/books/:id" },
  { method: "PUT", path: "/books/:id" },
  { method: "DELETE", path: "/books/:id" },
  { method: "PATCH", path: "/books/:id/restore" },
];
</script>

<style scoped>
.hero-terminal {
  width: 95%;
  max-width: 440px;
  margin: 0 auto;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-code-block-bg);
  box-shadow: 0 24px 60px -20px rgba(124, 92, 255, 0.35);
}

.hero-terminal-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.hero-terminal-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hero-terminal-dot--red {
  background: #ff5f56;
}

.hero-terminal-dot--yellow {
  background: #ffbd2e;
}

.hero-terminal-dot--green {
  background: #27c93f;
}

.hero-terminal-file {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.hero-terminal-code {
  margin: 0;
  padding: 20px 18px;
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.7;
  overflow-x: auto;
}

.tok-dec {
  color: var(--vp-c-brand-1);
}

.tok-cls {
  color: #33c9c0;
}

.tok-kw {
  color: #ff8fab;
}

.tok-str {
  color: #ffbd2e;
}

.hero-terminal-cursor {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 2px;
  background: var(--vp-c-brand-1);
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.hero-terminal-routes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 18px 18px;
}

.hero-terminal-route {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  opacity: 0;
  transform: translateX(-6px);
  animation: route-in 0.4s ease-out forwards;
}

@keyframes route-in {
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.hero-terminal-method {
  flex-shrink: 0;
  width: 52px;
  text-align: center;
  padding: 2px 0;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.method-get {
  color: #33c9c0;
  background: rgba(51, 201, 192, 0.14);
}

.method-query {
  color: #4da8ff;
  background: rgba(77, 168, 255, 0.14);
}

.method-post {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.method-patch {
  color: #ffbd2e;
  background: rgba(255, 189, 46, 0.14);
}

.method-put {
  color: #ff8fab;
  background: rgba(255, 143, 171, 0.14);
}

.method-delete {
  color: #ff5f56;
  background: rgba(255, 95, 86, 0.14);
}

.hero-terminal-path {
  color: var(--vp-c-text-2);
}

@media (max-width: 959px) {
  .hero-terminal {
    margin-top: 70px;
    margin-bottom: 100px;
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-terminal-cursor {
    animation: none;
  }

  .hero-terminal-route {
    opacity: 1;
    transform: none;
    animation: none;
  }
}
</style>
