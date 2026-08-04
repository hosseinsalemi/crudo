import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import AnimatedBackground from "./components/AnimatedBackground.vue";
import HeroTerminal from "./components/HeroTerminal.vue";
import HeroInfo from "./components/HeroInfo.vue";
import VersionBadge from "./components/VersionBadge.vue";
import "./custom.css";
import "./styles/homepage-sections.css";
import "./styles/diagrams.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      "home-hero-before": () => h(AnimatedBackground),
      "home-hero-info": () => h(HeroInfo),
      "home-hero-image": () => h(HeroTerminal),
      "nav-bar-content-before": () => h(VersionBadge),
    });
  },
};
