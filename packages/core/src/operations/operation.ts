/**
 * The standard operation ids. Every operation names its cardinality
 * explicitly — all of them are `<verb>One` here, because the optional
 * batch (`*Many`) surface the spec describes is not built: it says to drop
 * it when out of scope, and the single-item CRUD surface is complete
 * without it.
 */
export type StandardOperationId =
  | "createOne"
  | "findOne"
  | "findMany"
  | "updateOne"
  | "patchOne"
  | "deleteOne"
  | "restoreOne"
  | "purgeOne";

/**
 * Any operation id — standard or custom. The `string & {}`
 * branch keeps literal-union completions for the standard ids while
 * admitting arbitrary custom names.
 */
export type OperationId = StandardOperationId | (string & {});

/** Read/write classification, used for lifecycle branching. */
export type OperationKind = "read" | "write";

/** Whether an operation targets one entity or a batch. */
export type OperationCardinality = "one" | "many";
