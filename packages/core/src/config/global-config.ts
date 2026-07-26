import type { KavoSettings } from "./settings.js";
import type { DeepPartial } from "../types/utility.js";

/**
 * Raw global (framework-scope) configuration — the argument to
 * `createKavo`. The bare `createCrud(Entity)` zero-config path is an
 * implicit root instance of this with built-in defaults; nothing about
 * global config may tax the zero-config case.
 */
export interface GlobalConfig {
  /** Framework-wide defaults, merged below entity/operation scope. */
  readonly defaults?: DeepPartial<KavoSettings>;
}
