import type { ClassRef, EntityInput } from "./types/utility.js";
import type { CrudInfrastructure, EntityMetadata } from "./metadata/entity-metadata.js";
import type { EntityConfig } from "./config/entity-config.js";
import type { EntityId } from "./types/entity-id.js";
import type { GlobalConfig } from "./config/global-config.js";
import type { PaginationStrategy } from "./query/pagination.js";
import type { QueryContext } from "./query/query-context.js";
import type { RepositoryAdapter } from "./persistence/repository-adapter.js";
import { CrudEngine } from "./engine/crud-engine.js";
import { ConfigurationException } from "./errors/exceptions.js";
import { DefaultCrudService } from "./service/default-crud-service.js";
import { DefaultErrorHandler } from "./errors/default-error-handler.js";
import {
  DefaultDeserializer,
  DefaultSerializer,
} from "./serialization/default-serializer.js";
import { QueryNormalizer } from "./query/query-normalizer.js";
import { builtInHandlers } from "./engine/built-in-handlers.js";
import { createOperationRegistry } from "./operations/default-operation-registry.js";
import {
  describeResolvedConfig,
  resolveEntityConfig,
} from "./config/resolve-entity-config.js";
import { STANDARD_OPERATIONS } from "./operations/default-operation-registry.js";

/**
 * Root-factory options (Phase 8). `GlobalConfig.defaults` is the
 * framework-scope link of the precedence chain; `infrastructure` is how an
 * ORM package plugs in (`createTypeOrmInfrastructure(dataSource)`) without
 * core ever importing it.
 */
export interface CrudoOptions extends GlobalConfig {
  readonly infrastructure?: CrudInfrastructure;
  /** Custom pagination strategies, addressable via `pagination.strategy`. */
  readonly paginationStrategies?: readonly PaginationStrategy[];
}

/** Per-entity overrides of what the root `infrastructure` would supply. */
export interface CrudRuntime<Entity extends object> {
  readonly adapter?: RepositoryAdapter<Entity>;
  readonly metadata?: EntityMetadata<Entity>;
}

/**
 * A Crudo root instance: one merged global scope plus the entity registry
 * built from it. `createCrud` is the only way entities enter the system;
 * everything it resolves (config, DTOs, registry) happens at that call —
 * bootstrap — and is frozen after.
 */
export interface CrudoInstance {
  createCrud<
    Entity extends object,
    CreateDto = EntityInput<Entity>,
    UpdateDto = EntityInput<Entity>,
    PatchDto = Partial<UpdateDto>,
    QueryDto = QueryContext<Entity>,
    ItemDto = Entity,
    ListDto = ItemDto,
  >(
    entity: ClassRef<Entity>,
    config?: EntityConfig<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>,
    runtime?: CrudRuntime<Entity>,
  ): DefaultCrudService<Entity, EntityId, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>;

  /** Phase 8 debug dump: resolved configuration for one registered entity. */
  describe(entityName: string): Record<string, unknown> | undefined;
}

/**
 * Create a Crudo root instance (Phase 8's `createCrudo`). The zero-config
 * path is `createCrudo({ infrastructure }).createCrud(Entity)` — built-in
 * defaults, derived DTOs and allowlists, standard operations.
 */
export function createCrudo(options: CrudoOptions = {}): CrudoInstance {
  const registered = new Map<string, Record<string, unknown>>();

  return {
    createCrud(entity, config, runtime) {
      type Entity = InstanceType<typeof entity> & object;
      const metadata =
        runtime?.metadata ?? options.infrastructure?.metadataFor(entity);
      if (metadata === undefined) {
        throw new ConfigurationException(
          entity.name,
          "infrastructure",
          "no metadata source: pass `infrastructure` to createCrudo " +
            "(e.g. createTypeOrmInfrastructure(dataSource) from " +
            "@crudo/typeorm) or `runtime.metadata` to createCrud",
        );
      }
      const adapter =
        runtime?.adapter ?? options.infrastructure?.adapterFor(entity);
      if (adapter === undefined) {
        throw new ConfigurationException(
          metadata.name,
          "infrastructure",
          "no repository adapter: pass `infrastructure` to createCrudo or " +
            "`runtime.adapter` to createCrud",
        );
      }

      const resolved = resolveEntityConfig<Entity>(
        metadata as EntityMetadata<Entity>,
        config as EntityConfig<Entity> | undefined,
        options.defaults,
      );
      const engine = new CrudEngine<Entity>({
        metadata: metadata as EntityMetadata<Entity>,
        config: resolved,
        registry: createOperationRegistry<Entity>(
          config as EntityConfig<Entity> | undefined,
          builtInHandlers(adapter as unknown as RepositoryAdapter<Entity>),
        ),
        serializer: new DefaultSerializer(metadata as EntityMetadata<Entity>),
        deserializer: new DefaultDeserializer(
          metadata as EntityMetadata<Entity>,
        ),
        normalizer: new QueryNormalizer(
          metadata as EntityMetadata<Entity>,
          options.paginationStrategies ?? [],
        ),
        errorHandler: new DefaultErrorHandler(),
      });

      registered.set(
        resolved.entityName,
        describeResolvedConfig(resolved, Object.keys(STANDARD_OPERATIONS)),
      );
      return new DefaultCrudService(engine) as never;
    },

    describe(entityName) {
      return registered.get(entityName);
    },
  };
}

/**
 * The bare zero-config path (Phase 8): `createCrud(Entity, config?,
 * runtime)` — an implicit root instance with built-in defaults. At the
 * core level the runtime (adapter + metadata) must be explicit, because
 * core has no ORM to derive them from; `@crudo/typeorm`'s
 * `createTypeOrmCrudo` is the sugar that makes it disappear.
 */
export function createCrud<
  Entity extends object,
  CreateDto = EntityInput<Entity>,
  UpdateDto = EntityInput<Entity>,
  PatchDto = Partial<UpdateDto>,
  QueryDto = QueryContext<Entity>,
  ItemDto = Entity,
  ListDto = ItemDto,
>(
  entity: ClassRef<Entity>,
  config?: EntityConfig<Entity, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto>,
  runtime?: CrudRuntime<Entity>,
): DefaultCrudService<Entity, EntityId, CreateDto, UpdateDto, PatchDto, QueryDto, ItemDto, ListDto> {
  return createCrudo().createCrud(entity, config, runtime);
}
