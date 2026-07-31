import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ConfigurationException } from "@kavo/core";
import { buildEntityMetadata, createPrismaInfrastructure, type PrismaDatamodel } from "@kavo/prisma";
import { newTestPrismaClient } from "./support/client.js";

class Author {
  id!: number;
  email!: string;
}

class Book {
  id!: number;
  title!: string;
  authorId!: number | null;
}

/** No `model NotAModel` exists in prisma/schema.prisma. */
class NotAModel {}

/**
 * `model Ghost` exists in this synthetic datamodel but not on the real
 * generated Prisma Client — exercises `PrismaRepositoryAdapter`'s own
 * "no delegate" guard, distinct from `buildEntityMetadata`'s "no model"
 * guard: metadata resolution succeeds here, the adapter constructor is
 * what fails.
 */
class Ghost {
  id!: number;
}
const ghostDatamodel: PrismaDatamodel = {
  models: [
    {
      name: "Ghost",
      fields: [
        {
          name: "id",
          kind: "scalar",
          type: "Int",
          isId: true,
          isList: false,
          isRequired: true,
          hasDefaultValue: false,
        },
      ],
    },
  ],
  enums: [],
};

describe("buildEntityMetadata — bootstrap error paths", () => {
  it("throws ConfigurationException when the marker class name matches no Prisma model", () => {
    expect(() => buildEntityMetadata(Prisma.dmmf.datamodel, NotAModel, new Map())).toThrow(ConfigurationException);
    try {
      buildEntityMetadata(Prisma.dmmf.datamodel, NotAModel, new Map());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationException);
      expect((error as ConfigurationException).code).toBe("KAVO_CONFIG_INVALID");
    }
  });

  it("throws ConfigurationException when a relation's target model wasn't registered in 'entities'", () => {
    // Book.author targets Author, but Author is deliberately left out of the registry.
    const metadata = buildEntityMetadata(Prisma.dmmf.datamodel, Book, new Map([["Book", Book]]));
    const authorRelation = metadata.relations.find((relation) => relation.name === "author")!;
    expect(() => authorRelation.target()).toThrow(ConfigurationException);
    try {
      authorRelation.target();
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigurationException).code).toBe("KAVO_CONFIG_INVALID");
    }
  });

  it("resolves a relation's target once its marker class is registered", () => {
    const entities = new Map<string, typeof Author | typeof Book>([
      ["Author", Author],
      ["Book", Book],
    ]);
    const metadata = buildEntityMetadata(Prisma.dmmf.datamodel, Book, entities);
    const authorRelation = metadata.relations.find((relation) => relation.name === "author")!;
    expect(authorRelation.target()).toBe(Author);
  });
});

describe("createPrismaInfrastructure — adapter bootstrap error path", () => {
  it("throws ConfigurationException when Prisma Client has no delegate for the resolved model name", () => {
    const client = newTestPrismaClient();
    const infrastructure = createPrismaInfrastructure(client as never, {
      datamodel: ghostDatamodel,
      entities: [Ghost],
    });
    // Metadata resolution succeeds (Ghost matches ghostDatamodel); the real
    // Prisma Client just has no `ghost` delegate, since no such model exists
    // in the actual schema — this is the adapter constructor's own guard.
    expect(() => infrastructure.adapterFor(Ghost)).toThrow(ConfigurationException);
  });
});
