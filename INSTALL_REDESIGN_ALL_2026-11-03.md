# AJN redesign drop-in, all 10 files (2026-11-03)
Copy the src folder over the repo (same paths). Files:
src/App.tsx, src/hooks/usePersistentMedia.ts
src/components/: HomeView, LibraryView, WatchLaterView, MiniPlayerDock, Navigation, RadioDock (.tsx)
src/components/ajn-platform-redesign/: AppearanceProvider.tsx, theme.css
Contents: copper skin; nav labels + Watch Later route + single dock (Replit slice A/B + REV3 dock/Retry); Discover hero + Live Now; Archive Vault pills + play overlay; My Library card grid.
Base: GitHub main 9b9c1e2 (Replit patch verified line-for-line for App/Navigation/theme/RadioDock). Not run in a browser by me.
Check: git diff --stat shows these 10 files.
After deploy, check: Discover (>=1280px), Archive Vault, My Library (#watch-later), dock while playing, Retry on a failed stream.
