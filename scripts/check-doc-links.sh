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
# Scope: repo-root-relative `docs/**.md` references, in any tracked file, plus
# markdown links between files under `docs/` written relative to the linking
# file — how the docs index writes them — so the index is covered too.

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

# 1. Repo-root-relative `docs/**.md` references, anywhere in the tree.
while IFS= read -r hit; do
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  ref=${rest#*:}
  is_placeholder "$ref" && continue
  [ -f "$ref" ] || report "$file" "$line" "$ref"
done < <(git grep -n -o -E 'docs/[A-Za-z0-9._/-]+\.md' -- . | sort -u)

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

if [ "$status" -ne 0 ]; then
  echo
  echo "Dead references above. Repoint them at the real file, or add a"
  echo "placeholder rule to scripts/check-doc-links.sh if the path is a template."
  exit 1
fi

echo "doc links OK — every tracked docs/**.md reference resolves"
