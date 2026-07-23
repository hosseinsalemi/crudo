import type { ClassRef, CrudContext, EntityId, NormalizedQueryContext, RepositoryAdapter } from "@crudo/core";
import { NotFoundException } from "@crudo/core";
import type { DataSource, DeepPartial, ObjectLiteral, Repository, SelectQueryBuilder } from "typeorm";
import { FilterTranslator } from "./filter-translator.js";
import { mapDriverError } from "./error-mapping.js";

/**
 * `RepositoryAdapter` over a TypeORM `Repository` (Phases 9–10, skeleton
 * scope: CRUD with hard delete, filtering, sorting, pagination,
 * optional counting).
 *
 * API split, as decided in Phase 9: the **QueryBuilder API** serves every
 * read — it is the only surface that can express the translated filter
 * AST, relation-path joins, and skip/take — while the **Repository API**
 * serves writes, where entity hydration and column defaults matter and no
 * dynamic SQL is needed.
 *
 * Attachment seams for later phases: transactions pick up
 * `context.transaction` (Phase 13), soft delete branches in
 * `delete`/`restore`/`purge` and the query methods' `withDeleted`
 * (Phase 15), include loading extends `buildQuery` (Phase 16).
 */
export class TypeOrmRepositoryAdapter<Entity extends ObjectLiteral> implements RepositoryAdapter<Entity> {
  private readonly repository: Repository<Entity>;
  private readonly alias: string;
  private readonly idField: string;

  constructor(dataSource: DataSource, entity: ClassRef<Entity>) {
    this.repository = dataSource.getRepository(entity);
    const metadata = dataSource.getMetadata(entity);
    this.alias = metadata.name;
    this.idField = metadata.primaryColumns[0]!.propertyName;
  }

  // ── Reads (QueryBuilder API) ────────────────────────────────────────

  async findOneById(
    id: EntityId,
    _query: NormalizedQueryContext<Entity> | null,
    context: CrudContext<Entity>,
  ): Promise<Entity | null> {
    try {
      const qb = this.repository.createQueryBuilder(this.alias).where(`${this.alias}.${this.idField} = :id`, { id });
      return await qb.getOne();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async findOne(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<Entity | null> {
    try {
      return await this.buildQuery(query).take(1).getOne();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async findMany(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<readonly Entity[]> {
    try {
      return await this.buildQuery(query).skip(query.pagination.offset).take(query.pagination.limit).getMany();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async count(query: NormalizedQueryContext<Entity>, context: CrudContext<Entity>): Promise<number> {
    try {
      // A dedicated count query — never getManyAndCount: the engine only
      // calls this when `query.count` is true, so `total: null` costs
      // zero queries (Phase 9 count strategy).
      return await this.buildQuery(query, { sorted: false }).getCount();
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  /** Shared read pipeline: filter joins + WHERE, then ORDER BY. */
  private buildQuery(
    query: NormalizedQueryContext<Entity>,
    options: { sorted?: boolean } = {},
  ): SelectQueryBuilder<Entity> {
    const qb = this.repository.createQueryBuilder(this.alias);
    const translator = new FilterTranslator(qb, this.alias);
    translator.apply(query.filter);
    if (options.sorted !== false) {
      for (const sort of query.sort) {
        qb.addOrderBy(translator.columnRef(sort.field as string), sort.direction === "desc" ? "DESC" : "ASC");
      }
    }
    return qb;
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
      const existing = await this.repository.findOneBy({
        [this.idField]: id,
      } as never);
      if (existing === null) throw this.notFound(id, context);
      this.repository.merge(existing, data as never);
      return await this.repository.save(existing);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async delete(id: EntityId, context: CrudContext<Entity>): Promise<void> {
    try {
      // Hard delete — the strategy branch (soft when SoftDeletable) is
      // Phase 15's attachment point.
      const result = await this.repository.delete(id);
      if (result.affected === 0) throw this.notFound(id, context);
    } catch (error) {
      throw mapDriverError(error, errorContext(context));
    }
  }

  async restore(id: EntityId, context: CrudContext<Entity>): Promise<Entity> {
    throw mapDriverError(new Error("restore requires soft delete (Phase 15)"), errorContext(context));
  }

  async purge(id: EntityId, context: CrudContext<Entity>): Promise<void> {
    throw mapDriverError(new Error("purge requires soft delete (Phase 15)"), errorContext(context));
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
