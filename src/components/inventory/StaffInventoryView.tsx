import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Edit2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  selling_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
}

export default function StaffInventoryView() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [tempStock, setTempStock] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchMedicines();
  }, []);

  useEffect(() => {
    const filtered = medicines.filter(medicine =>
      medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredMedicines(filtered);
  }, [medicines, searchTerm]);

  const fetchMedicines = async () => {
    try {
      const { data, error } = await supabase
        .from('medicines')
        .select('id, name, generic_name, category, selling_price, stock_quantity, minimum_stock_level')
        .order('name');

      if (error) throw error;
      setMedicines(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch medicines",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStockEdit = (medicineId: string, currentStock: number) => {
    setEditingStock(medicineId);
    setTempStock(currentStock);
  };

  const handleStockUpdate = async (medicineId: string) => {
    try {
      const { error } = await supabase
        .from('medicines')
        .update({ stock_quantity: tempStock })
        .eq('id', medicineId);

      if (error) throw error;

      setMedicines(medicines.map(med => 
        med.id === medicineId ? { ...med, stock_quantity: tempStock } : med
      ));

      toast({
        title: "Success",
        description: "Stock updated successfully"
      });

      setEditingStock(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update stock",
        variant: "destructive"
      });
    }
  };

  const isOutOfStock = (medicine: Medicine) => {
    return medicine.stock_quantity === 0;
  };

  const isLowStock = (medicine: Medicine) => {
    return medicine.stock_quantity > 0 && medicine.stock_quantity <= medicine.minimum_stock_level;
  };

  if (loading) {
    return <div>Loading medicines...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search medicines by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredMedicines.map((medicine) => (
          <Card key={medicine.id}>
            <CardHeader>
              <CardTitle className="text-lg">{medicine.name}</CardTitle>
              {medicine.generic_name && (
                <CardDescription>{medicine.generic_name}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Category:</span>
                  <Badge variant="outline">{medicine.category}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Price:</span>
                  <span className="font-medium">ETB {medicine.selling_price}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span>Stock:</span>
                  <div className="flex items-center space-x-2">
                    {editingStock === medicine.id ? (
                      <div className="flex items-center space-x-2">
                        <Input
                          type="number"
                          value={tempStock}
                          onChange={(e) => setTempStock(parseInt(e.target.value) || 0)}
                          className="w-20 h-8"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleStockUpdate(medicine.id)}
                          className="h-8"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingStock(null)}
                          className="h-8"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <span className={(isLowStock(medicine) || isOutOfStock(medicine)) ? 'text-warning font-medium' : ''}>
                          {medicine.stock_quantity}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStockEdit(medicine.id, medicine.stock_quantity)}
                          className="h-6 w-6 p-0"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        {isOutOfStock(medicine) && (
                          <Badge variant="destructive" className="text-xs">
                            Out of Stock
                          </Badge>
                        )}
                        {isLowStock(medicine) && (
                          <Badge variant="destructive" className="text-xs">
                            Low Stock
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredMedicines.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No medicines found.</p>
        </div>
      )}
    </div>
  );
}