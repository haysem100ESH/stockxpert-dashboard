import * as ort from 'onnxruntime-web';

const MODEL_URL = 'https://huggingface.co/garavv/arcface-onnx/resolve/main/arc.onnx';
const IDB_DB_NAME = 'arcface-cache';
const IDB_STORE = 'models';
const IDB_KEY = 'arcface-v1';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

let session: ort.InferenceSession | null = null;
let loading = false;

/** Open (or create) the IndexedDB database for model caching */
function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedModel(): Promise<ArrayBuffer | null> {
  try {
    const db = await openModelDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function cacheModel(buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openModelDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(buffer, IDB_KEY);
  } catch (e) {
    console.warn('[ArcFace] Failed to cache model in IndexedDB:', e);
  }
}

export async function loadArcFaceModel(
  onProgress?: (percent: number) => void
): Promise<void> {
  if (session) { onProgress?.(100); return; }
  if (loading) {
    while (loading) await new Promise((r) => setTimeout(r, 200));
    onProgress?.(100);
    return;
  }

  loading = true;
  try {
    // Try loading from IndexedDB cache first
    let buffer = await getCachedModel();

    if (buffer) {
      console.log('[ArcFace] Loaded model from IndexedDB cache');
      onProgress?.(90);
    } else {
      // Download with progress
      const response = await fetch(MODEL_URL);
      const contentLength = Number(response.headers.get('content-length') || 0);
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          onProgress?.(Math.round((received / contentLength) * 90));
        }
      }

      const uint8 = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { uint8.set(chunk, offset); offset += chunk.length; }
      buffer = uint8.buffer;

      // Cache in IndexedDB for future use
      await cacheModel(buffer);
      console.log('[ArcFace] Model downloaded and cached in IndexedDB');
    }

    onProgress?.(95);
    session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
    });
    onProgress?.(100);
    console.log('[ArcFace] Model loaded successfully');
  } catch (err) {
    console.error('[ArcFace] Failed to load model:', err);
    throw err;
  } finally {
    loading = false;
  }
}

export function isArcFaceLoaded(): boolean {
  return !!session;
}

/**
 * Preprocess a face crop from a video/canvas element into the format expected by ArcFace.
 * Input: source element + bounding box of the face
 * Output: Float32Array in NHWC format [1, 112, 112, 3], normalized to [-1, 1]
 */
export function preprocessFace(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  box: { x: number; y: number; width: number; height: number }
): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;

  // Add padding around the detected face box for better recognition
  const padding = 0.2;
  const padX = box.width * padding;
  const padY = box.height * padding;
  const sx = Math.max(0, box.x - padX);
  const sy = Math.max(0, box.y - padY);
  const sw = box.width + padX * 2;
  const sh = box.height + padY * 2;

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 112, 112);

  const imageData = ctx.getImageData(0, 0, 112, 112);
  const data = imageData.data;

  // NHWC format: [1, 112, 112, 3], normalize to [-1, 1]
  const float32 = new Float32Array(1 * 112 * 112 * 3);
  for (let i = 0; i < 112 * 112; i++) {
    float32[i * 3] = (data[i * 4] - 127.5) / 127.5;         // R
    float32[i * 3 + 1] = (data[i * 4 + 1] - 127.5) / 127.5; // G
    float32[i * 3 + 2] = (data[i * 4 + 2] - 127.5) / 127.5; // B
  }

  return float32;
}

/**
 * Extract a 512-dimensional face embedding using ArcFace.
 * The embedding is L2-normalized.
 */
export async function extractArcFaceEmbedding(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  box: { x: number; y: number; width: number; height: number }
): Promise<Float32Array> {
  if (!session) throw new Error('ArcFace model not loaded. Call loadArcFaceModel() first.');

  const input = preprocessFace(source, box);
  const tensor = new ort.Tensor('float32', input, [1, 112, 112, 3]);

  // Dynamically get input/output names
  const inputName = session.inputNames[0];
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inputName] = tensor;

  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  const embedding = results[outputName].data as Float32Array;

  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  const normalized = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    normalized[i] = embedding[i] / (norm + 1e-10);
  }

  return normalized;
}

/**
 * Cosine similarity between two L2-normalized embeddings.
 * Returns a value between -1 and 1.  Higher = more similar.
 * For L2-normalized vectors, dot product = cosine similarity.
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

/**
 * Convert cosine similarity to a percentage score (0-100).
 * Uses a stricter mapping where only high cosine similarities yield high percentages.
 * Cosine sim of 1.0 = 100%, 0.5 = 50%, 0.0 = 0%, negative = 0%
 * For ArcFace, genuine matches typically have cosine sim > 0.5
 */
export function similarityToPercent(cosSim: number): number {
  // Strict mapping: [0, 1] → [0, 100], negative values clamp to 0
  return Math.max(0, Math.min(100, cosSim * 100));
}
