/**
 * MedicineCodeCombobox
 * --------------------------------------------------------------------------
 * Searchable dropdown of medicine codes with an inline "+ Create new code"
 * popover. Used inside Add/Edit Medicine forms.
 */
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus, Info } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMedicineCodes } from '@/hooks/useMedicineCodes';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Props {
  value: string | null;            // medicine_code_id
  onChange: (id: string | null) => void;
}

export default function MedicineCodeCombobox({ value, onChange }: Props) {
  const { codes, create, loading } = useMedicineCodes();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const selected = useMemo(() => codes.find((c) => c.id === value) || null, [codes, value]);

  const handleCreate = async () => {
    if (!newCode.trim() || !newLabel.trim()) {
      toast({ title: 'Code and label are required', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const created = await create({ code: newCode, label: newLabel, notes: newNotes });
      onChange(created.id);
      toast({ title: 'Code created', description: `${created.code} — ${created.label}` });
      setNewCode(''); setNewLabel(''); setNewNotes('');
      setCreateOpen(false);
      setOpen(false);
    } catch (e: any) {
      toast({
        title: 'Could not create code',
        description: e?.message?.includes('unique') ? 'A code with this value already exists.' : (e?.message || 'Unknown error'),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>Medicine Code</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              Assign a code to group this medicine with other variants for combined stock reporting.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {selected ? (
              <span className="truncate"><span className="font-mono mr-2">{selected.code}</span>{selected.label}</span>
            ) : (
              <span className="text-muted-foreground">{loading ? 'Loading codes…' : 'Select or create a code'}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search codes…" />
            <CommandList>
              <CommandEmpty>No matching code.</CommandEmpty>
              {value && (
                <CommandGroup>
                  <CommandItem onSelect={() => { onChange(null); setOpen(false); }}>
                    <span className="text-muted-foreground italic">Clear selection</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup>
                {codes.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.code} ${c.label}`}
                    onSelect={() => { onChange(c.id); setOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === c.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="font-mono mr-2">{c.code}</span>
                    <span className="truncate">{c.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem
                  onSelect={() => { setCreateOpen(true); setOpen(false); }}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create new code
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={createOpen} onOpenChange={setCreateOpen}>
        <PopoverTrigger asChild><span className="hidden" /></PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new_code">Code *</Label>
              <Input id="new_code" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. AMOX-500" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new_label">Label *</Label>
              <Input id="new_label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Amoxicillin 500mg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new_notes">Notes</Label>
              <Textarea id="new_notes" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="button" size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
