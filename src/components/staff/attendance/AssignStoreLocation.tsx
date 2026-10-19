import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, Save, Navigation, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface BranchOption {
  id: string;
  name: string;
}

interface AttendanceSettings {
  id?: string;
  branch_id: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  work_start_time: string;
  late_start_time: string;
  absent_start_time: string;
  work_end_time: string;
}

export default function AssignStoreLocation() {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [capturingGPS, setCapturingGPS] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => {
    fetchBranches();
  }, [profile]);

  useEffect(() => {
    if (selectedBranch) fetchSettings(selectedBranch);
  }, [selectedBranch]);

  const fetchBranches = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id)
      .order('name');
    setBranches(data || []);
    if (data?.length && !selectedBranch) setSelectedBranch(data[0].id);
  };

  const fetchSettings = async (branchId: string) => {
    const { data } = await supabase
      .from('branch_attendance_settings')
      .select('*')
      .eq('branch_id', branchId)
      .maybeSingle();

    if (data) {
      setSettings(data);
    } else {
      setSettings({
        branch_id: branchId,
        latitude: null,
        longitude: null,
        radius_meters: 100,
        work_start_time: '08:00',
        late_start_time: '08:30',
        absent_start_time: '09:00',
        work_end_time: '17:00',
      });
    }
  };

  const captureGPS = () => {
    if (!navigator.geolocation) {
      toast({ title: 'Error', description: 'Geolocation is not supported by your browser', variant: 'destructive' });
      return;
    }
    setCapturingGPS(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSettings((prev) =>
          prev ? { ...prev, latitude: pos.coords.latitude, longitude: pos.coords.longitude } : prev
        );
        setCapturingGPS(false);
        toast({ title: 'Location Captured', description: `Lat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)}` });
      },
      (err) => {
        setCapturingGPS(false);
        toast({ title: 'GPS Error', description: err.message, variant: 'destructive' });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSave = async () => {
    if (!settings || !selectedBranch) return;
    if (!settings.latitude || !settings.longitude) {
      toast({ title: 'Error', description: 'Please capture the store GPS location first', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        branch_id: selectedBranch,
        latitude: settings.latitude,
        longitude: settings.longitude,
        radius_meters: settings.radius_meters,
        work_start_time: settings.work_start_time,
        late_start_time: settings.late_start_time,
        absent_start_time: settings.absent_start_time,
        work_end_time: settings.work_end_time,
        updated_at: new Date().toISOString(),
      };

      if (settings.id) {
        const { error } = await supabase
          .from('branch_attendance_settings')
          .update(payload)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('branch_attendance_settings')
          .insert(payload);
        if (error) throw error;
      }

      toast({ title: 'Success', description: 'Attendance settings saved successfully' });
      fetchSettings(selectedBranch);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Label>Select Branch</Label>
        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GPS Location Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Store Location
            </CardTitle>
            <CardDescription>Assign GPS coordinates for attendance verification</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={captureGPS} disabled={capturingGPS} className="w-full">
              <Navigation className="h-4 w-4 mr-2" />
              {capturingGPS ? 'Capturing GPS...' : 'Assign Store Location'}
            </Button>

            {settings.latitude && settings.longitude && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm">
                  Lat: {settings.latitude.toFixed(6)}, Lng: {settings.longitude.toFixed(6)}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input
                  type="number"
                  step="any"
                  value={settings.latitude ?? ''}
                  onChange={(e) => setSettings({ ...settings, latitude: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="e.g. 9.0192"
                />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input
                  type="number"
                  step="any"
                  value={settings.longitude ?? ''}
                  onChange={(e) => setSettings({ ...settings, longitude: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="e.g. 38.7525"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Attendance Radius (meters)</Label>
              <Input
                type="number"
                value={settings.radius_meters}
                onChange={(e) => setSettings({ ...settings, radius_meters: parseInt(e.target.value) || 100 })}
                min={10}
                max={5000}
              />
              <p className="text-xs text-muted-foreground">
                Staff must be within {settings.radius_meters}m of the store to record attendance
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Time Rules Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Attendance Time Rules
            </CardTitle>
            <CardDescription>Configure work hours and attendance thresholds</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Work Start Time</Label>
              <Input
                type="time"
                value={settings.work_start_time}
                onChange={(e) => setSettings({ ...settings, work_start_time: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Check-in before this time = <Badge variant="default" className="text-xs">Present</Badge></p>
            </div>
            <div className="space-y-2">
              <Label>Late Start Time</Label>
              <Input
                type="time"
                value={settings.late_start_time}
                onChange={(e) => setSettings({ ...settings, late_start_time: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Check-in between work start and this time = <Badge variant="secondary" className="text-xs">Late</Badge></p>
            </div>
            <div className="space-y-2">
              <Label>Absent Start Time</Label>
              <Input
                type="time"
                value={settings.absent_start_time}
                onChange={(e) => setSettings({ ...settings, absent_start_time: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Check-in after this time = <Badge variant="destructive" className="text-xs">Absent</Badge></p>
            </div>
            <div className="space-y-2">
              <Label>Work End Time</Label>
              <Input
                type="time"
                value={settings.work_end_time}
                onChange={(e) => setSettings({ ...settings, work_end_time: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSave} disabled={saving} size="lg">
        <Save className="h-4 w-4 mr-2" />
        {saving ? 'Saving...' : 'Save Attendance Settings'}
      </Button>
    </div>
  );
}
