<template>
  <div class="realtime-transports">
    <div
      v-for="transport in transports"
      :key="transport.name"
      class="realtime-transport"
      :class="{ 'realtime-transport--shipped': transport.shipped }"
    >
      <span class="realtime-transport-name">{{ transport.name }}</span>
      <span class="realtime-transport-status">{{ transport.shipped ? "Ships today" : "Same interface" }}</span>
    </div>
  </div>

  <div class="realtime-usecases">
    <div v-for="useCase in useCases" :key="useCase.title" class="realtime-usecase">
      <span class="realtime-usecase-title">{{ useCase.title }}</span>
      <span class="realtime-usecase-desc">{{ useCase.desc }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const transports = [
  { name: "SSE", shipped: true },
  { name: "WebSocket", shipped: false },
  { name: "RabbitMQ", shipped: false },
  { name: "Kafka", shipped: false },
];

const useCases = [
  {
    title: "Client-facing UI",
    desc: "Live dashboards, badge counts, presence, scoped inventory views, job progress — pushed straight to the browser or mobile client.",
  },
  {
    title: "Service-to-service",
    desc: "Cache invalidation, search index sync, audit trails, analytics pipelines — fanned out to other backends over a broker.",
  },
  {
    title: "External-facing",
    desc: "Partner webhooks and mobile push, scoped and authorized per recipient rather than held open as a connection.",
  },
  {
    title: "Bridging",
    desc: "Ingest on one transport, fan out on another — IoT telemetry over a broker, live on an ops dashboard over WebSocket.",
  },
];
</script>

<style scoped>
.realtime-transports {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  max-width: 720px;
  margin: 32px auto 0;
}

.realtime-transport {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 22px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  min-width: 130px;
}

.realtime-transport--shipped {
  border-color: var(--vp-c-brand-1);
}

.realtime-transport-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.realtime-transport-status {
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.realtime-transport--shipped .realtime-transport-status {
  color: var(--vp-c-brand-1);
}

.realtime-usecases {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  max-width: 1040px;
  margin: 32px auto 0;
  text-align: left;
}

@media (max-width: 900px) {
  .realtime-usecases {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .realtime-usecases {
    grid-template-columns: 1fr;
  }
}

.realtime-usecase {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.realtime-usecase-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.realtime-usecase-desc {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}
</style>
