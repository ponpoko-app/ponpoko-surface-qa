import type { DiffResult, Rect } from "../contracts/qa";

export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const CELL = 16;

export const MIN_CELL_SHARE = 0.005;

export const MAX_REGIONS = 6;

function differs(a: Uint8ClampedArray, b: Uint8ClampedArray, index: number, tolerance: number): boolean {
  const dr = Math.abs(a[index] - b[index]);
  const dg = Math.abs(a[index + 1] - b[index + 1]);
  const db = Math.abs(a[index + 2] - b[index + 2]);
  return dr > tolerance && dg > tolerance && db > tolerance;
}

export function noiseFloor(samples: Bitmap[]): number {
  if (samples.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    if (left.width !== right.width || left.height !== right.height) continue;
    let sum = 0;
    let pixels = 0;
    for (let offset = 0; offset + 3 < left.data.length; offset += 4) {
      sum += (Math.abs(left.data[offset] - right.data[offset]) + Math.abs(left.data[offset + 1] - right.data[offset + 1]) + Math.abs(left.data[offset + 2] - right.data[offset + 2])) / 3;
      pixels += 1;
    }
    if (pixels > 0) {
      total += sum / pixels;
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

export function diffBitmaps(baseline: Bitmap, current: Bitmap, tolerance: number): DiffResult {
  const width = Math.min(baseline.width, current.width);
  const height = Math.min(baseline.height, current.height);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      similarity: 0,
      had_baseline: true,
      regions: [{ rect: { x: 0, y: 0, width, height }, share: 1 }],
    };
  }
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cells = Array.from({ length: columns * rows }, () => false);
  let changed = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      total += 1;
      if (differs(baseline.data, current.data, index, tolerance)) {
        changed += 1;
        cells[Math.floor(y / CELL) * columns + Math.floor(x / CELL)] = true;
      }
    }
  }
  const countsInRect = (rect: Rect): number => {
    let hits = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        if (differs(baseline.data, current.data, (y * width + x) * 4, tolerance)) hits += 1;
      }
    }
    return hits;
  };
  const regions: { rect: Rect; share: number }[] = [];
  const visited = Array.from({ length: cells.length }, () => false);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const start = row * columns + column;
      if (!cells[start] || visited[start]) continue;
      let minRow = row;
      let maxRow = row;
      let minColumn = column;
      let maxColumn = column;
      const queue: number[] = [start];
      visited[start] = true;
      while (queue.length > 0) {
        const cell = queue.pop() as number;
        const cellRow = Math.floor(cell / columns);
        const cellColumn = cell % columns;
        minRow = Math.min(minRow, cellRow);
        maxRow = Math.max(maxRow, cellRow);
        minColumn = Math.min(minColumn, cellColumn);
        maxColumn = Math.max(maxColumn, cellColumn);
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nextRow = cellRow + dr;
          const nextColumn = cellColumn + dc;
          if (nextRow < 0 || nextColumn < 0 || nextRow >= rows || nextColumn >= columns) continue;
          const next = nextRow * columns + nextColumn;
          if (cells[next] && !visited[next]) {
            visited[next] = true;
            queue.push(next);
          }
        }
      }
      const rect: Rect = {
        x: minColumn * CELL,
        y: minRow * CELL,
        width: Math.min((maxColumn - minColumn + 1) * CELL, width - minColumn * CELL),
        height: Math.min((maxRow - minRow + 1) * CELL, height - minRow * CELL),
      };
      const hits = countsInRect(rect);
      const cellArea = (maxColumn - minColumn + 1) * (maxRow - minRow + 1) * CELL * CELL;
      if (hits / Math.max(cellArea, 1) < MIN_CELL_SHARE) continue;
      regions.push({ rect, share: changed === 0 ? 0 : hits / changed });
    }
  }
  regions.sort((left, right) => right.share - left.share);
  return {
    similarity: total === 0 ? 1 : 1 - changed / total,
    had_baseline: true,
    regions: regions.slice(0, MAX_REGIONS),
  };
}

export async function decodePng(base64: string): Promise<Bitmap> {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("this frame cannot read pixels");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data: data.data };
}

export async function cropToDataUrl(base64: string, rect: Rect): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const width = Math.max(1, Math.min(image.width, Math.round(rect.width)));
  const height = Math.max(1, Math.min(image.height, Math.round(rect.height)));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("this frame cannot crop pixels");
  context.drawImage(image, Math.round(rect.x), Math.round(rect.y), width, height, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await blob.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
