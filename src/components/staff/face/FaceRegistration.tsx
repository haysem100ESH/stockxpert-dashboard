import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Camera, CheckCircle2, Loader2, UserCircle2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { loadFaceModels, detectSingleFace } from '@/lib/faceApi';
import CameraCapture from './CameraCapture';

interface FaceRegistrationProps {
  staffId: string;
  staffName: string;
  onComplete?: () => void;
}

const REQUIRED_SAMPLES = 7; // More samples for better ArcFace accuracy

export default function FaceRegistration({ staffId, staffName, onComplete }: FaceRegistrationProps) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'capturing' | 'saving' | 'done'>('idle');
  const [samples, setSamples] = useState<Float32Array[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loadingProgress, setLoadingProgress] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [hasRegistered, setHasRegistered] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

  // Check if staff already has face data
  const checkExisting = useCallback(async () => {
    const { data } = await supabase
      .from('staff_face_data')
      .select('id')
      .eq('staff_id', staffId)
      .maybeSingle();
    setHasRegistered(!!data);
  }, [staffId]);

  useState(() => {
    checkExisting();
  });

  const startRegistration = async () => {
    setPhase('loading');
    setDownloadPercent(0);
    setLoadingProgress('Loading AI face recognition models...');
    try {
      await loadFaceModels((percent) => {
        setDownloadPercent(percent);
        if (percent < 90) setLoadingProgress(`Downloading ArcFace model... ${percent}%`);
        else if (percent < 100) setLoadingProgress('Initializing model...');
        else setLoadingProgress('Models ready!');
      });
      setPhase('capturing');
      setSamples([]);
      setFeedback(`Look at the camera. We need ${REQUIRED_SAMPLES} captures from slightly different angles.`);
    } catch (err: any) {
      toast({ title: 'Error', description: 'Failed to load face models: ' + (err.message || ''), variant: 'destructive' });
      setPhase('idle');
    }
  };

  const handleCapture = async (_blob: Blob, video: HTMLVideoElement) => {
    if (samples.length >= REQUIRED_SAMPLES) return;

    setFeedback('Analyzing face with ArcFace AI...');
    const result = await detectSingleFace(video);

    if (!result) {
      setFeedback('No face detected or multiple faces found. Please ensure only your face is visible.');
      return;
    }

    const newSamples = [...samples, result.descriptor];
    setSamples(newSamples);

    if (newSamples.length < REQUIRED_SAMPLES) {
      setFeedback(`Captured ${newSamples.length}/${REQUIRED_SAMPLES}. Tilt your head slightly and capture again.`);
    } else {
      setFeedback('All samples captured! Saving...');
      await saveFaceData(newSamples);
    }
  };

  const saveFaceData = async (descriptors: Float32Array[]) => {
    setPhase('saving');
    try {
      // Convert 512-d Float32Array descriptors to storable format
      const embeddingsJson = descriptors.map((d) => Array.from(d));

      const { error } = await supabase.from('staff_face_data').upsert(
        {
          staff_id: staffId,
          embeddings: embeddingsJson,
          sample_count: descriptors.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'staff_id' }
      );

      if (error) throw error;

      setPhase('done');
      setHasRegistered(true);
      setFeedback('Face registered successfully!');
      toast({ title: 'Success', description: `Face data registered for ${staffName} (${descriptors[0].length}-dim ArcFace embeddings)` });
      onComplete?.();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to save face data', variant: 'destructive' });
      setPhase('capturing');
    }
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from('staff_face_data').delete().eq('staff_id', staffId);
      if (error) throw error;
      setHasRegistered(false);
      setSamples([]);
      setPhase('idle');
      toast({ title: 'Deleted', description: 'Face data has been removed' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5" />
          Face Registration — {staffName}
        </CardTitle>
        <CardDescription>
          Register using ArcFace AI (512-dim embeddings via ONNX Runtime)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasRegistered && phase === 'idle' && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-green-500/30 bg-green-500/5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium">Face data registered (ArcFace)</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={startRegistration}>
                Re-register
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {phase === 'idle' && !hasRegistered && (
          <Button onClick={startRegistration} className="w-full" size="lg">
            <Camera className="h-4 w-4 mr-2" />
            Start Face Registration
          </Button>
        )}

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm text-center">{loadingProgress}</span>
            <Progress value={downloadPercent} className="w-full max-w-xs" />
            <p className="text-xs text-muted-foreground/70">
              {downloadPercent < 90
                ? `Downloading ArcFace model (~30MB, cached after first use)`
                : 'Preparing ONNX runtime...'}
            </p>
          </div>
        )}

        {phase === 'capturing' && (
          <div className="space-y-4">
            <CameraCapture
              videoRef={videoRef}
              showCaptureButton
              onCapture={handleCapture}
            />
            <Progress value={(samples.length / REQUIRED_SAMPLES) * 100} />
            <p className="text-sm text-muted-foreground text-center">{feedback}</p>
          </div>
        )}

        {phase === 'saving' && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Saving face embeddings...</span>
          </div>
        )}

        {phase === 'done' && (
          <div className="text-center py-4">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
            <p className="font-medium">Face Registration Complete</p>
            <p className="text-sm text-muted-foreground mt-1">
              {REQUIRED_SAMPLES} samples × 512-dim ArcFace embeddings stored
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Powered by ArcFace (industry-grade face recognition). Ensure good lighting and a clear view of the face. Capture from slightly different angles for better accuracy.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
