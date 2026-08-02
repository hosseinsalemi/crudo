<template>
  <div class="qg-tablist" role="tablist" aria-label="Query grammar examples">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="qg-tab"
      :class="{ 'qg-tab--active': modelValue === tab.id }"
      :aria-selected="modelValue === tab.id"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  tabs: { id: string; label: string }[];
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();
</script>

<style scoped>
.qg-tablist {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 0 0 20px;
}

.qg-tab {
  padding: 6px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 12.5px;
  font-weight: 500;
  font-family: var(--vp-font-family-base);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}

.qg-tab:hover {
  color: var(--vp-c-text-1);
}

.qg-tab--active {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
</style>
