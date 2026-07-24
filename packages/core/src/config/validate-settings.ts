import type { CrudoSettings } from "./settings.js";
import { ConfigurationException } from "../errors/exceptions.js";

/**
 * Bootstrap validation (Phase 8). Fails fast with an error naming the
 * entity, the key path, and the offending value — config errors surface at
 * startup, never as mysterious runtime behavior.
 */
export function validateSettings(entityName: string, settings: CrudoSettings): void {
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

  if (settings.bulk.mode !== "atomic" && settings.bulk.mode !== "bestEffort") {
    throw new ConfigurationException(
      entityName,
      "bulk.mode",
      `expected "atomic" or "bestEffort", got ${JSON.stringify(settings.bulk.mode)}`,
    );
  }
  positiveInt("bulk.maxBatchSize", settings.bulk.maxBatchSize);
}
