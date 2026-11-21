AJN drop-in: video stage collapsed to 0 height on desktop (audio plays, no picture)
Base: Builder export ajn-precision-engineering.zip, 128,398,158 bytes, 2026-11-21 01:35 Denver.
ONE file changed: src/index.css (full file). Drop into the project, replacing src/index.css.
Change: .ajn-player-page-layout[data-caption-phase="off"] (min-width 1024) now keeps two areas:
  grid-template-columns: minmax(0, 1fr) 360px;  grid-template-areas: "left right";
Verify after publish (desktop width, play any video e.g. AJN Saturday Cartoons): the picture shows left,
Now playing / Up Next panel right. In DevTools: document.querySelector('video').getBoundingClientRect().height > 0
