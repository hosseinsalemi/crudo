<template>
  <div class="mcp-window-body">
    <TransitionGroup tag="div" name="mcp-msg" class="mcp-feed">
      <template v-for="(msg, i) in messages.slice(0, visibleCount)" :key="i">
        <div v-if="msg.kind === 'user'" class="mcp-turn mcp-turn--user">
          <span class="mcp-turn-tag">You</span>
          <p class="mcp-turn-text">{{ msg.text }}</p>
        </div>
        <div v-else-if="msg.kind === 'agent'" class="mcp-turn mcp-turn--agent">
          <span class="mcp-turn-tag mcp-turn-tag--agent">Agent</span>
          <p class="mcp-turn-text">{{ msg.text }}</p>
        </div>
        <div v-else-if="msg.kind === 'call'" class="mcp-call">
          <span class="mcp-call-tag">call</span>
          <span class="mcp-call-name">{{ msg.name }}</span>
          <span class="mcp-call-args">{{ msg.args }}</span>
        </div>
        <div v-else class="mcp-result">{{ msg.text }}</div>
      </template>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

type ChatMessage =
  | { kind: "user" | "agent"; text: string }
  | { kind: "call"; name: string; args: string }
  | { kind: "result"; text: string };

const messages: ChatMessage[] = [
  { kind: "user", text: "Archive book #42 and tell me who wrote it." },
  { kind: "call", name: "book.patchOne", args: '{ id: 42, status: "archived" }' },
  { kind: "result", text: '{ "id": 42, "status": "archived" }' },
  { kind: "call", name: "book.findOne", args: '{ id: 42, include: "author" }' },
  { kind: "result", text: '{ "author": { "name": "Ursula K. Le Guin" } }' },
  { kind: "agent", text: "Done — Book #42 is archived. It was written by Ursula K. Le Guin." },
];

const STEP_MS = 600;
const HOLD_MS = 10000;
const RESET_PAUSE_MS = 100;

const visibleCount = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;

function tick() {
  if (visibleCount.value < messages.length) {
    visibleCount.value += 1;
    timer = setTimeout(tick, STEP_MS);
    return;
  }
  timer = setTimeout(() => {
    visibleCount.value = 0;
    timer = setTimeout(tick, RESET_PAUSE_MS);
  }, HOLD_MS);
}

onMounted(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    visibleCount.value = messages.length;
    return;
  }
  timer = setTimeout(tick, STEP_MS);
});

onUnmounted(() => {
  clearTimeout(timer);
});
</script>

<style scoped>
.mcp-window-body {
  position: relative;
  height: 345px;
  overflow: hidden;
}

.mcp-feed {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 100%;
  gap: 10px;
  padding: 18px 20px 22px;
}

.mcp-msg-enter-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}

.mcp-msg-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.mcp-msg-leave-active {
  transition: opacity 0.25s ease;
  position: absolute;
}

.mcp-msg-leave-to {
  opacity: 0;
}

.mcp-msg-move {
  transition: transform 0.35s ease;
}

.mcp-turn-tag {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  margin-bottom: 4px;
}

.mcp-turn-tag--agent {
  color: var(--vp-c-brand-1);
}

.mcp-turn-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--vp-c-text-1);
}

.mcp-call {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--vp-c-divider));
  background: var(--vp-c-brand-soft);
}

.mcp-call-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  opacity: 0.8;
}

.mcp-call-name {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.mcp-call-args {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.mcp-result {
  margin-left: 12px;
  padding: 6px 12px;
  border-left: 2px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
}

@media (prefers-reduced-motion: reduce) {
  .mcp-window-body {
    height: auto;
    overflow: visible;
    mask-image: none;
  }
}
</style>
