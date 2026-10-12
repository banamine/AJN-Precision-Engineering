Your last export already contains the NEW Home files (carousel, hooks, labels, tests, Clear App Data),
but these 5 existing files still have the OLD content, so the new Home is not wired in yet.
Overwrite these 5 with the copies in this zip (same paths), then publish:
  server.ts
  src/App.tsx
  src/components/AjnResourcePanel.tsx
  src/components/HomeView.tsx
  src/components/TvGuideView.tsx
Check after publishing: https://<your app>/api/home/now returns JSON with "items"; Home shows "On Air & New Today".
