import express from "express";
import {
  ARCHIVE_NEWS_SOURCES,
  resolveArchiveItem,
  searchArchiveNews,
} from "../archiveNewsResolver";

const router = express.Router();

router.get("/api/news/archive/sources", (_req, res) => {
  res.json({
    success: true,
    sources: ARCHIVE_NEWS_SOURCES,
  });
});

router.get("/api/news/archive/resolve/:identifier", async (req, res) => {
  const sourceId = String(req.query.source || "");
  if (!ARCHIVE_NEWS_SOURCES.some((s) => s.id === sourceId)) {
    res.status(400).json({ success: false, error: "Invalid news source" });
    return;
  }

  try {
    const item = await resolveArchiveItem(
      req.params.identifier,
      sourceId as any
    );

    if (!item) {
      res.status(404).json({
        success: false,
        state: "UNAVAILABLE",
        error: "No verified MP4 derivative",
      });
      return;
    }

    res.json({ success: true, item });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error.message });
  }
});

router.get("/api/news/archive/:source", async (req, res) => {
  const source = ARCHIVE_NEWS_SOURCES.find((s) => s.id === req.params.source);
  if (!source) {
    res.status(404).json({ success: false, error: "Unknown Archive news source" });
    return;
  }

  try {
    const page = Number(req.query.page || 1);
    const rows = Number(req.query.rows || 20);
    const result = await searchArchiveNews(source.id, { page, rows });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(502).json({
      success: false,
      error: "Archive news discovery failed",
      detail: error.message,
    });
  }
});

export default router;
