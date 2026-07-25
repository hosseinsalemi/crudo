import { createRequire } from "node:module";
import type { ClassRef, DtoResolver, EntityConfig, OperationDescriptor, OperationDtoMap } from "@crudo/core";
import { DefaultDtoResolver } from "@crudo/core";
import type { CrudHttpMethod } from "./operation-metadata.js";
import { isSchemaHint, readSchemaHint, type SchemaHint } from "./schema-hints.js";

interface RouteShape {
  readonly method: CrudHttpMethod;
  readonly path: string;
  readonly status: number;
  readonly hasIdParam: boolean;
}

type SwaggerModule = {
  ApiOperation(options: object): MethodDecorator;
  ApiParam(options: object): MethodDecorator;
  ApiQuery(options: object): MethodDecorator;
  ApiBody(options: object): MethodDecorator;
  ApiResponse(options: object): MethodDecorator;
};

let cached: SwaggerModule | null | undefined;

/**
 * `@nestjs/swagger` is an *optional* peer: when it is installed, generated
 * routes are documented (operation ids, the `:id` param, the Phase 5 query
 * params on list routes, registered DTO classes as body schemas, and the
 * problem-details error responses from the Phase 6 catalog); when it is
 * not, this whole module is a no-op — Crudo never forces the dependency.
 */
function loadSwagger(): SwaggerModule | null {
  if (cached !== undefined) return cached;
  try {
    const require = createRequire(import.meta.url);
    cached = require("@nestjs/swagger") as SwaggerModule;
  } catch {
    cached = null;
  }
  return cached;
}

const PROBLEM_DETAILS_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", example: "https://crudo.dev/errors/crudo-not-found" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    code: { type: "string", example: "CRUDO_NOT_FOUND" },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          code: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
  },
} as const;

const LIST_QUERY_PARAMS: readonly { name: string; description: string }[] = [
  {
    name: "filter",
    description:
      "Filter conditions: filter[field][operator]=value (operators: eq, ne, " +
      "gt, gte, lt, lte, in, notIn, like, ilike, between, isNull, " +
      "isNotNull; or/and/not groups; JSON escape hatch via filter={...}).",
  },
  { name: "sort", description: "Comma-separated fields; '-' prefix = descending." },
  { name: "limit", description: "Page size (clamped to the configured maximum)." },
  { name: "offset", description: "Zero-based index of the first returned row." },
  { name: "fields", description: "Sparse fieldset: comma-separated field names." },
];

export function applySwaggerMetadata(
  prototype: Record<string, unknown>,
  methodName: string,
  descriptor: OperationDescriptor<object>,
  route: RouteShape,
  entity: ClassRef,
  config: EntityConfig<object> | undefined,
): void {
  const swagger = loadSwagger();
  if (swagger === null) return;

  const propertyDescriptor = Object.getOwnPropertyDescriptor(prototype, methodName) as PropertyDescriptor;
  const apply = (decorator: MethodDecorator): void => {
    decorator(prototype, methodName, propertyDescriptor);
  };

  apply(
    swagger.ApiOperation({
      operationId: `${entity.name}_${descriptor.id}`,
      summary: `${descriptor.id} (${entity.name})`,
    }),
  );

  if (route.hasIdParam) {
    apply(swagger.ApiParam({ name: "id", required: true }));
  }

  if (descriptor.id === "findMany") {
    for (const param of LIST_QUERY_PARAMS) {
      apply(
        swagger.ApiQuery({
          name: param.name,
          required: false,
          type: String,
          description: param.description,
        }),
      );
    }
  }

  // Includes are documented from the entity config's relation allowlist —
  // the only relation knowledge decoration time has (ADR-0012). `findOne`
  // supports `include` with identical semantics, so it is documented too.
  if (descriptor.id === "findMany" || descriptor.id === "findOne") {
    const includable = includableRelations(config);
    apply(
      swagger.ApiQuery({
        name: "include",
        required: false,
        type: String,
        description:
          includable.length === 0
            ? "Relation paths to embed. No relation is includable on this entity."
            : `Comma-separated relation paths to embed, dot-separated for nesting. ` +
              `Includable: ${includable.join(", ")}.`,
      }),
    );
    for (const relation of includable) {
      apply(
        swagger.ApiQuery({
          name: `fields[${relation}]`,
          required: false,
          type: String,
          description: `Sparse fieldset for the included '${relation}' node.`,
        }),
      );
    }
  }

  // The slot fallbacks (`patch`→`update`, `list`→`item`) belong to the core
  // resolver, not to this file: documenting a shape the engine would not
  // actually use is a lie that no test would catch. The resolver needs only
  // the DTO map, so it is legal at decoration time (ADR-0012).
  const dtoResolver = new DefaultDtoResolver(config?.dto as OperationDtoMap<object> | undefined);

  const bodyDto = bodyDtoFor(descriptor, dtoResolver);
  if (bodyDto !== null) {
    apply(swagger.ApiBody(bodyOptionsFor(bodyDto)));
  }

  apply(
    swagger.ApiResponse({
      status: route.status,
      description: "Success",
      ...successBodyFor(descriptor, route, entity, dtoResolver),
    }),
  );
  apply(
    swagger.ApiResponse({
      status: 400,
      description: "Query validation failed (RFC 9457 problem details).",
      schema: PROBLEM_DETAILS_SCHEMA,
    }),
  );
  if (route.hasIdParam) {
    apply(
      swagger.ApiResponse({
        status: 404,
        description: "Not found (RFC 9457 problem details).",
        schema: PROBLEM_DETAILS_SCHEMA,
      }),
    );
  }
  if (descriptor.id === "restoreOne" || descriptor.id === "purgeOne") {
    apply(
      swagger.ApiResponse({
        status: 409,
        description: "The row is not deleted (RFC 9457 problem details).",
        schema: PROBLEM_DETAILS_SCHEMA,
      }),
    );
  }
}

/**
 * Choose how `@ApiBody` documents a DTO. Crudo DTOs carry their shape in
 * runtime field initializers (no `@ApiProperty` decorators, by design), and
 * `@nestjs/swagger` cannot read those — passing `{ type }` alone yields an
 * empty schema, so the request body renders with no fields. When a fresh
 * instance exposes own enumerable properties we build an explicit JSON
 * schema from them; when it does not (a `@ApiProperty`-decorated or purely
 * declarative class) we defer to Swagger's own `{ type }` introspection.
 */
function bodyOptionsFor(bodyDto: ClassRef): object {
  const schema = schemaFromDto(bodyDto);
  if (schema === null) return { type: bodyDto };
  return { schema: { title: bodyDto.name, ...schema } };
}

/**
 * The success-response schema for a generated route, derived from the
 * resolved response DTO the same way request bodies are (runtime shape →
 * explicit JSON schema; decorated/declarative classes fall back to
 * Swagger's own `{ type }` introspection). Single-item operations document
 * the `item` DTO (or the entity when no `item` slot is registered);
 * `findMany` wraps the `list` element in Crudo's list envelope. `deleteOne`
 * (204) and everything else keep the description-only response.
 */
function successBodyFor(
  descriptor: OperationDescriptor<object>,
  route: RouteShape,
  entity: ClassRef,
  dtoResolver: DtoResolver<object>,
): object {
  if (route.status === 204) return {};
  const resolve = (slot: "item" | "list"): ClassRef =>
    (dtoResolver.resolve(slot, descriptor.id) as ClassRef | null) ?? entity;
  switch (descriptor.id) {
    case "createOne":
    case "updateOne":
    case "patchOne":
    case "findOne":
    // Restore reuses the `item` slot — no dedicated restore shape.
    case "restoreOne": {
      const itemDto = resolve("item");
      const schema = schemaFromDto(itemDto);
      return schema === null ? { type: itemDto } : { schema: { title: itemDto.name, ...schema } };
    }
    case "findMany": {
      // `list` falls back to `item` inside the resolver.
      const listDto = resolve("list");
      const element = schemaFromDto(listDto);
      return { schema: listEnvelopeSchema(element, listDto.name) };
    }
    default:
      return {};
  }
}

/** The Phase 4 list envelope, wrapping the resolved list-element schema. */
function listEnvelopeSchema(
  element: { type: "object"; properties: Record<string, object> } | null,
  title: string,
): object {
  return {
    title: `${title}List`,
    type: "object",
    properties: {
      items: {
        type: "array",
        items: element ?? { type: "object" },
      },
      limit: { type: "integer" },
      offset: { type: "integer" },
      total: { type: "integer", nullable: true },
      meta: { type: "object" },
    },
  };
}

function schemaFromDto(bodyDto: ClassRef): { type: "object"; properties: Record<string, object> } | null {
  let instance: Record<string, unknown>;
  try {
    instance = new (bodyDto as new () => Record<string, unknown>)();
  } catch {
    return null;
  }
  const keys = Object.keys(instance);
  if (keys.length === 0) return null;
  const properties: Record<string, object> = {};
  for (const key of keys) {
    properties[key] = jsonSchemaForValue(instance[key]);
  }
  return { type: "object", properties };
}

/** Infer a JSON-schema fragment from a DTO field's initializer value. */
function jsonSchemaForValue(value: unknown): object {
  if (isSchemaHint(value)) return schemaForHint(readSchemaHint(value));
  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "bigint":
      return { type: "integer" };
    case "object":
      if (value instanceof Date) return { type: "string", format: "date-time" };
      if (Array.isArray(value)) return { type: "array", items: {} };
      if (value !== null) return { type: "object" };
      return {};
    default:
      return {};
  }
}

/** Expand a schema hint (enum / oneOf array) into its OpenAPI fragment. */
function schemaForHint(hint: SchemaHint): object {
  switch (hint.kind) {
    case "enum":
      return {
        type: hint.numeric ? "number" : "string",
        enum: [...hint.values],
        ...(hint.example !== undefined ? { example: hint.example } : {}),
      };
    case "oneOfArray":
      return {
        type: "array",
        items: {
          oneOf: hint.variants.map((variant) => {
            const schema = schemaFromDto(variant);
            return schema === null ? { type: "object" } : { title: variant.name, ...schema };
          }),
        },
      };
  }
}

/** Relation names this entity's config opens to `include=` (Phase 15). */
function includableRelations(config: EntityConfig<object> | undefined): readonly string[] {
  const edges = (config as { relations?: { edges?: Record<string, { includable?: boolean }> } } | undefined)?.relations
    ?.edges;
  if (edges === undefined) return [];
  return Object.entries(edges)
    .filter(([, edge]) => edge.includable !== false)
    .map(([name]) => name);
}

function bodyDtoFor(descriptor: OperationDescriptor<object>, dtoResolver: DtoResolver<object>): ClassRef | null {
  if (descriptor.input !== null) return descriptor.input as ClassRef;
  const resolve = (slot: "create" | "update" | "patch"): ClassRef | null =>
    dtoResolver.resolve(slot, descriptor.id) as ClassRef | null;
  switch (descriptor.id) {
    case "createOne":
      return resolve("create");
    case "updateOne":
      return resolve("update");
    case "patchOne":
      // `patch` falls back to `update` inside the resolver.
      return resolve("patch");
    default:
      return null;
  }
}
