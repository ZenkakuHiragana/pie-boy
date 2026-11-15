#!/usr/bin/env bash
# Replace pie-boy's code in Pi's git install directory without touching node_modules.
#
# Why not 'pi update --extensions': for a git package it runs 'git reset --hard',
# 'git clean -fdx' and 'npm install' in the same directory the running sessions
# loaded their code from. 'git clean' has to delete node_modules, and on Windows it
# cannot delete the native modules another Pi session holds open (@kmamal/sdl,
# @discordjs/opus), so an update while Pi runs leaves new code next to old
# dependencies (earendil-works/pi#11597, earendil-works/pi#8215).
#
# This script does only the code half: fetch, reset --hard, and remove Pi's
# "update incomplete" marker, which otherwise makes the next 'pi update --extensions'
# retry the clean. Native dependencies stay where they are. Running Pi sessions keep
# the old code until they run /reload.
#
# Usage:
#   bash scripts/update-code.sh [install-dir] [--force]
#
#   install-dir  Pi's git install of pie-boy. Defaults to the global install path
#                ~/.pi/agent/git/github.com/ZenkakuHiragana/pie-boy, and must be the
#                root of that worktree.
#   --force      Discard uncommitted changes to tracked files in install-dir.
#
# Exit codes:
#   0  the code is at upstream (updated now, already there, or local edits discarded)
#   2  the code is at upstream but node_modules does not match package.json /
#      package-lock.json: run the printed npm install with every Pi session closed
#   1  nothing done, or the update failed
#
# Not safe against a concurrent 'pi update --extensions'; Pi takes no lock either.

# -E keeps the ERR trap working inside functions, so a failing git call still
# reports 1 instead of its own exit code.
set -Eeuo pipefail

trap 'exit 1' ERR

readonly default_install_dir="$HOME/.pi/agent/git/github.com/ZenkakuHiragana/pie-boy"

die() {
  printf 'update-code: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: bash scripts/update-code.sh [install-dir] [--force]

  install-dir  Pi's git install of pie-boy. Defaults to the global install path
    ~/.pi/agent/git/github.com/ZenkakuHiragana/pie-boy. It must be the root of
    that worktree.
  --force      Discard uncommitted changes to tracked files in install-dir.

Updates the code in install-dir the way 'pi update --extensions' would, except it
leaves node_modules alone. Run /reload in every running Pi session afterwards.
USAGE
}

install_arg=""
force=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --force) force=1 ;;
    -*) die "unknown option: $arg (try --help)" ;;
    *)
      [ -z "$install_arg" ] || die "unexpected argument: $arg (try --help)"
      install_arg="$arg"
      ;;
  esac
done

install_dir="${install_arg:-$default_install_dir}"
if [ ! -d "$install_dir" ]; then
  die "install directory not found: $install_dir
  Install the package with: pi install git:github.com/ZenkakuHiragana/pie-boy"
fi
install_dir="$(cd -- "$install_dir" && pwd -P)"

# Re-run from a copy when this script sits inside the directory it resets: the reset
# would otherwise rewrite the file bash is still reading. The environment marker stops
# a TMPDIR that points inside install_dir from copying again.
if [ "${PIE_BOY_UPDATE_CODE_REEXEC:-}" != "1" ]; then
  self_path="$(cd -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")"
  case "$self_path" in
    "$install_dir"/*)
      copy="$(mktemp)"
      cp -- "$self_path" "$copy"
      reexec_args=("$install_dir")
      if [ "$force" -eq 1 ]; then
        reexec_args+=(--force)
      fi
      code=0
      PIE_BOY_UPDATE_CODE_REEXEC=1 bash "$copy" "${reexec_args[@]}" || code=$?
      rm -f -- "$copy"
      exit "$code"
      ;;
  esac
fi

git_in() { git -C "$install_dir" "$@"; }

git_in rev-parse --git-dir >/dev/null 2>&1 || die "not a git worktree: $install_dir"
toplevel="$(git_in rev-parse --show-toplevel)" || die "not a git worktree: $install_dir"
toplevel="$(cd -- "$toplevel" && pwd -P)"
if [ "$toplevel" != "$install_dir" ]; then
  die "$install_dir is not the root of a git worktree (worktree root: $toplevel)
  Pass Pi's package install directory, for example $default_install_dir"
fi

upstream="$(git_in rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" || die \
  "no upstream branch in $install_dir, so this is not the usual pie-boy install.
  Update it with: pi update --extensions"
case "$upstream" in
  origin/*) ;;
  *) die "upstream is '$upstream', expected an origin/ branch" ;;
esac
readonly branch="${upstream#origin/}"

dirty=0
pending="$(git_in status --porcelain --untracked-files=no)"
if [ -n "$pending" ]; then
  dirty=1
  if [ "$force" -eq 0 ]; then
    die "uncommitted changes in $install_dir:
$pending
  Commit or discard them, or pass --force to discard them here."
  fi
fi

# Pi's marker for a half-finished update; a leftover marker makes 'pi update
# --extensions' retry 'git clean -fdx' on the next run. Same path as Pi's.
readonly marker="$(dirname -- "$install_dir")/.$(basename -- "$install_dir").pi-update-incomplete"
had_marker=0
if [ -e "$marker" ]; then
  had_marker=1
fi
clear_marker() {
  rm -f -- "$marker"
  if [ "$had_marker" -eq 1 ]; then
    printf 'removed leftover update marker: %s\n' "$marker"
  fi
}

old="$(git_in rev-parse HEAD)"
printf 'fetching %s in %s\n' "$upstream" "$install_dir"
git_in fetch --prune --no-tags origin "+refs/heads/${branch}:refs/remotes/origin/${branch}"
new="$(git_in rev-parse "${upstream}^{commit}")"

# Work out what to say about dependencies before resetting: once HEAD is at new, a
# later run only sees old == new and could no longer tell that they changed.
deps_changed=0
deps_reason=""
diff_status=0
git_in diff --quiet "$old" "$new" -- package.json package-lock.json || diff_status=$?
case "$diff_status" in
  0) ;;
  1)
    deps_changed=1
    deps_reason="package.json or package-lock.json changed in this update"
    ;;
  *)
    die "could not compare package.json / package-lock.json between $(git_in rev-parse --short "$old") and $(git_in rev-parse --short "$new") (git diff exited $diff_status)"
    ;;
esac

# npm records the lockfile it installed from in node_modules. A newer lockfile in the
# checkout means the dependencies were never installed for this code: an interrupted
# run of this script, or a failed 'pi update --extensions' that left its marker.
installed_lock="$install_dir/node_modules/.package-lock.json"
if [ "$deps_changed" -eq 0 ]; then
  if [ -e "$installed_lock" ]; then
    if [ "$install_dir/package-lock.json" -nt "$installed_lock" ] ||
      [ "$install_dir/package.json" -nt "$installed_lock" ]; then
      deps_changed=1
      deps_reason="package.json or package-lock.json is newer than the node_modules npm installed"
    fi
  elif [ "$had_marker" -eq 1 ]; then
    printf 'note: node_modules has no npm lockfile, so dependencies cannot be checked\n'
  fi
fi

reload_hint=0
if [ "$old" = "$new" ] && [ "$dirty" -eq 0 ]; then
  clear_marker
  printf 'pie-boy code is already at %s; nothing to swap\n' "$(git_in rev-parse --short "$new")"
else
  git_in reset --hard "$new"
  clear_marker
  reload_hint=1
  if [ "$old" = "$new" ]; then
    printf 'discarded uncommitted changes in %s; code is at %s\n' \
      "$install_dir" "$(git_in rev-parse --short "$new")"
  else
    printf 'updated pie-boy code: %s -> %s (%s files changed)\n' \
      "$(git_in rev-parse --short "$old")" \
      "$(git_in rev-parse --short "$new")" \
      "$(git_in diff --name-only "$old" "$new" | wc -l | tr -d ' ')"
    # Cosmetic only: never turn a finished update into a failure.
    git --no-pager -C "$install_dir" log --oneline --no-decorate "${old}..${new}" | sed 's/^/  /' || true
  fi
fi

if [ "$deps_changed" -eq 1 ]; then
  printf '\nWARNING: dependencies need installing (%s).\n' "$deps_reason"
  printf 'Close every Pi session, then run:\n'
  printf '  cd %q\n' "$install_dir"
  printf '  %s\n' "npm install --omit=dev --legacy-peer-deps --no-audit --no-fund"
  printf 'Until then the new code runs against the old node_modules.\n'
  exit 2
fi

printf '\nthis script left node_modules alone: no git clean, no npm install.\n'
if [ "$reload_hint" -eq 1 ]; then
  printf 'Run /reload in every running Pi session to load the new code.\n'
fi
