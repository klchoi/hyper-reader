#!/bin/sh
# What the server of compose.yaml keeps, out of the docker volume `data` into folders of the
# machine's own, on the machine docker runs on, from this working copy:
#
#   tools/move-store.sh <data folder> <index folder>
#   tools/move-store.sh /mnt/cache/appdata/hyper-reader/data /mnt/cache/appdata/hyper-reader/index
#
# - <data>: reader.db (where each book was left, the settings, the names: the one to keep a copy
#   of), library.db written anew, without the space the index it held left in it, and the uploads
# - <index>: the full-text index, by far the biggest and most written to, in a folder without
#   copy-on-write (chattr +C, on btrfs), made again from the books when the server starts
#
# The server is stopped first, and started again on the new folders (DATA and INDEX, in .env).
# The volume `data` is left as it was, for the server to go back to (DATA and INDEX out of .env)
# until the new folders are seen to work: then `docker volume rm hyper-reader_data`.
set -eu
[ $# -eq 2 ] || { echo "usage: $0 <data folder> <index folder>" >&2; exit 2; }
data=$(realpath -m "$1")
index=$(realpath -m "$2")
cd "$(dirname "$0")/.."
volume=hyper-reader_data

# this working copy is the one that keeps the index apart (--index-dir), or the server would
# not find it where it is put
[ -f server/index-store.ts ] && grep -q -- '--index-dir=/index' compose.yaml || { echo "this working copy has no --index-dir: pull master first" >&2; exit 1; }
grep -qE '^(DATA|INDEX)=' .env 2>/dev/null && { echo ".env gives DATA or INDEX already" >&2; exit 1; }
docker volume inspect "$volume" >/dev/null || { echo "no volume $volume" >&2; exit 1; }
for dir in "$data" "$index"; do
  mkdir -p "$dir"
  [ -z "$(ls -A "$dir")" ] || { echo "$dir is not empty" >&2; exit 1; }
done
# (+C holds only for files made after it, in a folder made empty)
if [ "$(stat -f -c %T "$index")" = btrfs ]; then
  chattr +C "$index"
  lsattr -d "$index"
fi

echo '--- how much the disks have been written, before'
for disk in /dev/nvme?n1 /dev/sd?; do
  [ -e "$disk" ] && smartctl -A "$disk" 2>/dev/null | grep -iE 'data units written|total_lbas_written' | sed "s|^|$disk: |" || true
done

docker compose stop api
# the databases written anew into <data> (VACUUM INTO: what they hold, in one piece, without the
# space left by what was deleted), checked, and the uploads copied; the index is not: it is made
# again
docker run --rm -v "$volume":/old -v "$data":/new hyper-reader-dev node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const fs = require("node:fs");
  for(const name of ["reader.db", "library.db"]) {
    if(!fs.existsSync(`/old/${name}`)) continue;
    const old = new DatabaseSync(`/old/${name}`);
    old.exec(`vacuum into '"'"'/new/${name}'"'"'`);
    old.close();
    const made = new DatabaseSync(`/new/${name}`);
    const { integrity_check } = made.prepare("pragma integrity_check").get();
    made.close();
    if(integrity_check !== "ok") throw new Error(`${name}: ${integrity_check}`);
    console.log(`${name}: ${(fs.statSync(`/old/${name}`).size / 1e6).toFixed(0)} MB, now ${(fs.statSync(`/new/${name}`).size / 1e6).toFixed(0)} MB`);
  }
  if(fs.existsSync("/old/uploads")) fs.cpSync("/old/uploads", "/new/uploads", { recursive: true });
'
printf 'DATA=%s\nINDEX=%s\n' "$data" "$index" >> .env
docker compose up -d api
echo "--- the server, on $data and $index (docker compose logs -f api):"
sleep 5
docker compose logs --tail 5 api
