#!/usr/bin/env bash
#
# Fails if any tracked file references a `docs/**.md` path that does not exist.
#
# Moving a docs directory leaves every mention of the old path behind, and the
# mentions live everywhere — skills, agent prompts, READMEs, source comments.
# Two of the files carrying them ship to npm, so a dead reference is something
# an adopter follows. A one-off grep is not a guard, because nothing re-runs
# it; this does, from CI, on every push and pull request.
#
# Scope: `docs/**.md` references in any tracked file, resolved from the repo
# root or from the mentioning file; markdown links between files under `docs/`
# written relative to the linking file — how the docs index writes them — so
# the index is covered too; and the extensionless VitePress sidebar/nav links
# in `docs/.vitepress/config.mts`, which VitePress itself never validates.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Template placeholders: a stand-in for the path a new file will take, not a
# link to an existing one. `00NN` is the "next sequential number" token in the
# add-adr skill.
is_placeholder() {
  case "$1" in
    *00NN-kebab-title.md) return 0 ;;
    *) return 1 ;;
  esac
}

status=0

report() {
  printf '%s:%s: dead docs reference -> %s\n' "$1" "$2" "$3"
  status=1
}

# 1. `docs/**.md` references anywhere in the tree. The leading segments are
#    matched too, so a mention embedded in a longer path (`pkg/docs/<name>.md`)
#    or in a URL (`https://host/docs/<name>.md` — the repo cites such URLs) is
#    read whole rather than mistaken for a repo-root-relative path. A reference
#    counts as live if it resolves from the repo root (how source comments and
#    skills write it) or from the mentioning file's own directory (how a
#    package README writes `../../docs/...`).
while IFS= read -r hit; do
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  ref=${rest#*:}
  case "$ref" in
    http://* | https://*) continue ;; # external URL, not a repo path
  esac
  is_placeholder "$ref" && continue
  [ -f "$ref" ] || [ -f "$(dirname "$file")/$ref" ] || report "$file" "$line" "$ref"
done < <(git grep -n -o -E '(https?://)?[A-Za-z0-9._/-]*docs/[A-Za-z0-9._/-]+\.md' -- . | sort -u)

# 2. Relative markdown links between files under `docs/`, resolved against the
#    linking file — how the docs index and cross-doc links are actually written.
while IFS= read -r hit; do
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  ref=${rest#*:}
  ref=${ref#](}
  ref=${ref%)}
  ref=${ref%%#*}
  [ -n "$ref" ] || continue
  case "$ref" in
    docs/*) continue ;; # already covered by pass 1
  esac
  is_placeholder "$ref" && continue
  [ -f "$(dirname "$file")/$ref" ] || report "$file" "$line" "$ref"
done < <(git grep -n -o -E '\]\([A-Za-z0-9._/-]+\.md(#[A-Za-z0-9._-]+)?\)' -- 'docs/**.md' | sort -u)

# 3. VitePress sidebar/nav links. They are extensionless (`/internals/adr/0001-…`),
#    so passes 1 and 2 cannot see them, and VitePress's own dead-link check only
#    covers links written in markdown — a sidebar entry left behind by a renamed
#    doc builds clean and ships a 404 to the published site. The docs build also
#    only runs on push to `main`, so nothing else catches it before merge.
config=docs/.vitepress/config.mts
if [ -f "$config" ]; then
  while IFS= read -r hit; do
    rest=${hit#*:}
    line=${rest%%:*}
    ref=${rest#*:}
    ref=${ref#*\"}
    ref=${ref%\"}
    ref=${ref%%#*}
    case "$ref" in
      *.md) target="docs$ref" ;;
      */) target="docs${ref}index.md" ;;
      *) target="docs$ref.md" ;;
    esac
    [ -f "$target" ] || report "$config" "$line" "$target"
  done < <(git grep -n -o -E 'link: "/[A-Za-z0-9._/#-]*"' -- "$config" | sort -u)
fi

if [ "$status" -ne 0 ]; then
  echo
  echo "Dead references above. Repoint them at the real file, or add a"
  echo "placeholder rule to scripts/check-doc-links.sh if the path is a template."
  exit 1
fi

echo "doc links OK — every tracked docs/**.md reference and sidebar link resolves"
