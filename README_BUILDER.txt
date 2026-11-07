GOOGLE BUILDER - MKV ADMISSION DROP-IN (3 files) - 2026-11-07
Matches GitHub main commit 5af783b. Replace exactly these 3 files with the ones in this zip. Change nothing else.
Do not run, test, or "fix" anything. Reply only: "done".

  server/sources/archiveLinks.ts     (adds: import { mkvVerdict } from './mkvVerified'; and one line in
                                      notWebPlayableVideo: if (ext === 'mkv') return mkvVerdict(pathOrUrl);)
  src/data/mkvCodecVerified.json     (257 verified-playable .mkv episodes; HEVC/AC3 files listed as rejected)
  test-mkv-admission.ts              (test now checks the real notWebPlayableVideo)

server/sources/mkvVerified.ts already exists in Builder (from commit 6c04b6b). If Builder says it is missing, stop and reply "mkvVerified.ts missing".
