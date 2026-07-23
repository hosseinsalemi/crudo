/**
 * The standard operation ids. Every operation names its cardinality
 * explicitly: `<verb>One` for single-target, `<verb>Many` for batch.
 * "Bulk" is the feature term (config key `bulk`, `/bulk` routes), never a
 * method prefix.
 */
export type StandardOperationId =
  | "createOne"
  | "createMany"
  | "findOne"
  | "findMany"
  | "updateOne"
  | "updateMany"
  | "patchOne"
  | "patchMany"
  | "deleteOne"
  | "deleteMany"
  | "restoreOne"
  | "restoreMany"
  | "purgeOne";

/**
 * Any operation id — standard or custom (Phase 14). The `string & {}`
 * branch keeps literal-union completions for the standard ids while
 * admitting arbitrary custom names.
 */
export type OperationId = StandardOperationId | (string & {});

/** Read/write classification, used for lifecycle branching (Phase 7). */
export type OperationKind = "read" | "write";

/** Whether an operation targets one entity or a batch. */
export type OperationCardinality = "one" | "many";
