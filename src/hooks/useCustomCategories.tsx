import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/db';

export function useCustomCategories(systemType: 'pharmacy' | 'general') {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('custom_categories')
      .select('name')
      .eq('system_type', systemType)
      .order('name');

    const customNames = (data || []).map((c: { name: string }) => c.name);
    setCategories(customNames);
    setLoading(false);
  }, [systemType]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Real-time subscription for category changes
  useEffect(() => {
    const channel = supabase
      .channel(`custom-categories-${systemType}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'custom_categories' },
        () => { fetchCategories(); }
      )
      .subscribe();

    // Also listen for explicit refetch events from same-client mutations
    const handleCategoriesUpdated = () => { fetchCategories(); };
    window.addEventListener('categories-updated', handleCategoriesUpdated);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('categories-updated', handleCategoriesUpdated);
    };
  }, [systemType, fetchCategories]);

  return { categories, loading };
}

