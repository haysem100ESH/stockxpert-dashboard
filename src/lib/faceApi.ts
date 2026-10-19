import * as faceapi from '@vladmandic/face-api';
import { loadArcFaceModel, extractArcFaceEmbedding, isArcFaceLoaded } from './arcface';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let detectionModelsLoaded = false;

/**
 * Load face-api.js detection/landmark models + ArcFace ONNX embedding model.
 * face-api.js is used ONLY for face detection and landmarks.
 * ArcFace is used for high-quality 512-d face embeddings.
 */
export async function loadFaceModels(
  onArcFaceProgress?: (percent: number) => void
): Promise<void> {
  const promises: Promise<void>[] = [];

  // Load face-api.js for detection + landmarks only
  if (!detectionModelsLoaded) {
    promises.push(
      Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      ]).then(() => {
        detectionModelsLoaded = true;
        console.log('[FaceApi] Detection models loaded');
      })
    );
  }

  // Load ArcFace ONNX model for embeddings
  if (!isArcFaceLoaded()) {
    promises.push(loadArcFaceModel(onArcFaceProgress));
  } else {
    onArcFaceProgress?.(100);
  }

  await Promise.all(promises);
}

export function areModelsLoaded(): boolean {
  return detectionModelsLoaded && isArcFaceLoaded();
}

interface FaceDetection {
  box: { x: number; y: number; width: number; height: number };
  landmarks: faceapi.FaceLandmarks68;
}

/** Detect all faces and return their bounding boxes + landmarks */
export async function detectFaces(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<FaceDetection[]> {
  const detections = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks();

  return detections.map((d) => ({
    box: {
      x: d.detection.box.x,
      y: d.detection.box.y,
      width: d.detection.box.width,
      height: d.detection.box.height,
    },
    landmarks: d.landmarks,
  }));
}

/**
 * Detect a single face and extract its 512-d ArcFace embedding.
 * Returns null when no face or >1 face detected.
 */
export async function detectSingleFace(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<{ descriptor: Float32Array; landmarks: faceapi.FaceLandmarks68; box: { x: number; y: number; width: number; height: number } } | null> {
  const faces = await detectFaces(input);

  if (faces.length !== 1) return null;

  const face = faces[0];

  // Extract 512-d embedding using ArcFace ONNX
  const descriptor = await extractArcFaceEmbedding(input, face.box);

  return {
    descriptor,
    landmarks: face.landmarks,
    box: face.box,
  };
}

/** Detect all faces - returns count */
export async function detectFaceCount(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<number> {
  const detections = await faceapi.detectAllFaces(
    input,
    new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
  );
  return detections.length;
}

/** Euclidean distance between two face descriptors (kept for backward compat) */
export function faceDistance(d1: Float32Array, d2: Float32Array): number {
  return faceapi.euclideanDistance(Array.from(d1), Array.from(d2));
}

/** Convert distance to similarity percentage (0-100). Distance 0 = 100%, distance >= 1 = 0% */
export function distanceToSimilarity(distance: number): number {
  return Math.max(0, Math.min(100, (1 - distance) * 100));
}

/** Estimate head pose from face landmarks (yaw approximation) */
export function estimateHeadYaw(landmarks: faceapi.FaceLandmarks68): number {
  const nose = landmarks.getNose();
  const jaw = landmarks.getJawOutline();
  if (!nose.length || !jaw.length) return 0;

  const noseTip = nose[3]; // tip of nose
  const leftJaw = jaw[0];
  const rightJaw = jaw[jaw.length - 1];
  const faceCenter = (leftJaw.x + rightJaw.x) / 2;
  const faceWidth = rightJaw.x - leftJaw.x;

  if (faceWidth === 0) return 0;
  return ((noseTip.x - faceCenter) / faceWidth) * 2; // -1 to 1 roughly
}

export { faceapi };
