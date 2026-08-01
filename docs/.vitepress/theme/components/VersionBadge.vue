<script setup lang="ts">
import { useData } from "vitepress";

const { theme } = useData();
</script>

<template>
  <a
    class="version-badge"
    :href="`https://www.npmjs.com/package/@kavo/core`"
    target="_blank"
    rel="noreferrer"
    :aria-label="`View @kavo/core v${theme.version} on npm`"
  >
    <span>v{{ theme.version }}</span>
  </a>
</template>

<style scoped>
.version-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  margin-right: 8px;
  padding: 0 9px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: color 0.2s;
}

.version-badge:hover {
  color: var(--vp-c-brand-1);
}
</style>
