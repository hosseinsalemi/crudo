export {
  createCrudGraphQLSchema,
  mergeCrudGraphQLSchemas,
  type CrudGraphQLOptions,
  type BoundCrudService,
} from "./schema.js";
export { registerCrudGraphQLTypes, getCrudGraphQLTypes, type CrudGraphQLTypes } from "./registry.js";
export { resolveCrudGraphQLSchema, type CrudEntityRef } from "./discovery.js";
export { GraphQLJSON } from "./json-scalar.js";
