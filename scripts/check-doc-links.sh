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
# Scope, in four passes: `docs/**.md` references in any tracked file, resolved
# from the repo root or from the mentioning file; markdown links between files
# under `docs/` written relative to the linking file — how the docs index
# writes them; the extensionless VitePress sidebar/nav links in the config; and
# the extensionless site-absolute links docs prose writes (`](/getting-started)`).
# The last two are the ones VitePress's own dead-link check cannot help with —
# it never inspects the config, and it only catches prose links at `docs:build`,
# which runs on push to `main`, i.e. after the merge that broke them.
#
# Out of scope, deliberately: `#anchor` fragments (only the file is resolved),
# and by-number citations of the form `doc NN`.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

config=docs/.vitepress/config.mts

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

# Every pass below must match something in this repo. An empty result therefore
# means the scanner broke — a typo'd regex, a pathspec that stopped matching, a
# `git grep` that hard-errored — not that the tree is clean.
#
# Two shell details make this work, and both are load-bearing. Each pass
# captures into a variable and reads it back with a here-string, rather than
# looping over a process substitution: bash discards a process substitution's
# exit status, so neither `set -e` nor `pipefail` can see a failing `git grep`
# there. And `require_hits` must be called from the current shell, never inside
# `$(...)` — an `exit` in a command substitution ends only that subshell, which
# is the same silent-success bug in a new costume.
require_hits() {
  [ -n "$2" ] && return 0
  echo "check-doc-links: $1 matched nothing — the scanner is broken, not the repo." >&2
  exit 1
}

# A VitePress link (`/internals/architecture/07-crud-engine`) is extensionless
# and may name either a page or a directory index, so accept both spellings.
link_resolves() {
  case "$1" in
    *.md) [ -f "docs$1" ] ;;
    */) [ -f "docs${1}index.md" ] ;;
    *) [ -f "docs$1.md" ] || [ -f "docs$1/index.md" ] ;;
  esac
}

link_target() {
  case "$1" in
    *.md) printf 'docs%s\n' "$1" ;;
    */) printf 'docs%sindex.md\n' "$1" ;;
    *) printf 'docs%s.md\n' "$1" ;;
  esac
}

# 1. `docs/**.md` references anywhere in the tree. The leading segments are
#    matched too, so a mention embedded in a longer path (`pkg/docs/<name>.md`)
#    or in a URL (`https://host/docs/<name>.md` — the repo cites such URLs) is
#    read whole rather than mistaken for a repo-root-relative path. A reference
#    counts as live if it resolves from the repo root (how source comments and
#    skills write it) or from the mentioning file's own directory (how a
#    package README writes `../../docs/...`).
hits=$(git grep -n -o -E '(https?://)?[A-Za-z0-9._/-]*docs/[A-Za-z0-9._/-]+\.md' -- . | sort -u) || hits=""
require_hits 'pass 1 (docs paths)' "$hits"
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
done <<<"$hits"

# 2. Relative markdown links between files under `docs/`, resolved against the
#    linking file — how the docs index and cross-doc links are actually written.
#    `docs/README.md` is the reason this pass exists: `srcExclude` keeps it out
#    of the VitePress build, so nothing else looks at its links at all.
hits=$(git grep -n -o -E '\]\([A-Za-z0-9._/-]+\.md(#[A-Za-z0-9._-]+)?\)' -- 'docs/**.md' | sort -u) || hits=""
require_hits 'pass 2 (relative links in docs/)' "$hits"
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
done <<<"$hits"

# 3. VitePress sidebar/nav links. They are extensionless, so passes 1 and 2
#    cannot see them, and VitePress's own dead-link check only covers links
#    written in markdown — a sidebar entry left behind by a renamed doc builds
#    clean and ships a 404 to the published site. A missing config is a hard
#    error, not a skip: silently dropping this pass is how the guard stops
#    guarding the one thing nothing else covers.
if [ ! -f "$config" ]; then
  echo "check-doc-links: $config not found — pass 3 (sidebar links) cannot run." >&2
  echo "If the config moved or was split, point this script at the new location." >&2
  exit 1
fi

hits=$(git grep -n -o -E 'link: "/[A-Za-z0-9._/#-]*"' -- "$config" | sort -u) || hits=""
require_hits 'pass 3 (sidebar links)' "$hits"
while IFS= read -r hit; do
  rest=${hit#*:}
  line=${rest%%:*}
  ref=${rest#*:}
  ref=${ref#*\"}
  ref=${ref%\"}
  ref=${ref%%#*}
  [ -n "$ref" ] || continue
  link_resolves "$ref" || report "$config" "$line" "$(link_target "$ref")"
done <<<"$hits"

# 4. Site-absolute links in docs prose (`[Nest + Prisma](/integrations/nest/prisma)`).
#    Extensionless like the sidebar, so passes 1 and 2 miss them too. VitePress
#    does catch these — but only at `docs:build`, which runs on push to `main`,
#    so without this pass a rename merges green and breaks the deploy.
hits=$(git grep -n -o -E '\]\(/[A-Za-z0-9._/#-]+\)' -- 'docs/**.md' | sort -u) || hits=""
require_hits 'pass 4 (site-absolute links)' "$hits"
while IFS= read -r hit; do
  file=${hit%%:*}
  rest=${hit#*:}
  line=${rest%%:*}
  ref=${rest#*:}
  ref=${ref#](}
  ref=${ref%)}
  ref=${ref%%#*}
  [ -n "$ref" ] || continue
  link_resolves "$ref" || report "$file" "$line" "$(link_target "$ref")"
done <<<"$hits"

if [ "$status" -ne 0 ]; then
  echo
  echo "Dead references above. Repoint them at the real file, or add a"
  echo "placeholder rule to scripts/check-doc-links.sh if the path is a template."
  exit 1
fi

echo "doc links OK — every tracked docs/**.md reference and docs link resolves"
