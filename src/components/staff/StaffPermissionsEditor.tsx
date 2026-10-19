import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { ALL_PAGES, PAGE_LABELS, type PageName, type PermissionLevel } from '@/hooks/useStaffPermissions';

interface StaffPermissionsEditorProps {
  staffId: string;
  staffName: string;
}

export default function StaffPermissionsEditor({ staffId, staffName }: StaffPermissionsEditorProps) {
  const [permissions, setPermissions] = useState<Record<PageName, PermissionLevel>>(
    Object.fromEntries(ALL_PAGES.map(p => [p, 'edit' as PermissionLevel])) as Record<PageName, PermissionLevel>
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchPermissions();
  }, [staffId]);

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('staff_permissions')
        .select('page_name, permission_level')
        .eq('staff_id', staffId);

      if (error) throw error;

      const merged = Object.fromEntries(
        ALL_PAGES.map(p => [p, 'edit' as PermissionLevel])
      ) as Record<PageName, PermissionLevel>;

      if (data) {
        for (const row of data) {
          if (ALL_PAGES.includes(row.page_name as PageName)) {
            merged[row.page_name as PageName] = row.permission_level as PermissionLevel;
          }
        }
      }
      setPermissions(merged);
    } catch (err) {
      console.error('Failed to load permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (page: PageName, level: PermissionLevel) => {
    setPermissions(prev => ({ ...prev, [page]: level }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Upsert all permissions
      const rows = ALL_PAGES.map(page => ({
        staff_id: staffId,
        page_name: page,
        permission_level: permissions[page],
      }));

      const { error } = await supabase
        .from('staff_permissions')
        .upsert(rows, { onConflict: 'staff_id,page_name' });

      if (error) throw error;

      toast({ title: 'Success', description: `Permissions updated for ${staffName}` });
    } catch (err: any) {
      console.error('Save permissions error:', err);
      toast({ title: 'Error', description: err?.message || 'Failed to save permissions', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Access Control — {staffName}
        </CardTitle>
        <CardDescription>
          Set page-level permissions for this staff member. Changes apply on their next login/page load.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Page / Module</TableHead>
                <TableHead className="text-center">No Access</TableHead>
                <TableHead className="text-center">Read Only</TableHead>
                <TableHead className="text-center">Full Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ALL_PAGES.map(page => (
                <TableRow key={page}>
                  <TableCell className="font-medium">
                    {PAGE_LABELS[page]}
                  </TableCell>
                  {(['no_access', 'read', 'edit'] as PermissionLevel[]).map(level => (
                    <TableCell key={level} className="text-center">
                      <RadioGroup
                        value={permissions[page]}
                        onValueChange={(v) => handleChange(page, v as PermissionLevel)}
                        className="flex justify-center"
                      >
                        <RadioGroupItem
                          value={level}
                          id={`${page}-${level}`}
                          checked={permissions[page] === level}
                        />
                      </RadioGroup>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs">No Access</Badge> Hidden from navigation
            <Badge variant="outline" className="text-xs">Read Only</Badge> View only, no edits
            <Badge variant="outline" className="text-xs">Full Access</Badge> Normal behavior
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : 'Save Permissions'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
