<template>
  <div class="config-section">
    <p class="config-title">Customize it to fit your needs</p>
    <p class="config-subtitle">
      Every setting is optional at every scope — start with the defaults and override only where your app needs to
      differ.
    </p>
    <p class="config-scopes">
      <template v-for="(scope, index) in scopes" :key="scope">
        <span>{{ scope }}</span>
        <span v-if="index < scopes.length - 1" class="config-sep">→</span>
      </template>
    </p>
    <p class="config-note">
      No config at all still works — built-in defaults cover every setting until you decide to change one.
    </p>
  </div>
</template>

<script setup lang="ts">
const scopes = ["Global", "Entity", "Operation", "Per-call"];
</script>

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
