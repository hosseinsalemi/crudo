<template>
  <div class="agentic-badge">
    <svg
      class="agentic-badge-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 2.5L13.6 8.9L20 10.5L13.6 12.1L12 18.5L10.4 12.1L4 10.5L10.4 8.9L12 2.5Z" fill="currentColor" />
      <path d="M19 15L19.7 17.3L22 18L19.7 18.7L19 21L18.3 18.7L16 18L18.3 17.3L19 15Z" fill="currentColor" />
    </svg>
    <span>Agentic-Ready</span>
  </div>
</template>

<style scoped>
.agentic-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
  vertical-align: middle;
}

.agentic-badge-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
</style>
