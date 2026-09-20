# V2 GitHub Import Checklist

- [ ] Import the working V2 application tree.
- [ ] Preserve source paths used by the Vite build.
- [ ] Keep historical drop-ins under a separate archive directory.
- [ ] Ensure no individual GitHub file/artifact exceeds 25 MB.
- [ ] Generate SHA-256 manifest for the imported tree.
- [ ] Run TypeScript/build CI.
- [ ] Verify runtime playback in Builder.
- [ ] Record the final commit SHA and imported file count.
