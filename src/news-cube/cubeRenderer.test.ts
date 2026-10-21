import assert from 'node:assert/strict';
import { wrapText } from './cubeRenderer';

const lines: string[] = [];
const context = {
  measureText(value: string) { return { width: Array.from(value).length * 10 } as TextMetrics; },
  fillText(value: string) { lines.push(value); },
} as unknown as CanvasRenderingContext2D;
const longUrl = `https://${'synthetictoken'.repeat(4)}.invalid/story`;
wrapText(context, longUrl, 0, 0, 50, 12, 30);
assert.ok(lines.length > 1, 'long unbroken tokens are split across lines');
assert.ok(lines.every((line) => Array.from(line).length <= 5), 'no canvas line exceeds the available width');
console.log('News Cube renderer text wrapping: PASS (long URL token split within panel width)');
