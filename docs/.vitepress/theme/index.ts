import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import AnimatedBackground from "./components/AnimatedBackground.vue";
import HeroTerminal from "./components/HeroTerminal.vue";
import HeroInfo from "./components/HeroInfo.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      "home-hero-before": () => h(AnimatedBackground),
      "home-hero-info": () => h(HeroInfo),
      "home-hero-image": () => h(HeroTerminal),
    });
  },
};
