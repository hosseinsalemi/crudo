import type {
  ClassRef,
  EntityId,
  EntityMetadata,
  IncludeTree,
  KavoContext,
  NormalizedQueryContext,
  RepositoryAdapter,
  ResolvedSoftDelete,
} from "@kavo/core";
import { AlreadyDeletedException, ConfigurationException, NotDeletedException, NotFoundException } from "@kavo/core";
import { wrap, type EntityManager, type MikroORM } from "@mikro-orm/core";
import { mapDriverError } from "./error-mapping.js";
import { translateFilter, type FilterTranslatorOptions, type MikroWhere } from "./filter-translator.js";
import { toPlain, toPlainAll } from "./plain-entity.js";

/**
 * `RepositoryAdapter` over a MikroORM `EntityManager`: CRUD with hard *or*
 * soft delete, restore, purge, filtering, sorting, pagination, optional
 * counting, and nested relation includes.
 *
 * Two things are specific to MikroORM and load-bearing:
 *
 * **Every method forks the EntityManager.** MikroORM is a Unit-of-Work ORM:
 * an `EntityManager` owns an identity map that caches every entity it has
 * loaded, and reusing one across requests would serve stale rows and leak
 * one caller's entities into another's. `orm.em` is the *root* manager and
 * is not meant to be queried directly; `orm.em.fork()` gives each operation
 * a clean, isolated one, which is the same scope a request-scoped
 * `RequestContext` would give a hand-written MikroORM application.
 *
 * **`IncludeNode.strategy` is deliberately ignored**, exactly as in
 * `@kavo/prisma` and unlike `@kavo/typeorm`. The TypeORM adapter translates
 * the join/batch split because it drives a raw SQL query builder, where a
 * to-many `JOIN` multiplies root rows and separate batched queries are how
 * that is avoided. MikroORM resolves `populate` with its own queries and
 * applies `limit`/`offset` to the root regardless of the load strategy, so a
 * to-many include never disturbs pagination here. There is nothing left for
 * the distinction to control, and MikroORM's `strategy` option is per-query
 * rather than per-relation anyway — it could not express a mixed tree.
 */
export class MikroOrmRepositoryAdapter<Entity extends object> implements RepositoryAdapter<Entity> {
  private readonly entity: ClassRef<Entity>;
  private readonly idField: string;
  private readonly filterOptions: FilterTranslatorOptions;
  /**
   * Relation property name → the target entity's primary-key property.
   * Resolved lazily: a bidirectional relation's target may not be registered
   * with MikroORM's metadata storage at the time this adapter is built.
   */
  private readonly relationIdFields: ReadonlyMap<string, () => string>;

  constructor(
    private readonly orm: MikroORM,
    metadata: EntityMetadata<Entity>,
    options: { caseInsensitiveFilters?: boolean } = {},
  ) {
    this.entity = metadata.entity;
    this.idField = metadata.idField;
    this.filterOptions = {
      idField: metadata.idField,
      caseInsensitiveFilters: options.caseInsensitiveFilters ?? false,
    };
    const relationIdFields = new Map<string, () => string>();
    for (const relation of metadata.relations) {
      relationIdFields.set(relation.name, () => {
        const target = this.orm.getMetadata().find(relation.target().name);
        return target?.primaryKeys[0] ?? "id";
      });
    }
    this.relationIdFields = relationIdFields;
  }

  /** A clean, isolated `EntityManager` for one operation — see the class doc. */
  private fork(): EntityManager {
    return this.orm.em.fork();
  }

  // ── Reads ────────────────────────────────────────────────────────────

  async findOneById(
    id: EntityId,
    query: NormalizedQueryContext<Entity> | null,
    context: KavoContext<Entity>,
  ): Promise<Entity | null> {
    try {
      const include = query?.include ?? {};
      const where = this.scopeToLive(
        { [this.idField]: id },
        context,
        query?.withDeleted ?? false,
        query?.onlyDeleted ?? false,
      );
      const row = await this.fork().findOne(this.entity, where as never, this.populateOptions(include) as never);
      return row === null ? null : toPlain(row);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async findOne(query: NormalizedQueryContext<Entity>, context: KavoContext<Entity>): Promise<Entity | null> {
    try {
      const row = await this.fork().findOne(
        this.entity,
        this.buildWhere(query, context) as never,
        this.buildFindOptions(query) as never,
      );
      return row === null ? null : toPlain(row);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async findMany(query: NormalizedQueryContext<Entity>, context: KavoContext<Entity>): Promise<readonly Entity[]> {
    try {
      const rows = await this.fork().find(
        this.entity,
        this.buildWhere(query, context) as never,
        {
          ...this.buildFindOptions(query),
          offset: query.pagination.offset,
          limit: query.pagination.limit,
        } as never,
      );
      return toPlainAll(rows);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async count(query: NormalizedQueryContext<Entity>, context: KavoContext<Entity>): Promise<number> {
    try {
      // A dedicated count query — never fetch-then-length: the engine only
      // calls this when `query.count` is true, so `total: null` costs zero
      // queries. No populate: counting matching roots never needs their
      // relations.
      return await this.fork().count(this.entity, this.buildWhere(query, context) as never);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  /** The translated filter, narrowed to the request's soft-delete scope. */
  private buildWhere(query: NormalizedQueryContext<Entity>, context: KavoContext<Entity>): MikroWhere {
    return this.scopeToLive(
      translateFilter(query.filter, this.filterOptions),
      context,
      query.withDeleted,
      query.onlyDeleted,
    );
  }

  private buildFindOptions(query: NormalizedQueryContext<Entity>): Record<string, unknown> {
    const orderBy = query.sort.map((sort) => nestOrderBy(sort.field as string, sort.direction));
    return {
      ...(orderBy.length > 0 && { orderBy }),
      ...this.populateOptions(query.include),
    };
  }

  // ── Relation includes ───────────────────────────────────────────────

  /**
   * Translate a validated `IncludeTree` into MikroORM's `populate` paths
   * plus, when any included relation is soft-deletable, the `populateWhere`
   * that keeps deleted related rows out.
   *
   * Soft-deleted related rows are excluded from every include, to-one and
   * to-many alike — the same rule `@kavo/typeorm` and `@kavo/prisma` apply.
   * A root `withDeleted` is the root's own opt-in only; it never widens an
   * included relation.
   */
  private populateOptions(tree: IncludeTree): Record<string, unknown> {
    const paths = populatePaths(tree);
    if (paths.length === 0) return {};
    const populateWhere = includeSoftDeleteWhere(tree);
    return {
      populate: paths,
      ...(populateWhere !== undefined && { populateWhere }),
    };
  }

  // ── Soft delete ──────────────────────────────────────────────────────

  /**
   * Three-way soft-delete scope: exclude deleted rows by default, include
   * both live and deleted with `withDeleted`, or restrict to only deleted
   * with `onlyDeleted` (mutually exclusive — validated upstream).
   *
   * There is one shape to handle rather than TypeORM's two: MikroORM
   * declares no delete-date column of its own, so the marker is always an
   * ordinary property and always needs its predicate spelled out.
   */
  private scopeToLive(
    where: MikroWhere | undefined,
    context: KavoContext<Entity>,
    withDeleted: boolean,
    onlyDeleted = false,
  ): MikroWhere {
    const softDelete = context.config.softDelete;
    if (softDelete.strategy !== "soft") return where ?? {};
    if (onlyDeleted) return and(where, { [softDelete.field]: { $ne: null } });
    if (withDeleted) return where ?? {};
    return and(where, { [softDelete.field]: { $eq: null } });
  }

  /** The resolved strategy, refused when an operation requires soft. */
  private requireSoftDelete(context: KavoContext<Entity>, operation: string): ResolvedSoftDelete & { field: string } {
    const softDelete = context.config.softDelete;
    if (softDelete.strategy !== "soft") {
      throw new ConfigurationException(
        context.entityName,
        "softDelete",
        `'${operation}' requires a soft-deletable entity, but '${context.entityName}' ` +
          `resolves to a hard delete strategy`,
      );
    }
    return softDelete;
  }

  private isDeleted(row: Record<string, unknown>, field: string): boolean {
    return row[field] !== null && row[field] !== undefined;
  }

  /** One row by id, as a plain object, under the given soft-delete scope. */
  private async byId(
    id: EntityId,
    context: KavoContext<Entity>,
    withDeleted: boolean,
  ): Promise<Record<string, unknown> | null> {
    const where = this.scopeToLive({ [this.idField]: id }, context, withDeleted);
    const row = await this.fork().findOne(this.entity, where as never);
    return row === null ? null : (toPlain(row) as Record<string, unknown>);
  }

  // ── Writes ───────────────────────────────────────────────────────────

  async create(data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity> {
    try {
      const em = this.fork();
      const created = em.create(this.entity, this.toWriteData(data) as never);
      await em.flush();
      return toPlain(created as Entity);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async update(id: EntityId, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity> {
    return this.mergeAndFlush(id, data, context);
  }

  async patch(id: EntityId, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity> {
    return this.mergeAndFlush(id, data, context);
  }

  /**
   * update and patch share one load-merge-flush primitive: the *shape* of
   * `data` differs (full body vs. sparse) because the DTO layer differs, not
   * the persistence mechanics.
   *
   * This goes through the Unit of Work rather than `nativeUpdate` — one
   * managed entity, assigned and flushed — so lifecycle hooks,
   * `onUpdate` properties, and relation diffing all behave as they would in
   * a hand-written MikroORM application. The row is loaded first anyway, to
   * turn a missing id into `NotFoundException`, so this costs no extra
   * query.
   */
  private async mergeAndFlush(id: EntityId, data: Partial<Entity>, context: KavoContext<Entity>): Promise<Entity> {
    try {
      const em = this.fork();
      // Scoped to live rows: a soft-deleted row is invisible to updates,
      // exactly as it is to reads. Reviving one is `restore`'s job.
      const where = this.scopeToLive({ [this.idField]: id }, context, false);
      const existing = await em.findOne(this.entity, where as never);
      if (existing === null) throw this.notFound(id, context);
      wrap(existing).assign(this.toWriteData(data) as never, { em });
      await em.flush();
      return toPlain(existing);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async delete(id: EntityId, context: KavoContext<Entity>): Promise<void> {
    const softDelete = context.config.softDelete;
    try {
      if (softDelete.strategy === "hard") {
        const affected = await this.fork().nativeDelete(this.entity, { [this.idField]: id } as never);
        if (affected === 0) throw this.notFound(id, context);
        return;
      }
      const { field } = softDelete;
      const existing = await this.byId(id, context, true);
      if (existing === null) throw this.notFound(id, context);
      if (this.isDeleted(existing, field)) {
        throw new AlreadyDeletedException({
          messageParams: { entity: context.entityName, id: String(id) },
          context: errorContext(context),
        });
      }
      await this.fork().nativeUpdate(this.entity, { [this.idField]: id } as never, { [field]: new Date() } as never);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async restore(id: EntityId, context: KavoContext<Entity>): Promise<Entity> {
    try {
      const { field } = this.requireSoftDelete(context, "restore");
      const existing = await this.byId(id, context, true);
      if (existing === null) throw this.notFound(id, context);
      if (!this.isDeleted(existing, field)) {
        throw new NotDeletedException({
          messageParams: { entity: context.entityName, id: String(id) },
          context: errorContext(context),
        });
      }
      await this.fork().nativeUpdate(this.entity, { [this.idField]: id } as never, { [field]: null } as never);
      // Clearing the marker is a single-field write with no relation
      // involvement, so the already-loaded row is corrected in place rather
      // than re-read.
      existing[field] = null;
      return existing as Entity;
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async purge(id: EntityId, context: KavoContext<Entity>): Promise<void> {
    const softDelete = context.config.softDelete;
    try {
      if (softDelete.strategy === "soft") {
        // Purge is the second step of a two-step delete: it removes a row
        // that is already soft-deleted, never a live one.
        const existing = await this.byId(id, context, true);
        if (existing === null) throw this.notFound(id, context);
        if (!this.isDeleted(existing, softDelete.field)) {
          throw new NotDeletedException({
            messageParams: { entity: context.entityName, id: String(id) },
            context: errorContext(context),
          });
        }
      }
      const affected = await this.fork().nativeDelete(this.entity, { [this.idField]: id } as never);
      if (affected === 0) throw this.notFound(id, context);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  /**
   * Normalize the engine's write payload for MikroORM.
   *
   * Core's default deserializer narrows a relation value to `{ id }` (or an
   * array of them) — association by id, ADR-0014. MikroORM associates by
   * *primary key value*, and would read a nested `{ id }` object as a
   * request to create a new entity, so each relation value is unwrapped to
   * the bare key before it reaches `create`/`assign`.
   */
  private toWriteData(data: Partial<Entity>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...data };
    for (const [name, idFieldOf] of this.relationIdFields) {
      if (!(name in result)) continue;
      result[name] = unwrapAssociation(result[name], idFieldOf());
    }
    return result;
  }

  private notFound(id: EntityId, context: KavoContext<Entity>): NotFoundException {
    return new NotFoundException({
      messageParams: { entity: context.entityName, id: String(id) },
      context: errorContext(context),
    });
  }
}

/**
 * `{ id: 5 }` → `5`; arrays element-wise; scalars and `null` unchanged.
 *
 * An object carrying no id becomes `null` rather than being passed through.
 * That mirrors core's own `associate()` exactly, and it matters because core
 * only narrows a relation when the *target* entity is in its catalog — a
 * relation whose target was never `createCrud`-ed arrives here as whatever
 * the client sent. Handing that object to `em.create` would put a nested
 * write one cascade setting away from working, which is precisely what
 * ADR-0014 rules out: relations are associated by id, never deep-written.
 */
function unwrapAssociation(value: unknown, idField: string): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((element) => unwrapAssociation(element, idField));
  if (typeof value === "object") {
    return (value as Record<string, unknown>)[idField] ?? null;
  }
  return value;
}

/** Combine two predicates, keeping `undefined` from degenerating into `{}`. */
function and(where: MikroWhere | undefined, extra: MikroWhere): MikroWhere {
  return where === undefined ? extra : { $and: [where, extra] };
}

/** The include tree flattened to the dotted paths MikroORM's `populate` takes. */
function populatePaths(tree: IncludeTree, prefix = ""): string[] {
  const paths: string[] = [];
  for (const node of Object.values(tree)) {
    const path = prefix === "" ? node.relation.name : `${prefix}.${node.relation.name}`;
    paths.push(path);
    paths.push(...populatePaths(node.children, path));
  }
  return paths;
}

/**
 * The nested `populateWhere` excluding soft-deleted rows from included
 * relations, or `undefined` when no included relation is soft-deletable —
 * MikroORM's default (`PopulateHint.ALL`) is the right behavior then, and
 * passing an empty object would needlessly override it.
 */
function includeSoftDeleteWhere(tree: IncludeTree): Record<string, unknown> | undefined {
  const where: Record<string, unknown> = {};
  for (const node of Object.values(tree)) {
    const children = includeSoftDeleteWhere(node.children);
    const live = node.softDelete.strategy === "soft" ? { [node.softDelete.field]: null } : undefined;
    if (live === undefined && children === undefined) continue;
    where[node.relation.name] = { ...live, ...children };
  }
  return Object.keys(where).length === 0 ? undefined : where;
}

/** `"author.name"` + `"asc"` → `{ author: { name: "asc" } }`. */
function nestOrderBy(field: string, direction: "asc" | "desc"): Record<string, unknown> {
  const segments = field.split(".");
  return segments.slice(0, -1).reduceRight<Record<string, unknown>>((inner, segment) => ({ [segment]: inner }), {
    [segments[segments.length - 1]!]: direction,
  });
}

function errorContext<Entity>(context: KavoContext<Entity>) {
  return {
    entityName: context.entityName,
    operation: context.operation,
    correlationId: context.correlationId,
  };
}
