import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import AnimatedBackground from "./components/AnimatedBackground.vue";
import HeroTerminal from "./components/HeroTerminal.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      "home-hero-before": () => h(AnimatedBackground),
      "home-hero-image": () => h(HeroTerminal),
    });
  },
};
