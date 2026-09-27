import express from "express";

const router = express.Router();

router.post("/api/watchdog/heartbeat", (req, res) => {
  console.log("[WATCHDOG HEARTBEAT]", req.body);
  res.json({ acknowledged: true, ts: Date.now() });
});

export default router;
