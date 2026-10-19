import { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, VideoOff } from 'lucide-react';

interface CameraCaptureProps {
  onFrame?: (video: HTMLVideoElement) => void;
  frameInterval?: number; // ms between frame callbacks
  videoRef?: React.RefObject<HTMLVideoElement>;
  showCaptureButton?: boolean;
  onCapture?: (blob: Blob, video: HTMLVideoElement) => void;
  mirror?: boolean;
  className?: string;
}

export default function CameraCapture({
  onFrame,
  frameInterval = 500,
  videoRef: externalVideoRef,
  showCaptureButton = false,
  onCapture,
  mirror = true,
  className = '',
}: CameraCaptureProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoElement = externalVideoRef || internalRef;
  const streamRef = useRef<MediaStream | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoElement.current) {
        videoElement.current.srcObject = stream;
        await videoElement.current.play();
        setStarted(true);
      }
    } catch (err: any) {
      setError(err.message || 'Camera access denied');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startCamera]);

  // Frame callback loop
  useEffect(() => {
    if (!started || !onFrame) return;
    const id = setInterval(() => {
      if (videoElement.current && videoElement.current.readyState >= 2) {
        onFrame(videoElement.current);
      }
    }, frameInterval);
    return () => clearInterval(id);
  }, [started, onFrame, frameInterval]);

  const handleCapture = () => {
    if (!videoElement.current || !onCapture) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.current.videoWidth;
    canvas.height = videoElement.current.videoHeight;
    const ctx = canvas.getContext('2d')!;
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoElement.current, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob, videoElement.current!);
      },
      'image/jpeg',
      0.8
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <VideoOff className="h-8 w-8" />
        <p className="text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={startCamera}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <video
        ref={videoElement as any}
        autoPlay
        playsInline
        muted
        className={`w-full rounded-lg bg-black ${mirror ? 'scale-x-[-1]' : ''}`}
      />
      {!started && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {showCaptureButton && started && (
        <div className="mt-3 flex justify-center">
          <Button onClick={handleCapture} size="lg">
            <Camera className="h-4 w-4 mr-2" />
            Capture Photo
          </Button>
        </div>
      )}
    </div>
  );
}
