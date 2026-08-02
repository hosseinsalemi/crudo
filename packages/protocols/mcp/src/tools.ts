import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DefaultKavoService, EntityId } from "@kavo/core";
import { KavoException } from "@kavo/core";

/**
 * `sort: ["-createdAt", "name"]` → `[{ field: "createdAt", direction: "desc" }, { field: "name", direction: "asc" }]`
 * — same convention (and same reasoning) as `@kavo/graphql`'s `parseSortArg`: this binding calls the programmatic
 * `QueryContext` surface directly, never REST's wire-string parser.
 */
function parseSortArg(tokens: readonly string[] | undefined): { field: string; direction: "asc" | "desc" }[] {
  if (tokens === undefined) return [];
  return tokens.map((token) =>
    token.startsWith("-")
      ? { field: token.slice(1), direction: "desc" as const }
      : { field: token, direction: "asc" as const },
  );
}

/**
 * What a tool handler in this binding actually calls — the same
 * transport-agnostic programmatic surface `createCrud` returns that
 * `@kavo/graphql`'s `BoundKavoService` binds to. Kept as its own structural
 * type for the same reason: a caller only has to satisfy the operations a
 * toolset actually wires up.
 */
export type BoundKavoService<Entity extends object, Id extends EntityId, CreateDto, UpdateDto, PatchDto> = Pick<
  DefaultKavoService<Entity, Id, CreateDto, UpdateDto, PatchDto, unknown, unknown, unknown>,
  "findOne" | "findMany" | "createOne" | "updateOne" | "patchOne" | "deleteOne" | "restoreOne" | "purgeOne"
>;

/** One entity's MCP tool binding: a `Tool` definition plus the handler that runs it — `crudTools`'s unit of work. */
export interface KavoMcpToolBinding {
  readonly tool: Tool;
  readonly handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/** One entity's MCP binding options. */
export interface KavoMcpToolsOptions<Entity extends object, Id extends EntityId, CreateDto, UpdateDto, PatchDto> {
  /** Singular, capitalized entity name — becomes the `<lowerName>_<operation>` tool name prefix. */
  readonly name: string;
  readonly service: BoundKavoService<Entity, Id, CreateDto, UpdateDto, PatchDto>;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * Runs a handler and turns a `KavoException` into a normal (`isError:
 * true`) tool result instead of letting it propagate — the MCP protocol's
 * own convention for an expected domain failure (bad id, disabled
 * operation, conflict): the *call* succeeded, the *operation* didn't. An
 * error the engine did not itself raise (a bug, an unmapped adapter
 * failure) still propagates, so it surfaces as a protocol-level error
 * rather than being silently reframed as routine tool output.
 *
 * This is also how a mutation tool that doesn't apply to a given entity —
 * `restoreOne`/`purgeOne` on one that never declared soft delete —
 * degrades: every entity gets the full standard toolset unconditionally
 * (§ below), and the engine's own `OperationDisabledException` for a
 * disabled operation lands here as a normal `isError` result, exactly the
 * way calling the equivalent disabled REST route would.
 */
async function guarded(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return textResult(await fn());
  } catch (error) {
    if (error instanceof KavoException) {
      return { isError: true, content: [{ type: "text", text: `${error.code}: ${error.detail}` }] };
    }
    throw error;
  }
}

const idSchema = { type: ["string", "number"] };

function objectSchema(properties: Record<string, object>, required: readonly string[]): Tool["inputSchema"] {
  return { type: "object", properties, required: [...required] };
}

const idOnlySchema = objectSchema({ id: idSchema }, ["id"]);

/**
 * `{ id }` required, with any other property left unconstrained — JSON
 * Schema permits additional properties by default (no `additionalProperties:
 * false` here), so this doubles as `updateOne`/`patchOne`'s input schema: a
 * caller fills in `id` plus whatever DTO fields it wants, with no
 * per-entity schema to author or keep in sync.
 */
const idAndFreeformSchema = objectSchema({ id: idSchema }, ["id"]);

/** No constraints at all — every field an entity's `create` DTO accepts, forwarded straight through. */
const freeformObjectSchema: Tool["inputSchema"] = { type: "object" };

/**
 * Every standard operation, for one entity — unconditional. There is no
 * per-entity opt-in or hand-authored input schema (there used to be; see
 * git history / the issue this simplified) — every `@Kavo` entity handed
 * to `resolveKavoMcpTools` gets the full 8-tool set, the same way `@Kavo`
 * itself enables every standard operation by default. An operation that
 * doesn't actually apply — `restoreOne` on a non-soft-deletable entity, or
 * any operation an entity's own `@Kavo` config disabled — still produces a
 * tool, and calling it surfaces `OperationDisabledException` as a normal
 * `isError` result (`guarded`), exactly like calling the disabled REST
 * route would.
 */
export function crudTools<Entity extends object, Id extends EntityId, CreateDto, UpdateDto, PatchDto>(
  options: KavoMcpToolsOptions<Entity, Id, CreateDto, UpdateDto, PatchDto>,
): readonly KavoMcpToolBinding[] {
  const { name, service } = options;
  const prefix = lowerFirst(name);

  return [
    {
      tool: { name: `${prefix}_findOne`, description: `Find one ${name} by id.`, inputSchema: idOnlySchema },
      handler: (args) => guarded(() => service.findOne(args["id"] as Id)),
    },
    {
      tool: {
        name: `${prefix}_findMany`,
        description: `List ${name} records, with optional pagination, sort, and filter.`,
        inputSchema: objectSchema(
          {
            limit: { type: "integer" },
            offset: { type: "integer" },
            sort: { type: "array", items: { type: "string" } },
            filter: { type: "object" },
          },
          [],
        ),
      },
      handler: (args) =>
        guarded(() =>
          service.findMany({
            limit: args["limit"] as number | undefined,
            offset: args["offset"] as number | undefined,
            sort: parseSortArg(args["sort"] as readonly string[] | undefined),
            filter: (args["filter"] as never) ?? null,
          } as never),
        ),
    },
    {
      tool: { name: `${prefix}_createOne`, description: `Create a new ${name}.`, inputSchema: freeformObjectSchema },
      handler: (args) => guarded(() => service.createOne(args as CreateDto)),
    },
    {
      tool: {
        name: `${prefix}_updateOne`,
        description: `Replace an existing ${name} by id.`,
        inputSchema: idAndFreeformSchema,
      },
      handler: (args) => {
        const { id, ...input } = args;
        return guarded(() => service.updateOne(id as Id, input as UpdateDto));
      },
    },
    {
      tool: {
        name: `${prefix}_patchOne`,
        description: `Partially update an existing ${name} by id.`,
        inputSchema: idAndFreeformSchema,
      },
      handler: (args) => {
        const { id, ...input } = args;
        return guarded(() => service.patchOne(id as Id, input as PatchDto));
      },
    },
    {
      tool: { name: `${prefix}_deleteOne`, description: `Delete a ${name} by id.`, inputSchema: idOnlySchema },
      handler: (args) =>
        guarded(async () => {
          await service.deleteOne(args["id"] as Id);
          return { deleted: true };
        }),
    },
    {
      tool: {
        name: `${prefix}_restoreOne`,
        description: `Restore a soft-deleted ${name} by id.`,
        inputSchema: idOnlySchema,
      },
      handler: (args) => guarded(() => service.restoreOne(args["id"] as Id)),
    },
    {
      tool: {
        name: `${prefix}_purgeOne`,
        description: `Permanently delete a soft-deleted ${name} by id.`,
        inputSchema: idOnlySchema,
      },
      handler: (args) =>
        guarded(async () => {
          await service.purgeOne(args["id"] as Id);
          return { purged: true };
        }),
    },
  ];
}
