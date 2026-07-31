<template>
  <div class="ocean" aria-hidden="true">
    <div class="sky" />
    <span class="glimmer glimmer-a" />
    <span class="glimmer glimmer-b" />

    <div class="bubbles">
      <span
        v-for="(b, i) in bubbles"
        :key="i"
        class="bubble"
        :style="{
          left: b.left + '%',
          width: b.size + 'px',
          height: b.size + 'px',
          animationDuration: b.duration + 's',
          animationDelay: b.delay + 's',
        }"
      />
    </div>

    <svg class="wave wave-back" viewBox="0 0 2880 220" preserveAspectRatio="none">
      <path
        d="M0,90 C240,150 480,30 720,90 C960,150 1200,30 1440,90 C1680,150 1920,30 2160,90 C2400,150 2640,30 2880,90 L2880,220 L0,220 Z"
        fill="var(--ocean-back)"
      />
    </svg>
    <svg class="wave wave-mid" viewBox="0 0 2880 200" preserveAspectRatio="none">
      <path
        d="M0,70 C240,20 480,120 720,70 C960,20 1200,120 1440,70 C1680,20 1920,120 2160,70 C2400,20 2640,120 2880,70 L2880,200 L0,200 Z"
        fill="var(--ocean-mid)"
      />
    </svg>
    <svg class="wave wave-front" viewBox="0 0 2880 180" preserveAspectRatio="none">
      <path
        d="M0,60 C240,110 480,10 720,60 C960,110 1200,10 1440,60 C1680,110 1920,10 2160,60 C2400,110 2640,10 2880,60 L2880,180 L0,180 Z"
        fill="var(--ocean-front)"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
const bubbles = Array.from({ length: 34 }, (_, i) => ({
  left: (i * 37 + 5) % 100,
  size: 3 + ((i * 13) % 12),
  duration: 8 + ((i * 7) % 12),
  delay: -((i * 3) % 16),
}));
</script>

<style scoped>
.ocean {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
}

.sky {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, var(--ocean-sky-top) 0%, var(--ocean-sky-bottom) 100%);
}

.glimmer {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.4;
  will-change: transform;
}

.glimmer-a {
  width: 380px;
  height: 380px;
  top: -120px;
  left: -60px;
  background: radial-gradient(circle, #7c5cff, transparent 70%);
  animation: drift-a 24s ease-in-out infinite;
}

.glimmer-b {
  width: 320px;
  height: 320px;
  top: -60px;
  right: -80px;
  background: radial-gradient(circle, #33c9c0, transparent 70%);
  animation: drift-b 28s ease-in-out infinite;
}

@keyframes drift-a {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(50px, 30px) scale(1.08);
  }
}

@keyframes drift-b {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(-40px, 25px) scale(1.06);
  }
}

.bubbles {
  position: absolute;
  inset: 0;
}

.bubble {
  position: absolute;
  bottom: -20px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.05) 70%);
  opacity: 0;
  animation-name: rise;
  animation-timing-function: ease-in;
  animation-iteration-count: infinite;
}

@keyframes rise {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 0.55;
  }
  90% {
    opacity: 0.25;
  }
  100% {
    transform: translate(12px, -420px);
    opacity: 0;
  }
}

.wave {
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 200%;
  animation: drift-wave linear infinite;
}

.wave-back {
  height: 46%;
  animation-duration: 34s;
  opacity: 0.55;
}

.wave-mid {
  height: 34%;
  animation-duration: 24s;
  animation-direction: reverse;
  opacity: 0.7;
}

.wave-front {
  height: 24%;
  animation-duration: 16s;
  opacity: 0.9;
}

@keyframes drift-wave {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

:root {
  --ocean-sky-top: rgba(124, 92, 255, 0.06);
  --ocean-sky-bottom: rgba(51, 201, 192, 0.08);
  --ocean-back: rgba(93, 63, 189, 0.35);
  --ocean-mid: rgba(58, 130, 179, 0.4);
  --ocean-front: rgba(33, 168, 165, 0.45);
}

.dark {
  --ocean-sky-top: rgba(124, 92, 255, 0.1);
  --ocean-sky-bottom: rgba(51, 201, 192, 0.1);
  --ocean-back: rgba(93, 63, 189, 0.45);
  --ocean-mid: rgba(45, 110, 158, 0.5);
  --ocean-front: rgba(28, 150, 148, 0.55);
}

@media (prefers-reduced-motion: reduce) {
  .glimmer,
  .bubble,
  .wave {
    animation: none !important;
  }
}

@media (max-width: 768px) {
  .bubble {
    display: none;
  }
}
</style>
