/** Image processing only. Input is a normalized 640×324 RGBA client frame. */
export function describe(image, rect, columns = 32, rows = 12) {
  const { x, y, width, height } = rect;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.data.length !== image.width * image.height * 4 ||
      ![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 ||
      width < columns || height < rows || x + width > image.width || y + height > image.height) throw new TypeError('Invalid image region');
  const values = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) {
    const x0 = x + Math.floor(cx * width / columns), x1 = x + Math.floor((cx + 1) * width / columns);
    const y0 = y + Math.floor(cy * height / rows), y1 = y + Math.floor((cy + 1) * height / rows);
    let sum = 0, count = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * image.width + xx) * 4;
      sum += image.data[i] * .299 + image.data[i + 1] * .587 + image.data[i + 2] * .114; count++;
    }
    values.push(sum / count);
  }
  return values;
}

export function correlation(a, b) {
  if (a.length !== b.length || !a.length || ![...a, ...b].every(Number.isFinite)) throw new TypeError('Invalid descriptors');
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; aa += x * x; bb += y * y; ab += x * y; }
  if (aa / a.length < 25 || bb / b.length < 25) return 0;
  return Math.max(0, Math.min(1, ab / Math.sqrt(aa * bb)));
}

export function scoreFrame(image, reference) {
  if (image.width !== reference.width || image.height !== reference.height || reference.anchors.length !== 2) throw new TypeError('Normalize frame to reference size');
  const anchors = reference.anchors.map(anchor => ({ name: anchor.name,
    score: correlation(describe(image, anchor.rect, reference.columns, reference.rows), anchor.values) }));
  // Both text and accept-button structures must agree.
  return { confidence: Math.min(...anchors.map(a => a.score)), anchors };
}
