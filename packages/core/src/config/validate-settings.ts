import type { KavoSettings } from "./settings.js";
import { ConfigurationException } from "../errors/exceptions.js";

/**
 * Bootstrap validation (Phase 8). Fails fast with an error naming the
 * entity, the key path, and the offending value — config errors surface at
 * startup, never as mysterious runtime behavior.
 */
export function validateSettings(entityName: string, settings: KavoSettings): void {
  const positiveInt = (path: string, value: unknown): void => {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new ConfigurationException(entityName, path, `expected a positive integer, got ${JSON.stringify(value)}`);
    }
  };
  const bool = (path: string, value: unknown): void => {
    if (typeof value !== "boolean") {
      throw new ConfigurationException(entityName, path, `expected a boolean, got ${JSON.stringify(value)}`);
    }
  };

  positiveInt("pagination.defaultLimit", settings.pagination.defaultLimit);
  positiveInt("pagination.maxLimit", settings.pagination.maxLimit);
  bool("pagination.count", settings.pagination.count);
  if (typeof settings.pagination.strategy !== "string") {
    throw new ConfigurationException(
      entityName,
      "pagination.strategy",
      `expected a strategy name, got ${JSON.stringify(settings.pagination.strategy)}`,
    );
  }
  if (settings.pagination.defaultLimit > settings.pagination.maxLimit) {
    throw new ConfigurationException(
      entityName,
      "pagination.defaultLimit",
      `defaultLimit (${settings.pagination.defaultLimit}) exceeds maxLimit (${settings.pagination.maxLimit})`,
    );
  }

  positiveInt("query.maxFilterDepth", settings.query.maxFilterDepth);
  positiveInt("query.maxInValues", settings.query.maxInValues);

  bool("errors.exposeInternals", settings.errors.exposeInternals);

  positiveInt("relations.maxIncludeDepth", settings.relations.maxIncludeDepth);
  positiveInt("relations.maxIncludedNodes", settings.relations.maxIncludedNodes);
  for (const [name, edge] of Object.entries(settings.relations.edges)) {
    const path = `relations.edges.${name}`;
    if (typeof edge !== "object" || edge === null) {
      throw new ConfigurationException(entityName, path, `expected an object, got ${JSON.stringify(edge)}`);
    }
    if (edge.includable !== undefined) bool(`${path}.includable`, edge.includable);
    if (edge.defaultInclude !== undefined) bool(`${path}.defaultInclude`, edge.defaultInclude);
    if (edge.maxDepth !== undefined) positiveInt(`${path}.maxDepth`, edge.maxDepth);
    if (edge.strategy !== undefined && !["join", "batch", "auto"].includes(edge.strategy)) {
      throw new ConfigurationException(
        entityName,
        `${path}.strategy`,
        `expected "join", "batch", or "auto", got ${JSON.stringify(edge.strategy)}`,
      );
    }
    if (edge.defaultInclude === true && edge.includable === false) {
      throw new ConfigurationException(
        entityName,
        path,
        "defaultInclude requires an includable relation — it would load a relation clients cannot ask for",
      );
    }
  }

  if (settings.softDelete !== false) {
    if (
      typeof settings.softDelete !== "object" ||
      settings.softDelete === null ||
      typeof settings.softDelete.field !== "string" ||
      settings.softDelete.field.length === 0
    ) {
      throw new ConfigurationException(
        entityName,
        "softDelete",
        `expected false or { field: string, strategy: … }, got ${JSON.stringify(settings.softDelete)}`,
      );
    }
    const strategy = settings.softDelete.strategy;
    if (strategy !== "auto" && strategy !== "soft" && strategy !== "hard") {
      throw new ConfigurationException(
        entityName,
        "softDelete.strategy",
        `expected "auto", "soft", or "hard", got ${JSON.stringify(strategy)}`,
      );
    }
  }
}
