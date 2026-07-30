import type { ClassRef, EntityMetadata, FieldKind, FieldMetadata, RelationDescriptor } from "@kavo/core";
import { ConfigurationException } from "@kavo/core";
import type { DataSource } from "typeorm";
import type { ColumnMetadata } from "typeorm/metadata/ColumnMetadata.js";

/**
 * Translate TypeORM's column type (a constructor or a driver type string)
 * into the ORM-independent `FieldKind` core coerces against. Unrecognized
 * driver strings degrade to `string` — comparison still works, coercion
 * just doesn't narrow.
 */
function fieldKindOf(column: ColumnMetadata): FieldKind {
  if (column.type === Number) return "number";
  if (column.type === String) return "string";
  if (column.type === Boolean) return "boolean";
  if (column.type === Date) return "date";
  const type = String(column.type).toLowerCase();
  if (type === "enum" || type === "simple-enum") return "enum";
  if (
    /^(int|integer|tinyint|smallint|mediumint|bigint|float|double|double precision|real|decimal|numeric|number)$/.test(
      type,
    )
  ) {
    return "number";
  }
  if (/^(bool|boolean)$/.test(type)) return "boolean";
  if (/^(date|datetime|timestamp|timestamptz|time)($| )/.test(type)) return "date";
  if (/^(json|jsonb|simple-json)$/.test(type)) return "json";
  return "string";
}

/**
 * Build the core `EntityMetadata` for one entity from the DataSource's
 * TypeORM metadata: the adapter feeds core's metadata seam; core
 * never sees TypeORM types.
 */
export function buildEntityMetadata<Entity extends object>(
  dataSource: DataSource,
  entity: ClassRef<Entity>,
): EntityMetadata<Entity> {
  const metadata = dataSource.getMetadata(entity);

  if (metadata.primaryColumns.length !== 1) {
    throw new ConfigurationException(
      metadata.name,
      "primaryColumns",
      `Kavo v6 requires exactly one primary column; found ${metadata.primaryColumns.length}`,
    );
  }
  const primary = metadata.primaryColumns[0]!;

  const fields: FieldMetadata[] = metadata.columns
    .filter((column) => column.relationMetadata === undefined)
    .map((column) => ({
      name: column.propertyName,
      kind: fieldKindOf(column),
      nullable: column.isNullable,
      generated:
        column.isGenerated || column.isCreateDate || column.isUpdateDate || column.isDeleteDate || column.isVersion,
      ...(column.enum !== undefined && {
        enumValues: column.enum.map((value) => String(value)),
      }),
    }));

  const relations: RelationDescriptor[] = metadata.relations.map((relation) => ({
    name: relation.propertyName,
    // The *resolved* target class, not `relation.type`: a string-target
    // relation (`@ManyToOne("Owner", …)`, the form that keeps import
    // cycles off the runtime graph) leaves `type` as the entity name, and
    // core matches registered entities by class identity.
    target: () => relation.inverseEntityMetadata.target as ClassRef,
    cardinality: relation.isOneToMany || relation.isManyToMany ? "many" : "one",
    // Inclusion is an opt-in allowlist; ORM metadata only
    // supplies shape, never permission.
    includable: false,
    strategy: "auto",
  }));

  return {
    entity,
    name: metadata.name,
    idField: primary.propertyName,
    fields,
    relations,
    // `@DeleteDateColumn` detection: the ORM's own declaration
    // is what makes zero-config soft delete work. Explicit
    // `softDelete.field` config still wins over it — core decides, this
    // only reports.
    softDeleteField: metadata.deleteDateColumn?.propertyName ?? null,
  };
}
