import express, { type Express, type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';

/** Any request that looks like a file (or lives under /assets/) must never be answered with index.html. */
export const MISSING_FILE_PATTERN = /\.(?:js|mjs|cjs|css|wasm|map|json|webmanifest|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp3|mp4|webm|m4a|ogg|vtt|txt|xml)$/i;

/** True when this process is the compiled server bundle (dist/server.cjs), whatever NODE_ENV says. */
export function isCompiledBundle(): boolean {
  return typeof __filename !== 'undefined' && /server\.cjs$/.test(__filename);
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || isCompiledBundle();
}

/** The built static directory: next to the bundle first, then cwd/dist. Independent of the working directory. */
export function resolveDistDir(): string {
  const candidates: string[] = [];
  if (typeof __dirname !== 'undefined') candidates.push(__dirname);
  candidates.push(path.join(process.cwd(), 'dist'));
  for (const dir of candidates) if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  return path.join(process.cwd(), 'dist');
}

/** Mounts static files, the missing-file 404 guard, and the SPA fallback. Call after every /api route. */
export function mountStaticSpa(app: Express, distDir: string): void {
  const indexPath = path.join(distDir, 'index.html');
  const sendShell: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.type('html');
    res.sendFile(indexPath, { cacheControl: false, etag: false, lastModified: false }, (err) => { if (err) next(err); });
  };
  app.use(express.static(distDir, {
    index: false,
    redirect: false,
    setHeaders: (res, filePath) => {
      const rel = path.relative(distDir, filePath).split(path.sep).join('/');
      if (rel === 'index.html') res.setHeader('Cache-Control', 'no-store');
      else if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/assets/') || MISSING_FILE_PATTERN.test(req.path)) {
      res.status(404).set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }).send('Not found');
      return;
    }
    next();
  });
  app.get('*', sendShell);
}
