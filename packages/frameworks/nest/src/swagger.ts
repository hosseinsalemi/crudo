import { createRequire } from "node:module";
import type { ClassRef, EntityConfig, OperationDescriptor } from "@crudo/core";
import type { CrudHttpMethod } from "./operation-metadata.js";

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

  const propertyDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    methodName,
  ) as PropertyDescriptor;
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

  const bodyDto = bodyDtoFor(descriptor, config);
  if (bodyDto !== null) {
    apply(swagger.ApiBody({ type: bodyDto }));
  }

  apply(swagger.ApiResponse({ status: route.status, description: "Success" }));
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
}

function bodyDtoFor(
  descriptor: OperationDescriptor<object>,
  config: EntityConfig<object> | undefined,
): ClassRef | null {
  if (descriptor.input !== null) return descriptor.input as ClassRef;
  const dto = config?.dto;
  if (dto === undefined) return null;
  switch (descriptor.id) {
    case "createOne":
      return (dto.create as ClassRef | undefined) ?? null;
    case "updateOne":
      return (dto.update as ClassRef | undefined) ?? null;
    case "patchOne":
      return (
        (dto.patch as ClassRef | undefined) ??
        (dto.update as ClassRef | undefined) ??
        null
      );
    default:
      return null;
  }
}
