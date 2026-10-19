import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Search, Users, Package, FolderOpen, Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ItemGroup {
  id: string;
  group_name: string;
  description: string | null;
  business_type: string;
  created_at: string;
}

interface GroupMember {
  id: string;
  group_id: string;
  medicine_id: string;
  medicine_name?: string;
  medicine_category?: string;
}

interface OwnerGroupAssignment {
  id: string;
  owner_id: string;
  group_id: string;
  owner_name?: string;
  group_name?: string;
  created_at: string;
}

interface CatalogMedicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  item_type?: string;
}

interface Owner {
  id: string;
  full_name: string;
  email?: string;
}

const BUSINESS_TYPES = ['pharmacy', 'general', 'cosmetic', 'veterinary', 'laboratory'] as const;

export default function CatalogManagement() {
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [assignments, setAssignments] = useState<OwnerGroupAssignment[]>([]);
  const [medicines, setMedicines] = useState<CatalogMedicine[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Dialog states
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAssignOwner, setShowAssignOwner] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [memberSearch, setMemberSearch] = useState('');

  // Form states
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupType, setNewGroupType] = useState<string>('pharmacy');
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<string[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [assignGroupId, setAssignGroupId] = useState('');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchGroups(), fetchMembers(), fetchAssignments(), fetchMedicines(), fetchOwners()]);
    setLoading(false);
  };

  const fetchGroups = async () => {
    const { data } = await supabase.from('grouped_items').select('*').order('group_name');
    setGroups(data || []);
  };

  const fetchMembers = async () => {
    const { data } = await supabase
      .from('grouped_item_members')
      .select('id, group_id, medicine_id')
      .order('created_at', { ascending: false });
    
    if (data && data.length > 0) {
      const medIds = [...new Set(data.map((m: any) => m.medicine_id))];
      const { data: meds } = await supabase
        .from('medicines')
        .select('id, name, category')
        .in('id', medIds);
      const medMap: Record<string, any> = {};
      (meds || []).forEach((m: any) => { medMap[m.id] = m; });
      setMembers(data.map((m: any) => ({
        ...m,
        medicine_name: medMap[m.medicine_id]?.name || 'Unknown',
        medicine_category: medMap[m.medicine_id]?.category || '',
      })));
    } else {
      setMembers([]);
    }
  };

  const fetchAssignments = async () => {
    const { data } = await supabase
      .from('owner_item_groups')
      .select('id, owner_id, group_id, created_at')
      .order('created_at', { ascending: false });
    
    if (data && data.length > 0) {
      const ownerIds = [...new Set(data.map((a: any) => a.owner_id))];
      const groupIds = [...new Set(data.map((a: any) => a.group_id))];
      
      const [ownersRes, groupsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').in('id', ownerIds),
        supabase.from('grouped_items').select('id, group_name').in('id', groupIds),
      ]);
      
      const ownerMap: Record<string, string> = {};
      (ownersRes.data || []).forEach((o: any) => { ownerMap[o.id] = o.full_name; });
      const groupMap: Record<string, string> = {};
      (groupsRes.data || []).forEach((g: any) => { groupMap[g.id] = g.group_name; });
      
      setAssignments(data.map((a: any) => ({
        ...a,
        owner_name: ownerMap[a.owner_id] || 'Unknown',
        group_name: groupMap[a.group_id] || 'Unknown',
      })));
    } else {
      setAssignments([]);
    }
  };

  const fetchMedicines = async () => {
    const { data } = await supabase
      .from('medicines')
      .select('id, name, generic_name, category, manufacturer, item_type')
      .order('name');
    setMedicines(data || []);
  };

  const fetchOwners = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'owner')
      .order('full_name');
    setOwners(data || []);
  };

  // Actions
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('grouped_items').insert({
      group_name: newGroupName.trim(),
      description: newGroupDesc.trim() || null,
      business_type: newGroupType,
      created_by: user?.id,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Item group created' });
      setNewGroupName('');
      setNewGroupDesc('');
      setShowAddGroup(false);
      fetchGroups();
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    const { error } = await supabase.from('grouped_items').delete().eq('id', groupId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Deleted', description: 'Group removed' });
      fetchGroups();
      fetchMembers();
      fetchAssignments();
    }
  };

  const handleAddMembers = async () => {
    if (!selectedGroupId || selectedMedicineIds.length === 0) return;
    const rows = selectedMedicineIds.map(mid => ({ group_id: selectedGroupId, medicine_id: mid }));
    const { error } = await supabase.from('grouped_item_members').insert(rows);
    if (error) {
      toast({ title: 'Error', description: error.code === '23505' ? 'Some items already in this group' : error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Added', description: `${selectedMedicineIds.length} item(s) added to group` });
      setSelectedMedicineIds([]);
      setMemberSearch('');
      fetchMembers();
    }
  };

  const toggleMedicineSelection = (id: string) => {
    setSelectedMedicineIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase.from('grouped_item_members').delete().eq('id', memberId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchMembers();
    }
  };

  const handleAssignOwner = async () => {
    if (!selectedOwnerId || !assignGroupId) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('owner_item_groups').insert({
      owner_id: selectedOwnerId,
      group_id: assignGroupId,
      assigned_by: user?.id,
    });
    if (error) {
      toast({ title: 'Error', description: error.code === '23505' ? 'Owner already has this group' : error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Assigned', description: 'Group assigned to owner' });
      setSelectedOwnerId('');
      setAssignGroupId('');
      setShowAssignOwner(false);
      fetchAssignments();
    }
  };

  const handleRemoveAssignment = async (assignmentId: string) => {
    const { error } = await supabase.from('owner_item_groups').delete().eq('id', assignmentId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchAssignments();
    }
  };

  const existingMedicineIds = new Set(members.filter(m => m.group_id === selectedGroupId).map(m => m.medicine_id));
  const filteredMedicines = medicines.filter(m =>
    !existingMedicineIds.has(m.id) &&
    (m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    (m.generic_name || '').toLowerCase().includes(memberSearch.toLowerCase()))
  );

  const groupMembersForSelected = members.filter(m => m.group_id === selectedGroupId);

  if (loading) return <div className="text-muted-foreground p-4">Loading catalog data...</div>;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="groups" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="groups">
            <FolderOpen className="h-4 w-4 mr-1" />
            Item Groups
          </TabsTrigger>
          <TabsTrigger value="members">
            <Package className="h-4 w-4 mr-1" />
            Group Members
          </TabsTrigger>
          <TabsTrigger value="assignments">
            <Users className="h-4 w-4 mr-1" />
            Owner Assignments
          </TabsTrigger>
        </TabsList>

        {/* GROUPS TAB */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Item Groups</h3>
            <Button size="sm" onClick={() => setShowAddGroup(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create Group
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group Name</TableHead>
                <TableHead>Business Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(g => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.group_name}</TableCell>
                  <TableCell><Badge variant="outline">{g.business_type}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{g.description || '—'}</TableCell>
                  <TableCell>{members.filter(m => m.group_id === g.id).length}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteGroup(g.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {groups.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No groups created yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {/* Create Group Dialog */}
          <Dialog open={showAddGroup} onOpenChange={setShowAddGroup}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Item Group</DialogTitle>
                <DialogDescription>Group items by business type for owner access control</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Group Name *</Label>
                  <Input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="e.g. Pharmacy Medicines" />
                </div>
                <div className="space-y-2">
                  <Label>Business Type *</Label>
                  <Select value={newGroupType} onValueChange={setNewGroupType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} placeholder="Optional description" />
                </div>
                <Button onClick={handleCreateGroup} disabled={!newGroupName.trim()}>Create Group</Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* MEMBERS TAB */}
        <TabsContent value="members" className="space-y-4">
          <div className="flex justify-between items-center gap-4">
            <h3 className="text-lg font-semibold">Group Members</h3>
          </div>

          <div className="flex gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label>Select Group</Label>
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger><SelectValue placeholder="Choose a group" /></SelectTrigger>
                <SelectContent>
                  {groups.map(g => (
                    <SelectItem key={g.id} value={g.id}>{g.group_name} ({g.business_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedGroupId && (
            <>
              {/* Add medicine to group */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add Items to Group</CardTitle>
                  <CardDescription>Select multiple items and add them all at once</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      placeholder="Search catalog items..."
                      className="pl-8"
                    />
                  </div>
                  {selectedMedicineIds.length > 0 && (
                    <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                      <span className="text-sm font-medium">{selectedMedicineIds.length} item(s) selected</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedMedicineIds([])}>Clear</Button>
                        <Button size="sm" onClick={handleAddMembers}>
                          <Plus className="h-4 w-4 mr-1" /> Add Selected
                        </Button>
                      </div>
                    </div>
                  )}
                  <ScrollArea className="h-[240px] rounded-md border">
                    <div className="p-2 space-y-1">
                      {filteredMedicines.slice(0, 100).map(m => (
                        <label
                          key={m.id}
                          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent cursor-pointer transition-colors"
                        >
                          <Checkbox
                            checked={selectedMedicineIds.includes(m.id)}
                            onCheckedChange={() => toggleMedicineSelection(m.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{m.name}</p>
                            <p className="text-xs text-muted-foreground">{m.category}{m.generic_name ? ` · ${m.generic_name}` : ''}</p>
                          </div>
                        </label>
                      ))}
                      {filteredMedicines.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No items found</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Members list */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupMembersForSelected.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.medicine_name}</TableCell>
                      <TableCell><Badge variant="outline">{m.medicine_category}</Badge></TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveMember(m.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {groupMembersForSelected.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No items in this group</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </TabsContent>

        {/* ASSIGNMENTS TAB */}
        <TabsContent value="assignments" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Owner Group Assignments</h3>
            <Button size="sm" onClick={() => setShowAssignOwner(true)}>
              <Plus className="h-4 w-4 mr-1" /> Assign Group
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.owner_name}</TableCell>
                  <TableCell><Badge variant="outline">{a.group_name}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleRemoveAssignment(a.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {assignments.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No assignments yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {/* Assign Dialog */}
          <Dialog open={showAssignOwner} onOpenChange={setShowAssignOwner}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Group to Owner</DialogTitle>
                <DialogDescription>Select an owner and a group to grant access</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Owner *</Label>
                  <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId}>
                    <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      {owners.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Group *</Label>
                  <Select value={assignGroupId} onValueChange={setAssignGroupId}>
                    <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                    <SelectContent>
                      {groups.map(g => (
                        <SelectItem key={g.id} value={g.id}>{g.group_name} ({g.business_type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleAssignOwner} disabled={!selectedOwnerId || !assignGroupId}>
                  Assign Group
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
