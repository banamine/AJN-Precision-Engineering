import express from "express";

const router = express.Router();

router.get("/api/v1/news", async (_req, res) => {
  // Compatibility endpoint for clients still using the Phase 2 news contract.
  // The canonical deployed RSS handler remains /api/news/rss.
  try {
    const response = await fetch("http://127.0.0.1:3000/api/news/rss");
    const body = await response.text();
    res.status(response.status);
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.send(body);
  } catch (error: any) {
    res.status(502).json({ error: "News compatibility endpoint unavailable", detail: error?.message ?? String(error) });
  }
});

export default router;
