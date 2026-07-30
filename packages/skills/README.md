# Kavo developer skills (Claude Code)

Nine [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills)
documenting how to _use_ the `@kavo/*` packages in your own app — as opposed
to this repo's own `.claude/skills/`, which covers contributing to Kavo
itself. Point Claude Code at one of these and it has the config shapes,
routes, and grammar memorized instead of guessing from source.

| Skill             | Covers                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| `quick-start`     | New project from scratch — install, minimal entity, zero-config `@Crud`             |
| `crud-decorator`  | `@Crud(Entity, config?)` — routes, `EntityConfig`, allowlists, relations, overrides |
| `global-config`   | `KavoSettings` precedence chain, `KavoModule.forRoot`/`createKavo` wiring           |
| `query-grammar`   | The `filter`/`sort`/`fields`/pagination/`include` wire grammar                      |
| `dto-slots`       | The six optional DTO slots and entity-derived defaults                              |
| `error-handling`  | Exception hierarchy, `KAVO_*` codes, the problem-details wire shape                 |
| `soft-delete`     | Soft delete / restore / purge strategy and semantics                                |
| `graphql-binding` | `@kavo/graphql` and its Nest binding                                                |
| `swagger`         | Optional `@nestjs/swagger` integration — what's auto-documented vs. manual          |

## Install

This directory is also a Claude Code **plugin** (`.claude-plugin/plugin.json`),
listed in this repo's own marketplace catalog
(`/.claude-plugin/marketplace.json`). Inside Claude Code:

```
/plugin marketplace add kavo-labs/kavo
/plugin install kavo-skills@kavo-marketplace
```

Update later with:

```
/plugin marketplace update kavo-marketplace
```

### Manual install (no plugin support)

One command, from your project root — pulls all eight skills straight from
GitHub into `.claude/skills/`, no npm publish step and no clone required:

```bash
npx degit kavo-labs/kavo/packages/skills/skills .claude/skills --force
```

`--force` lets this merge into an existing, non-empty `.claude/skills/`
directory without touching your own skills — `degit` only writes the files
it's pulling, it never deletes anything already there.

Re-run the same command any time to pick up updates.

### Installing a single skill

```bash
npx degit kavo-labs/kavo/packages/skills/skills/quick-start .claude/skills/quick-start --force
```

Swap `quick-start` for any name from the table above.

## Updating this directory

These are hand-written references, not generated docs — when a `@kavo/*`
package's behavior changes, update the matching `SKILL.md` here in the same
PR (this repo's own `add-config-key`/`add-operation`/etc. skills already
call this out where it applies).
