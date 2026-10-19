import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LogIn, LogOut, MapPin, Clock, AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { haversineDistance } from '@/lib/haversine';
import FaceVerification from '../face/FaceVerification';
import CameraCapture from '../face/CameraCapture';

interface TodayRecord {
  id: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_lat: number | null;
  checkin_long: number | null;
  checkout_lat: number | null;
  checkout_long: number | null;
  attendance_status: string;
  checkin_face_verified: boolean | null;
  checkout_face_verified: boolean | null;
  verification_score: number | null;
}

interface BranchSettings {
  latitude: number;
  longitude: number;
  radius_meters: number;
  work_start_time: string;
  late_start_time: string;
  absent_start_time: string;
  work_end_time: string;
}

export default function RecordAttendance() {
  const [todayRecord, setTodayRecord] = useState<TodayRecord | null>(null);
  const [branchSettings, setBranchSettings] = useState<BranchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showFaceVerify, setShowFaceVerify] = useState<'checkin' | 'checkout' | null>(null);
  const [showPhotoCapture, setShowPhotoCapture] = useState<'checkin' | 'checkout' | null>(null);
  const [pendingLocation, setPendingLocation] = useState<{ lat: number; lng: number; distance: number } | null>(null);
  const [hasFaceData, setHasFaceData] = useState<boolean>(false);
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  const branchId = profile?.branch_id || selectedBranch;

  const formatTimeTo12Hr = (time24: string): string => {
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const isAfterWorkEnd = useMemo(() => {
    if (!branchSettings?.work_end_time) return true;
    const now = currentTime.toTimeString().slice(0, 5);
    return now >= branchSettings.work_end_time;
  }, [currentTime, branchSettings?.work_end_time]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (branchId && user?.id) {
      fetchData();
    }
  }, [branchId, user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [settingsRes, attendanceRes, faceRes] = await Promise.all([
        supabase
          .from('branch_attendance_settings')
          .select('latitude, longitude, radius_meters, work_start_time, late_start_time, absent_start_time, work_end_time')
          .eq('branch_id', branchId)
          .maybeSingle(),
        supabase
          .from('staff_attendance')
          .select('id, checkin_time, checkout_time, attendance_status, checkin_face_verified, checkout_face_verified, verification_score')
          .eq('staff_id', user!.id)
          .eq('date', today)
          .maybeSingle(),
        supabase
          .from('staff_face_data')
          .select('id')
          .eq('staff_id', user!.id)
          .maybeSingle(),
      ]);

      setBranchSettings(settingsRes.data || null);
      setTodayRecord(attendanceRes.data || null);
      setHasFaceData(!!faceRes.data);
    } catch (error) {
      console.error('Failed to fetch attendance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const determineStatus = (checkinTime: Date, settings: BranchSettings): string => {
    const timeStr = checkinTime.toTimeString().slice(0, 5);
    if (timeStr <= settings.work_start_time) return 'present';
    if (timeStr <= settings.late_start_time) return 'present';
    if (timeStr <= settings.absent_start_time) return 'late';
    return 'absent';
  };

  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
      });
    });
  };

  const startCheckIn = async () => {
    if (!branchSettings || !branchId || !user?.id) return;
    if (!branchSettings.latitude || !branchSettings.longitude) {
      toast({ title: 'Error', description: 'Store location has not been set. Contact your admin.', variant: 'destructive' });
      return;
    }

    setRecording(true);
    try {
      const pos = await getCurrentPosition();
      const distance = haversineDistance(
        pos.coords.latitude, pos.coords.longitude,
        branchSettings.latitude, branchSettings.longitude
      );

      if (distance > branchSettings.radius_meters) {
        toast({
          title: 'Outside Store Location',
          description: `You are ${Math.round(distance)}m away. Must be within ${branchSettings.radius_meters}m.`,
          variant: 'destructive',
        });
        setRecording(false);
        return;
      }

      // If face data registered, require face verification
      if (hasFaceData) {
        setPendingLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, distance });
        setShowFaceVerify('checkin');
        setRecording(false);
      } else {
        // No face data — show camera to capture photo
        setPendingLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, distance });
        setShowPhotoCapture('checkin');
        setRecording(false);
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to check in', variant: 'destructive' });
      setRecording(false);
    }
  };

  const uploadWithRetry = async (path: string, blob: Blob, retries = 2): Promise<string> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const { data, error } = await supabase.storage
        .from('attendance-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

      if (!error) {
        console.log('Photo uploaded successfully:', data);
        return path;
      }

      console.error(`Upload attempt ${attempt + 1} failed:`, error);
      
      if (attempt < retries && error.message?.includes('row-level security')) {
        // Check auth session is still valid
        const { data: session } = await supabase.auth.getSession();
        if (!session?.session) {
          throw new Error('Your session has expired. Please log in again.');
        }
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      throw error;
    }
    throw new Error('Upload failed after retries');
  };

  const completeCheckIn = async (
    lat: number, lng: number, distance: number,
    faceVerified: boolean, photoBlob: Blob | null, score: number
  ) => {
    setRecording(true);
    try {
      const now = new Date();
      const status = determineStatus(now, branchSettings!);
      const today = now.toISOString().split('T')[0];

      if (!photoBlob) {
        throw new Error('Photo capture failed — please try again.');
      }

      const checkinPath = `${user!.id}/${today}/checkin_${Date.now()}.jpg`;
      console.log('Uploading check-in photo:', { path: checkinPath, blobSize: photoBlob.size });
      
      const checkinPhotoPath = await uploadWithRetry(checkinPath, photoBlob);

      const { error } = await supabase.from('staff_attendance').insert({
        staff_id: user!.id,
        branch_id: branchId,
        date: today,
        checkin_time: now.toISOString(),
        checkin_lat: lat,
        checkin_long: lng,
        attendance_status: status,
        checkin_face_verified: faceVerified,
        checkin_photo: checkinPhotoPath,
        verification_score: score,
      });

      if (error) throw error;
      toast({
        title: 'Checked In ✅',
        description: `Status: ${status.charAt(0).toUpperCase() + status.slice(1)} (${Math.round(distance)}m from store)${faceVerified ? ' • Face verified' : ''}`,
      });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to check in', variant: 'destructive' });
    } finally {
      setRecording(false);
      setShowFaceVerify(null);
      setPendingLocation(null);
    }
  };

  const startCheckOut = async () => {
    if (!branchSettings || !todayRecord) return;
    if (!branchSettings.latitude || !branchSettings.longitude) {
      toast({ title: 'Error', description: 'Store location has not been set.', variant: 'destructive' });
      return;
    }

    setRecording(true);
    try {
      const pos = await getCurrentPosition();
      const distance = haversineDistance(
        pos.coords.latitude, pos.coords.longitude,
        branchSettings.latitude, branchSettings.longitude
      );

      if (distance > branchSettings.radius_meters) {
        toast({
          title: 'Outside Store Location',
          description: `You are ${Math.round(distance)}m away. Must be within ${branchSettings.radius_meters}m.`,
          variant: 'destructive',
        });
        setRecording(false);
        return;
      }

      if (hasFaceData) {
        setPendingLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, distance });
        setShowFaceVerify('checkout');
        setRecording(false);
      } else {
        // No face data — show camera to capture photo
        setPendingLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, distance });
        setShowPhotoCapture('checkout');
        setRecording(false);
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to check out', variant: 'destructive' });
      setRecording(false);
    }
  };

  const completeCheckOut = async (
    lat: number, lng: number,
    faceVerified: boolean, photoBlob: Blob | null, score: number
  ) => {
    setRecording(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      if (!photoBlob) {
        throw new Error('Photo capture failed — please try again.');
      }

      const checkoutPath = `${user!.id}/${today}/checkout_${Date.now()}.jpg`;
      console.log('Uploading check-out photo:', { path: checkoutPath, blobSize: photoBlob.size });
      
      const checkoutPhotoPath = await uploadWithRetry(checkoutPath, photoBlob);

      const { error } = await supabase
        .from('staff_attendance')
        .update({
          checkout_time: new Date().toISOString(),
          checkout_lat: lat,
          checkout_long: lng,
          checkout_face_verified: faceVerified,
          checkout_photo: checkoutPhotoPath,
          verification_score: score,
        })
        .eq('id', todayRecord!.id);

      if (error) throw error;
      toast({ title: 'Checked Out ✅', description: `Have a great rest of your day!${faceVerified ? ' • Face verified' : ''}` });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to check out', variant: 'destructive' });
    } finally {
      setRecording(false);
      setShowFaceVerify(null);
      setPendingLocation(null);
    }
  };

  const handleFaceVerified = (score: number, photoBlob: Blob) => {
    if (showFaceVerify === 'checkin' && pendingLocation) {
      completeCheckIn(pendingLocation.lat, pendingLocation.lng, pendingLocation.distance, true, photoBlob, score);
    } else if (showFaceVerify === 'checkout' && pendingLocation) {
      completeCheckOut(pendingLocation.lat, pendingLocation.lng, true, photoBlob, score);
    }
  };

  const handleFaceFailed = (reason: string) => {
    toast({ title: 'Face Verification Failed', description: reason, variant: 'destructive' });

    // Log suspicious activity
    if (user?.id) {
      supabase.from('attendance_suspicious_alerts').insert({
        staff_id: user.id,
        branch_id: branchId,
        alert_type: showFaceVerify === 'checkin' ? 'checkin_face_fail' : 'checkout_face_fail',
        description: reason,
      }).then(() => {});
    }

    setShowFaceVerify(null);
    setPendingLocation(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!branchSettings) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Attendance settings have not been configured for your branch.</p>
          <p className="text-sm text-muted-foreground mt-1">Please contact your admin to set up the store location.</p>
        </CardContent>
      </Card>
    );
  }

  // Show face verification modal
  if (showFaceVerify && user?.id) {
    return (
      <FaceVerification
        staffId={user.id}
        onVerified={handleFaceVerified}
        onFailed={handleFaceFailed}
        onCancel={() => {
          setShowFaceVerify(null);
          setPendingLocation(null);
        }}
      />
    );
  }

  // Show photo capture for staff without face data
  if (showPhotoCapture && pendingLocation) {
    const handlePhotoCaptured = (blob: Blob) => {
      if (showPhotoCapture === 'checkin') {
        completeCheckIn(pendingLocation.lat, pendingLocation.lng, pendingLocation.distance, false, blob, 0);
      } else {
        completeCheckOut(pendingLocation.lat, pendingLocation.lng, false, blob, 0);
      }
      setShowPhotoCapture(null);
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Take a Photo — {showPhotoCapture === 'checkin' ? 'Check-In' : 'Check-Out'}
          </CardTitle>
          <CardDescription>Please capture your photo for attendance verification</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CameraCapture
            showCaptureButton={true}
            onCapture={handlePhotoCaptured}
            mirror={true}
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setShowPhotoCapture(null);
              setPendingLocation(null);
            }}
          >
            Cancel
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasCheckedIn = !!todayRecord?.checkin_time;
  const hasCheckedOut = !!todayRecord?.checkout_time;

  const statusColor = todayRecord?.attendance_status === 'present'
    ? 'default'
    : todayRecord?.attendance_status === 'late'
    ? 'secondary'
    : 'destructive';

  return (
    <div className="space-y-6">
      {/* Face verification status */}
      {hasFaceData && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>Face verification is <strong>enabled</strong> for your account</span>
        </div>
      )}
      {!hasFaceData && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <span>Face data not registered. Attendance will be recorded without face verification. Contact your admin.</span>
        </div>
      )}

      {/* Current Time Display */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-primary" />
              <div>
                <p className="text-3xl font-bold font-mono">
                  {currentTime.toLocaleTimeString()}
                </p>
                <p className="text-sm text-muted-foreground">
                  {currentTime.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            {todayRecord && (
              <div className="flex items-center gap-2">
                {todayRecord.checkin_face_verified && (
                  <Badge variant="outline" className="gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Face ✓
                  </Badge>
                )}
                <Badge variant={statusColor} className="text-sm px-3 py-1">
                  {todayRecord.attendance_status.charAt(0).toUpperCase() + todayRecord.attendance_status.slice(1)}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Check-In Card */}
        <Card className={hasCheckedIn ? 'border-green-500/30 bg-green-500/5' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5" />
              Check-In
            </CardTitle>
            <CardDescription>Record your arrival at the store</CardDescription>
          </CardHeader>
          <CardContent>
            {hasCheckedIn ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Checked in at {new Date(todayRecord!.checkin_time!).toLocaleTimeString()}</span>
                </div>
                {todayRecord!.checkin_face_verified && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    Face verified ({todayRecord!.verification_score}% match)
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={startCheckIn} disabled={recording} className="w-full" size="lg">
                {recording ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
                {recording ? 'Verifying Location...' : hasFaceData ? 'Check-In (GPS + Face)' : 'Record Check-In'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Check-Out Card */}
        <Card className={hasCheckedOut ? 'border-blue-500/30 bg-blue-500/5' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              Check-Out
            </CardTitle>
            <CardDescription>Record your departure from the store</CardDescription>
          </CardHeader>
          <CardContent>
            {!hasCheckedIn ? (
              <p className="text-sm text-muted-foreground">You must check in first</p>
            ) : hasCheckedOut ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-blue-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Checked out at {new Date(todayRecord!.checkout_time!).toLocaleTimeString()}</span>
                </div>
                {todayRecord!.checkout_face_verified && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    Face verified
                  </div>
                )}
              </div>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="w-full">
                      <Button onClick={startCheckOut} disabled={recording || !isAfterWorkEnd} variant="secondary" className="w-full" size="lg">
                        {recording ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
                        {recording ? 'Verifying Location...' : hasFaceData ? 'Check-Out (GPS + Face)' : 'Record Check-Out'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!isAfterWorkEnd && (
                    <TooltipContent>
                      <p>Checkout will be available after the official work end time.</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Time Rules Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Today's Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Work Start</p>
              <p className="font-medium">{formatTimeTo12Hr(branchSettings.work_start_time)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Late After</p>
              <p className="font-medium">{formatTimeTo12Hr(branchSettings.late_start_time)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Absent After</p>
              <p className="font-medium">{formatTimeTo12Hr(branchSettings.absent_start_time)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Work End</p>
              <p className="font-medium">{formatTimeTo12Hr(branchSettings.work_end_time)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
