<script setup lang="ts">
import { useData } from "vitepress";
import AgenticBadge from "./AgenticBadge.vue";

const { frontmatter } = useData();
const hero = frontmatter.value.hero ?? {};
</script>

<template>
  <AgenticBadge class="top-badge" />
  <h1 class="heading">
    <span v-if="hero.name" v-html="hero.name" class="name clip"></span>
    <span v-if="hero.text" v-html="hero.text" class="text"></span>
  </h1>
  <p v-if="hero.tagline" v-html="hero.tagline" class="tagline"></p>
</template>

<style scoped>
.heading {
  display: flex;
  flex-direction: column;
}

.top-badge {
  display: inline-flex;
  margin-top: 5px;
  margin-bottom: 5px;
}

.VPHero.has-image .top-badge {
  margin-left: auto;
  margin-right: auto;
}

@media (min-width: 960px) {
  .VPHero.has-image .top-badge {
    margin-left: 0;
    margin-right: 0;
  }
}

.name,
.text {
  width: fit-content;
  max-width: 392px;
  letter-spacing: -0.4px;
  line-height: 36px;
  font-size: 32px;
  font-weight: 700;
  white-space: pre-wrap;
}

.VPHero.has-image .name,
.VPHero.has-image .text {
  margin: 0 auto;
}

.name {
  color: var(--vp-home-hero-name-color);
}

.clip {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: var(--vp-home-hero-name-color);
}

@media (min-width: 640px) {
  .name,
  .text {
    max-width: 576px;
    line-height: 50px;
    font-size: 48px;
  }
}

@media (min-width: 960px) {
  .name,
  .text {
    line-height: 58px;
    font-size: 56px;
  }

  .VPHero.has-image .name,
  .VPHero.has-image .text {
    margin: 0;
  }
}

.tagline {
  padding-top: 6px;
  max-width: 392px;
  line-height: 25px;
  font-size: 18px;
  font-weight: 500;
  white-space: pre-wrap;
  color: var(--vp-c-text-2);
}

.VPHero.has-image .tagline {
  margin: 0 auto;
}

@media (min-width: 640px) {
  .tagline {
    padding-top: 10px;
    max-width: 576px;
    line-height: 29px;
    font-size: 20px;
  }
}

@media (min-width: 960px) {
  .tagline {
    line-height: 28px;
    font-size: 20px;
  }

  .VPHero.has-image .tagline {
    margin: 0;
  }
}
</style>
