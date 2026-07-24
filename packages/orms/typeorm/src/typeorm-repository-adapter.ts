import type {
  ClassRef,
  CrudContext,
  EntityId,
  NormalizedQueryContext,
  RepositoryAdapter,
  ResolvedSoftDelete,
} from "@crudo/core";
import { AlreadyDeletedException, ConfigurationException, NotDeletedException, NotFoundException } from "@crudo/core";
import type { DataSource, DeepPartial, ObjectLiteral, Repository, SelectQueryBuilder } from "typeorm";
import { FilterTranslator } from "./filter-translator.js";
import { mapDriverError } from "./error-mapping.js";

/**
 * `RepositoryAdapter` over a TypeORM `Repository` (Phases 9–10, plus
 * Phase 14 soft delete): CRUD with hard *or* soft delete, restore, purge,
 * filtering, sorting, pagination, optional counting.
 *
 * API split, as decided in Phase 9: the **QueryBuilder API** serves every
 * read — it is the only surface that can express the translated filter
 * AST, relation-path joins, and skip/take — while the **Repository API**
 * serves writes, where entity hydration and column defaults matter and no
 * dynamic SQL is needed.
 *
 * Attachment seams for later phases: transactions pick up
 * `context.transaction`, include loading extends `buildQuery` (Phase 15).
 */
export class TypeOrmRepositoryAdapter<Entity extends ObjectLiteral> implements RepositoryAdapter<Entity> {
  private readonly repository: Repository<Entity>;
  private readonly alias: string;
  private readonly idField: string;
  /**
   * The `@DeleteDateColumn` property, when the entity declares one. It is
   * what decides *how* a soft delete is written: TypeORM's own
   * `softDelete`/`restore` (which also stamp `@UpdateDateColumn` and know
   * about the default exclusion) for the declared column, a plain column
   * write for a `softDelete.field` that is an ordinary column.
   */
  private readonly deleteDateColumn: string | null;

  constructor(dataSource: DataSource, entity: ClassRef<Entity>) {
    this.repository = dataSource.getRepository(entity);
    const metadata = dataSource.getMetadata(entity);
    this.alias = metadata.name;
    this.idField = metadata.primaryColumns[0]!.propertyName;
    this.deleteDateColumn = metadata.deleteDateColumn?.propertyName ?? null;
  }

  // ── Reads (QueryBuilder API) ────────────────────────────────────────

  async findOneById(
    id: EntityId,
    query: NormalizedQueryContext<Entity> | null,
    context: CrudContext<Entity>,
  ): Promise<Entity | null> {
    try {
      return await this.byId(id, context, query?.withDeleted ?? false).getOne();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async findOne(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<Entity | null> {
    try {
      return await this.buildQuery(query, context).take(1).getOne();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async findMany(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<readonly Entity[]> {
    try {
      return await this.buildQuery(query, context).skip(query.pagination.offset).take(query.pagination.limit).getMany();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async count(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<number> {
    try {
      // A dedicated count query — never getManyAndCount: the engine only
      // calls this when `query.count` is true, so `total: null` costs
      // zero queries (Phase 9 count strategy).
      return await this.buildQuery(query, context, { sorted: false }).getCount();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  /**
   * Shared read pipeline: soft-delete scope, filter joins + WHERE, then
   * ORDER BY.
   */
  private buildQuery(
    query: NormalizedQueryContext<Entity>,
    context: CrudContext<Entity>,
    options: { sorted?: boolean } = {},
  ): SelectQueryBuilder<Entity> {
    const qb = this.repository.createQueryBuilder(this.alias);
    this.scopeToLive(qb, context, query.withDeleted);
    const translator = new FilterTranslator(qb, this.alias);
    translator.apply(query.filter);
    if (options.sorted !== false) {
      for (const sort of query.sort) {
        qb.addOrderBy(translator.columnRef(sort.field as string), sort.direction === "desc" ? "DESC" : "ASC");
      }
    }
    return qb;
  }

  // ── Soft delete (Phase 14) ──────────────────────────────────────────

  /**
   * Exclude soft-deleted rows unless the caller opted in with
   * `withDeleted`. Two shapes, one rule: TypeORM already excludes its own
   * `@DeleteDateColumn` (so opting *in* is the explicit step), while an
   * ordinary marker column needs the `IS NULL` predicate spelled out.
   * Entities that aren't soft-deletable touch neither branch.
   */
  private scopeToLive(qb: SelectQueryBuilder<Entity>, context: CrudContext<Entity>, withDeleted: boolean): void {
    const softDelete = context.config.softDelete;
    if (softDelete.strategy !== "soft") return;
    if (softDelete.field === this.deleteDateColumn) {
      if (withDeleted) qb.withDeleted();
      return;
    }
    if (!withDeleted) qb.andWhere(`${this.alias}.${softDelete.field} IS NULL`);
  }

  private byId(id: EntityId, context: CrudContext<Entity>, withDeleted: boolean): SelectQueryBuilder<Entity> {
    const qb = this.repository.createQueryBuilder(this.alias).where(`${this.alias}.${this.idField} = :id`, { id });
    this.scopeToLive(qb, context, withDeleted);
    return qb;
  }

  /** The resolved strategy, refused when an operation requires soft. */
  private requireSoftDelete(context: CrudContext<Entity>, operation: string): ResolvedSoftDelete & { field: string } {
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

  private isDeleted(row: Entity, field: string): boolean {
    return row[field] !== null && row[field] !== undefined;
  }

  // ── Writes (Repository API) ─────────────────────────────────────────

  async create(data: Partial<Entity>, context: CrudContext<Entity>): Promise<Entity> {
    try {
      const entity = this.repository.create(data as DeepPartial<Entity>);
      return await this.repository.save(entity);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async update(id: EntityId, data: Partial<Entity>, context: CrudContext<Entity>): Promise<Entity> {
    return this.mergeAndSave(id, data, context);
  }

  async patch(id: EntityId, data: Partial<Entity>, context: CrudContext<Entity>): Promise<Entity> {
    return this.mergeAndSave(id, data, context);
  }

  /**
   * update and patch share one load-merge-save primitive: the *shape* of
   * `data` differs (full body vs. sparse) because the DTO layer differs,
   * not the persistence mechanics.
   */
  private async mergeAndSave(id: EntityId, data: Partial<Entity>, context: CrudContext<Entity>): Promise<Entity> {
    try {
      // Scoped to live rows: a soft-deleted row is invisible to updates,
      // exactly as it is to reads. Reviving one is `restore`'s job.
      const existing = await this.byId(id, context, false).getOne();
      if (existing === null) throw this.notFound(id, context);
      this.repository.merge(existing, data as never);
      return await this.repository.save(existing);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async delete(id: EntityId, context: CrudContext<Entity>): Promise<void> {
    const softDelete = context.config.softDelete;
    try {
      if (softDelete.strategy === "hard") {
        const result = await this.repository.delete(id);
        if (result.affected === 0) throw this.notFound(id, context);
        return;
      }
      const { field } = softDelete;
      const existing = await this.byId(id, context, true).getOne();
      if (existing === null) throw this.notFound(id, context);
      if (this.isDeleted(existing, field)) {
        throw new AlreadyDeletedException({
          messageParams: { entity: context.entityName, id: String(id) },
          context: errorContext(context),
        });
      }
      if (field === this.deleteDateColumn) {
        await this.repository.softDelete(id);
      } else {
        await this.repository.update(id, { [field]: new Date() } as never);
      }
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async restore(id: EntityId, context: CrudContext<Entity>): Promise<Entity> {
    try {
      const { field } = this.requireSoftDelete(context, "restore");
      const existing = await this.byId(id, context, true).getOne();
      if (existing === null) throw this.notFound(id, context);
      if (!this.isDeleted(existing, field)) {
        throw new NotDeletedException({
          messageParams: { entity: context.entityName, id: String(id) },
          context: errorContext(context),
        });
      }
      if (field === this.deleteDateColumn) {
        await this.repository.restore(id);
      } else {
        await this.repository.update(id, { [field]: null } as never);
      }
      // Re-read rather than mutate the in-memory copy: the row is live
      // again, and the response must reflect what the database holds.
      const restored = await this.byId(id, context, false).getOne();
      if (restored === null) throw this.notFound(id, context);
      return restored;
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async purge(id: EntityId, context: CrudContext<Entity>): Promise<void> {
    const softDelete = context.config.softDelete;
    try {
      if (softDelete.strategy === "soft") {
        // Purge is the second step of a two-step delete: it removes a row
        // that is already soft-deleted, never a live one.
        const existing = await this.byId(id, context, true).getOne();
        if (existing === null) throw this.notFound(id, context);
        if (!this.isDeleted(existing, softDelete.field)) {
          throw new NotDeletedException({
            messageParams: { entity: context.entityName, id: String(id) },
            context: errorContext(context),
          });
        }
      }
      const result = await this.repository.delete(id);
      if (result.affected === 0) throw this.notFound(id, context);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  private notFound(id: EntityId, context: CrudContext<Entity>): NotFoundException {
    return new NotFoundException({
      messageParams: { entity: context.entityName, id: String(id) },
      context: errorContext(context),
    });
  }
}

function errorContext<Entity>(context: CrudContext<Entity>) {
  return {
    entityName: context.entityName,
    operation: context.operation,
    correlationId: context.correlationId,
  };
}
