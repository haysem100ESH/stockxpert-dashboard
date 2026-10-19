import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Tag, X, Check } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { logActivity } from '@/lib/activityLog';

interface Category {
  id: string;
  name: string;
  system_type: string;
  owner_id: string;
}

export default function CategoryManagement() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [activeTab, setActiveTab] = useState<'pharmacy' | 'general'>('pharmacy');
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' });
  const { toast } = useToast();

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('custom_categories')
      .select('*')
      .order('name');
    if (error) {
      toast({ title: 'Error', description: 'Failed to load categories', variant: 'destructive' });
      return;
    }
    setCategories(data || []);
  };

  const handleAdd = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('custom_categories').insert({
      owner_id: user.id,
      name: trimmed,
      system_type: activeTab,
    });

    if (error) {
      toast({
        title: 'Error',
        description: error.message.includes('duplicate') ? 'Category already exists' : 'Failed to add category',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Success', description: 'Category added' });
      logActivity({ type: 'create_category', entityType: 'category', next: { name: trimmed, system_type: activeTab }, metadata: { name: trimmed } });
      setNewCategoryName('');
      fetchCategories();
      window.dispatchEvent(new Event('categories-updated'));
    }
    setLoading(false);
  };

  const handleUpdate = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;

    const { error } = await supabase.from('custom_categories').update({ name: trimmed }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message.includes('duplicate') ? 'Category already exists' : 'Failed to update', variant: 'destructive' });
    } else {
      const prev = categories.find((c) => c.id === id);
      logActivity({ type: 'edit_category', entityType: 'category', entityId: id, previous: prev ? { name: prev.name } : null, next: { name: trimmed }, metadata: { name: trimmed } });
      toast({ title: 'Success', description: 'Category updated' });
      setEditingId(null);
      fetchCategories();
      window.dispatchEvent(new Event('categories-updated'));
    }
  };

  const handleDelete = async () => {
    const { error } = await supabase.from('custom_categories').delete().eq('id', deleteConfirm.id);
    if (error) {
      toast({ title: 'Error', description: 'Failed to delete category', variant: 'destructive' });
    } else {
      logActivity({ type: 'delete_category', entityType: 'category', entityId: deleteConfirm.id, previous: { name: deleteConfirm.name }, metadata: { name: deleteConfirm.name } });
      toast({ title: 'Success', description: 'Category deleted' });
      fetchCategories();
      window.dispatchEvent(new Event('categories-updated'));
    }
    setDeleteConfirm({ open: false, id: '', name: '' });
  };

  const filtered = categories.filter(c => c.system_type === activeTab);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5" />
          Category Management
        </CardTitle>
        <CardDescription>
          Create and manage categories for your inventory. All categories you create will be available when adding or editing items.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pharmacy' | 'general')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pharmacy">Pharmacy Categories</TabsTrigger>
            <TabsTrigger value="general">General Inventory Categories</TabsTrigger>
          </TabsList>
          <TabsContent value="pharmacy" className="space-y-4" />
          <TabsContent value="general" className="space-y-4" />
        </Tabs>

        {/* Custom categories list */}
        <div>
          <p className="text-sm font-medium mb-2">Your custom categories ({activeTab === 'pharmacy' ? 'Pharmacy' : 'General Inventory'}):</p>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No custom categories yet. Add one below.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map(cat => (
                <div key={cat.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                  {editingId === cat.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="h-8"
                        onKeyDown={e => e.key === 'Enter' && handleUpdate(cat.id)}
                      />
                      <Button size="sm" variant="ghost" onClick={() => handleUpdate(cat.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm">{cat.name}</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm({ open: true, id: cat.id, name: cat.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add new */}
        <div className="flex gap-2">
          <Input
            placeholder={`New ${activeTab === 'pharmacy' ? 'pharmacy' : 'inventory'} category name...`}
            value={newCategoryName}
            onChange={e => setNewCategoryName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={loading || !newCategoryName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>

        <ConfirmationDialog
          open={deleteConfirm.open}
          onOpenChange={open => setDeleteConfirm(prev => ({ ...prev, open }))}
          title="Delete Category"
          description={`Are you sure you want to delete "${deleteConfirm.name}"? This won't affect existing items.`}
          onConfirm={handleDelete}
          confirmText="Delete"
          cancelText="Cancel"
        />
      </CardContent>
    </Card>
  );
}
