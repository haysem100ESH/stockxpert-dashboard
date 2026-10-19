import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Plus, ShoppingCart, Filter, Info, CalendarIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import MedicineInfoDialog from '@/components/inventory/MedicineInfoDialog';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useSalesInventory } from '@/hooks/useSalesInventory';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import CartSlider from './CartSlider';
import AddToCartDialog from './AddToCartDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { updateCreditScore } from '@/hooks/useCreditScore';
import { addisDayString } from '@/lib/timezone';
import { isMeasurable } from '@/lib/itemTypes';
import { logActivity } from '@/lib/activityLog';
import { deductFIFO, recordSaleItemBatches } from '@/lib/batchInventory';
import { useReadOnly } from '@/hooks/useReadOnly';
import { usePackagingMap } from '@/hooks/usePackaging';
import { formatStock, unitsPerStripSafe, unitsPerPackSafe, autoStripPrice, autoPackPrice } from '@/lib/packaging';

interface Medicine {
  id: string; // branch_items.id
  medicine_id: string; // medicines.id (for reference)
  name: string;
  generic_name?: string;
  selling_price: number;
  purchase_price: number;
  stock_quantity: number; // branch_items.quantity
  category?: string;
  expiry_date?: string;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  item_type?: string;
  branch_id?: string;
  branch_name?: string;
  // Multi-level packaging (v2)
  packaging_mode?: string | null;
  main_unit_name?: string | null;
  unit_price?: number | null;
  strength?: string | null;
  medicine_group?: string | null;
}

interface CartItem extends Medicine {
  quantity: number;
  total: number;
  saleType: 'full_pack' | 'by_stripe';
  stripesCount?: number;
  // New multi-level packaging flow.
  // When set, `quantity` is in `sellLevel` units and `selling_price`
  // is the price per one `sellLevel`. `unitsPerLevel` is the number
  // of base pieces contained in one `sellLevel`.
  sellLevel?: 'unit' | 'strip' | 'pack';
  unitsPerLevel?: number;
  sellLevelLabel?: string;
  availableLevels?: Array<'unit' | 'strip' | 'pack'>;
  levelPrices?: { unit?: number; strip?: number; pack?: number };
  levelLabels?: { unit?: string; strip?: string; pack?: string };
  levelUnitsPer?: { unit: number; strip: number; pack: number };
}

type ChangeAction = 'keep_profit' | 'deduct_debt' | 'give_change' | null;

export default function SalesManagement() {
  // TanStack Query–cached product list + customers (instant hydration on revisit).
  const { medicines, customers, loading, invalidate: invalidateSalesCache } = useSalesInventory();
  const { data: packagingMap = {} } = usePackagingMap(medicines.map(m => m.medicine_id));
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [paginatedMedicines, setPaginatedMedicines] = useState<Medicine[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [infoMed, setInfoMed] = useState<{ branchItemId: string; medicineId?: string; name: string } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountMode, setDiscountMode] = useState<'percent' | 'fixed'>('percent');
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('none');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [changeAction, setChangeAction] = useState<ChangeAction>(null);
  const [keepChangeOption, setKeepChangeOption] = useState<'profit' | 'deduct_debt'>('profit');
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedMedicineForDialog, setSelectedMedicineForDialog] = useState<Medicine | null>(null);
  // Sale Date — the business/accounting date for this transaction. Defaults
  // to today in Africa/Addis_Ababa (Ethiopia) so it stays consistent with the
  // Dashboard and Finance pages regardless of the browser's timezone.
  const todayISO = () => addisDayString();
  const [saleDate, setSaleDate] = useState<string>(todayISO());

  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedBranch, branchType } = useBranchContext();
  const isMobile = useIsMobile();
  const readOnly = useReadOnly();
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const isPharmacy = branchType === 'pharmacy';

  // Track < 1024px for cart icon behavior (tablet + mobile)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setIsSmallScreen(mql.matches);
    mql.addEventListener('change', onChange);
    setIsSmallScreen(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const ITEMS_PER_PAGE = 24;

  useEffect(() => {
    const filtered = medicines.filter(medicine => {
      const matchesSearch = medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const displayCat = medicine.category || '';
      const matchesCategory = categoryFilter === 'all' || displayCat === categoryFilter;
      return matchesSearch && matchesCategory;
    });
    setFilteredMedicines(filtered);
    setCurrentPage(1);
  }, [medicines, searchTerm, categoryFilter]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    setPaginatedMedicines(filteredMedicines.slice(startIndex, startIndex + ITEMS_PER_PAGE));
  }, [filteredMedicines, currentPage]);

  // Clear amount received when cart changes so placeholder takes effect
  useEffect(() => {
    setAmountReceived('');
  }, [cart, discountPercent]);

  // Reset payment method whenever a new item is added to the cart,
  // so staff must re-select it each time instead of reusing the previous choice.
  const prevCartCountRef = useRef(cart.length);
  useEffect(() => {
    if (cart.length > prevCartCountRef.current) {
      setPaymentMethod('');
    }
    prevCartCountRef.current = cart.length;
  }, [cart.length]);

  // Reset change action when amount received changes
  useEffect(() => {
    setChangeAction(null);
    setKeepChangeOption('profit');
  }, [amountReceived]);

  // NOTE: medicines + customers now come from `useSalesInventory` (TanStack Query cached).
  // The legacy in-component fetchMedicines/fetchCustomers helpers were removed.
  // Call `invalidateSalesCache()` after mutations to revalidate both lists.


  const isExpired = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry <= today;
  };

  const isExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false;
    if (isExpired(expiryDate)) return false;
    const expiry = new Date(expiryDate);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return expiry <= thirtyDaysFromNow;
  };

  // Instant add — measurable items still need the dialog for quantity entry.
  // Everything else is added straight to the cart (defaults to selling by piece/unit);
  // the user can switch unit / strip / pack from inside the cart.
  const addToCartInstant = (medicine: Medicine) => {
    if (medicine.item_type === 'measurable') {
      setSelectedMedicineForDialog(medicine);
      return;
    }
    // Always route through the new packaging-aware flow so the cart strictly
    // respects medicine packaging config (strip/pack enabled flags). Unit
    // (LPI) is ALWAYS available, even when no packaging row exists.
    const pkg = packagingMap[medicine.medicine_id];
    // branch_items.selling_price is now stored as the per-unit (LPI) price,
    // so use it directly when pkg has no explicit unit_selling_price.
    const unitPrice = pkg?.unit_selling_price ?? medicine.selling_price;
    addToCart(medicine, 'full_pack', 1, {
      sellLevel: 'unit',
      unitsPerLevel: 1,
      levelPrice: unitPrice,
      levelLabel: pkg?.unit_name || medicine.unit_label || 'unit',
    });
    if (isSmallScreen) setCartOpen(true);
  };

  const addToCart = (
    medicine: Medicine,
    saleType: 'full_pack' | 'by_stripe',
    count: number,
    meta?: { sellLevel?: 'unit' | 'strip' | 'pack'; unitsPerLevel?: number; levelPrice?: number; levelLabel?: string },
  ) => {
    // ---- New multi-level packaging flow ----
    if (meta?.sellLevel && meta.unitsPerLevel && meta.unitsPerLevel > 0) {
      const upl = meta.unitsPerLevel;
      const levelPrice = Number(meta.levelPrice ?? medicine.selling_price);
      const totalBaseAvailable = medicine.stock_quantity || 0;
      const maxAtLevel = Math.floor(totalBaseAvailable / upl);

      // Count what's already in cart for this medicine across any sellLevel,
      // converted to base pieces, to enforce real stock limits.
      const baseInCart = cart
        .filter(it => it.id === medicine.id && it.sellLevel)
        .reduce((sum, it) => sum + (it.quantity * (it.unitsPerLevel || 1)), 0);
      const remainingBase = Math.max(0, totalBaseAvailable - baseInCart);
      const requestedBase = count * upl;
      if (requestedBase > remainingBase) {
        toast({ title: 'Error', description: 'Not enough stock available', variant: 'destructive' });
        return;
      }

      const existing = cart.find(it => it.id === medicine.id && it.sellLevel === meta.sellLevel);
      // Resolve cross-level info from packagingMap so user can switch later.
      const pkg = packagingMap[medicine.medicine_id];
      const availableLevels: Array<'unit' | 'strip' | 'pack'> = ['unit'];
      let levelPrices: { unit?: number; strip?: number; pack?: number } = { unit: levelPrice };
      let levelLabels: { unit?: string; strip?: string; pack?: string } = { unit: medicine.unit_label || 'unit' };
      let levelUnitsPer = { unit: 1, strip: 1, pack: 1 };
      if (pkg) {
        const upStrip = unitsPerStripSafe(pkg);
        const upPack = unitsPerPackSafe(pkg);
        // branch_items.selling_price is per-unit (LPI); use it as the unit price
        // when pkg has no explicit unit_selling_price.
        const uPrice = pkg.unit_selling_price ?? medicine.selling_price;
        const sPrice = uPrice * upStrip;
        const pPrice = uPrice * upPack;
        levelPrices = { unit: uPrice, strip: sPrice, pack: pPrice };
        levelLabels = { unit: pkg.unit_name || 'unit', strip: pkg.strip_name || 'strip', pack: pkg.pack_name || 'pack' };
        levelUnitsPer = { unit: 1, strip: upStrip, pack: upPack };
        if (pkg.strip_enabled) availableLevels.push('strip');
        if (pkg.pack_enabled) availableLevels.push('pack');
      }

      if (existing) {
        const newQty = existing.quantity + count;
        setCart(prev => prev.map(it =>
          it.id === medicine.id && it.sellLevel === meta.sellLevel
            ? { ...it, quantity: newQty, total: parseFloat((newQty * levelPrice).toFixed(2)) }
            : it,
        ));
      } else {
        setCart(prev => [...prev, {
          ...medicine,
          quantity: count,
          saleType: 'full_pack',
          stripesCount: undefined,
          sellLevel: meta.sellLevel,
          unitsPerLevel: upl,
          sellLevelLabel: meta.levelLabel || meta.sellLevel,
          selling_price: levelPrice,
          unit_label: meta.levelLabel || medicine.unit_label,
          total: parseFloat((count * levelPrice).toFixed(2)),
          availableLevels,
          levelPrices,
          levelLabels,
          levelUnitsPer,
        }]);
      }
      return;
    }

    // ---- Legacy flow (unchanged) ----
    if (saleType === 'by_stripe') {
      if (!medicine.units_per_pack) {
        toast({ title: 'Error', description: 'This item is not configured for unit sales', variant: 'destructive' });
        return;
      }
      if (count <= 0) {
        toast({ title: 'Error', description: 'Quantity must be greater than 0', variant: 'destructive' });
        return;
      }
      const totalAvailableStripes = (medicine.stock_quantity * medicine.units_per_pack) + (medicine.open_pack_units || 0);
      const stripesInCart = cart
        .filter(item => item.id === medicine.id && item.saleType === 'by_stripe')
        .reduce((sum, item) => sum + (item.stripesCount || 0), 0);
      if (count > totalAvailableStripes - stripesInCart) {
        toast({ title: 'Error', description: 'Not enough units available', variant: 'destructive' });
        return;
      }
    }

    const existingItem = cart.find(item => item.id === medicine.id && item.saleType === saleType && !item.sellLevel);

    if (existingItem && saleType === 'full_pack') {
      const newQty = existingItem.quantity + count;
      if (newQty > medicine.stock_quantity) {
        toast({ title: 'Error', description: 'Cannot add more than available stock', variant: 'destructive' });
        return;
      }
      setCart(prev => prev.map(item =>
        item.id === medicine.id && item.saleType === saleType && !item.sellLevel
          ? { ...item, quantity: newQty, total: newQty * item.selling_price }
          : item
      ));
    } else if (existingItem && saleType === 'by_stripe') {
      const newCount = parseFloat(((existingItem.stripesCount || 0) + count).toFixed(4));
      const pricePerStripe = medicine.selling_price / (medicine.units_per_pack || 1);
      setCart(prev => prev.map(item =>
        item.id === medicine.id && item.saleType === saleType && !item.sellLevel
          ? { ...item, stripesCount: newCount, total: parseFloat((newCount * pricePerStripe).toFixed(2)) }
          : item
      ));
    } else {
      const pricePerStripe = saleType === 'by_stripe' && medicine.units_per_pack
        ? medicine.selling_price / medicine.units_per_pack
        : medicine.selling_price;
      setCart(prev => [...prev, {
        ...medicine,
        quantity: saleType === 'full_pack' ? count : 0,
        saleType,
        stripesCount: saleType === 'by_stripe' ? count : undefined,
        total: saleType === 'by_stripe'
          ? parseFloat((count * pricePerStripe).toFixed(2))
          : count * medicine.selling_price,
      }]);
    }
  };

  const removeFromCart = (id: string, saleType: 'full_pack' | 'by_stripe') => {
    setCart(prev => prev.filter(item => !(item.id === id && item.saleType === saleType)));
  };

  const updateCartQuantity = (id: string, saleType: 'full_pack' | 'by_stripe', delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id || item.saleType !== saleType) return item;
      // New multi-level flow: clamp by base-stock / unitsPerLevel.
      if (item.sellLevel && item.unitsPerLevel) {
        const maxAtLevel = Math.floor((item.stock_quantity || 0) / item.unitsPerLevel);
        const integerDelta = Number.isInteger(delta) ? delta : Math.round(delta);
        const newQty = Math.max(1, Math.min(maxAtLevel, item.quantity + integerDelta));
        return { ...item, quantity: newQty, total: parseFloat((newQty * item.selling_price).toFixed(2)) };
      }
      if (saleType === 'full_pack') {
        const newQty = Math.max(1, item.quantity + delta);
        if (newQty > item.stock_quantity) return item;
        return { ...item, quantity: newQty, total: newQty * item.selling_price };
      } else {
        const pricePerStripe = item.selling_price / (item.units_per_pack || 1);
        const totalAvailableStripes = (item.stock_quantity * (item.units_per_pack || 1)) + (item.open_pack_units || 0);
        // For countable strip items, quantity must always be whole numbers.
        // Measurable items can still use fractional strip quantities.
        const isMeasurableItem = item.item_type === 'measurable' || isMeasurable(item.unit_label);
        const currentCount = item.stripesCount ?? 1;

        let newCount: number;
        if (isMeasurableItem) {
          const step = Math.abs(delta) === 1 ? (delta > 0 ? 0.25 : -0.25) : delta;
          newCount = parseFloat((Math.max(0.25, currentCount + step)).toFixed(4));
        } else {
          const integerDelta = Number.isInteger(delta) ? delta : Math.round(delta);
          newCount = Math.max(0, Math.round(currentCount + integerDelta));
        }

        if (newCount > totalAvailableStripes) return item;
        return { ...item, stripesCount: newCount, total: parseFloat((newCount * pricePerStripe).toFixed(2)) };
      }
    }));
  };

  const setMeasurableQuantity = (id: string, quantity: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      // Measurable items use full_pack saleType with decimal quantity
      if (item.saleType === 'full_pack') {
        if (quantity > item.stock_quantity) return item;
        return { ...item, quantity, total: parseFloat((quantity * item.selling_price).toFixed(2)) };
      } else {
        // by_stripe measurable
        const pricePerStripe = item.selling_price / (item.units_per_pack || 1);
        const totalAvailable = (item.stock_quantity * (item.units_per_pack || 1)) + (item.open_pack_units || 0);
        if (quantity > totalAvailable) return item;
        return { ...item, stripesCount: quantity, total: parseFloat((quantity * pricePerStripe).toFixed(2)) };
      }
    }));
  };

  // Compute leftover strips info for a cart item
  const getStripLeftoverInfo = (item: CartItem) => {
    if (item.saleType !== 'by_stripe' || !item.units_per_pack || !item.stripesCount) return null;
    const openPack = item.open_pack_units || 0;
    const usingFromOpen = Math.min(item.stripesCount, openPack);
    const remainingFromOpen = openPack - usingFromOpen;
    const needFromNewPacks = Math.max(0, item.stripesCount - openPack);
    const packsOpened = needFromNewPacks > 0 ? Math.ceil(needFromNewPacks / item.units_per_pack) : 0;
    const stripsUsedFromLastPack = needFromNewPacks > 0 ? needFromNewPacks % item.units_per_pack || item.units_per_pack : 0;
    const leftoverInOpenedPack = packsOpened > 0 ? (item.units_per_pack * packsOpened) - needFromNewPacks : 0;
    return { remainingFromOpen, packsOpened, leftoverInOpenedPack, stripsUsedFromLastPack };
  };

  const changeSaleType = (id: string, newSaleType: 'full_pack' | 'by_stripe') => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (newSaleType === 'by_stripe' && item.units_per_pack) {
        const pricePerStripe = item.selling_price / item.units_per_pack;
        return { ...item, saleType: 'by_stripe', stripesCount: 1, quantity: 0, total: pricePerStripe };
      } else {
        return { ...item, saleType: 'full_pack', stripesCount: undefined, quantity: 1, total: item.selling_price };
      }
    }));
  };

  const calculateSubtotal = () => cart.reduce((sum, item) => sum + item.total, 0);
  const calculateDiscount = () => {
    const sub = calculateSubtotal();
    if (discountMode === 'fixed') return Math.max(0, Math.min(sub, discountPercent));
    return (sub * Math.max(0, Math.min(100, discountPercent))) / 100;
  };
  const calculateTotal = () => calculateSubtotal() - calculateDiscount();

  const getChangeAmount = () => {
    const total = calculateTotal();
    const received = amountReceived ? parseFloat(amountReceived) : total;
    return received - total;
  };

  // Switch selling level (unit/strip/pack) for a cart item using its
  // stored per-level metadata. Quantity resets to 1, clamped to stock.
  const changeSellLevel = (id: string, newLevel: 'unit' | 'strip' | 'pack') => {
    setCart(prev => prev.map(it => {
      if (it.id !== id || !it.sellLevel) return it;
      const upl = it.levelUnitsPer?.[newLevel] ?? (newLevel === 'unit' ? 1 : it.unitsPerLevel || 1);
      const price = it.levelPrices?.[newLevel] ?? it.selling_price;
      const label = it.levelLabels?.[newLevel] ?? newLevel;
      // Detect merge target — same id + same target level already in cart
      const dupe = prev.find(p => p.id === id && p.sellLevel === newLevel && p !== it);
      if (dupe) return it; // skip; merge handled below
      const maxAtLevel = Math.max(1, Math.floor((it.stock_quantity || 0) / upl));
      const newQty = Math.min(Math.max(1, it.quantity), maxAtLevel);
      return {
        ...it,
        sellLevel: newLevel,
        unitsPerLevel: upl,
        sellLevelLabel: label,
        selling_price: price,
        unit_label: label,
        quantity: newQty,
        total: parseFloat((newQty * price).toFixed(2)),
      };
    }).reduce<CartItem[]>((acc, cur) => {
      // Merge if a same-level entry already exists
      const existingIdx = acc.findIndex(a => a.id === cur.id && a.sellLevel === cur.sellLevel);
      if (existingIdx >= 0 && acc[existingIdx] !== cur) {
        const merged = { ...acc[existingIdx] };
        merged.quantity = merged.quantity + cur.quantity;
        merged.total = parseFloat((merged.quantity * merged.selling_price).toFixed(2));
        acc[existingIdx] = merged;
      } else {
        acc.push(cur);
      }
      return acc;
    }, []));
  };

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const customerHasDebt = selectedCustomer && (selectedCustomer.computed_debt || 0) > 0;

  // Credit limit check for debt sales
  const getCreditCheckResult = () => {
    if (!selectedCustomer || selectedCustomerId === 'none') return null;
    const received = amountReceived ? parseFloat(amountReceived) : calculateTotal();
    const shortfall = calculateTotal() - received;
    if (shortfall <= 0) return null; // fully paid, no credit needed
    const currentDebt = selectedCustomer.computed_debt || 0;
    const maxLimit = selectedCustomer.max_credit_limit ?? 5000;
    const score = selectedCustomer.credit_score ?? 50;
    if (!isFinite(maxLimit)) return { allowed: true, score };
    if (maxLimit === 0) return { allowed: false, reason: 'Credit score too low — Cash Only', score };
    const available = Math.max(0, maxLimit - currentDebt);
    if (shortfall > available) return { allowed: false, reason: `Debt (ETB ${(currentDebt + shortfall).toFixed(2)}) would exceed credit limit (ETB ${maxLimit.toFixed(2)})`, score };
    return { allowed: true, score };
  };
  const creditCheck = getCreditCheckResult();

  const handleCheckout = () => {
    if (readOnly) {
      toast({ title: 'Read Only', description: 'You cannot make sales in read-only mode.', variant: 'destructive' });
      return;
    }
    if (!selectedBranch) {
      toast({ title: 'Branch Required', description: 'Please select a specific branch before selling.', variant: 'destructive' });
      return;
    }
    // Credit limit check
    if (creditCheck && !creditCheck.allowed) {
      toast({ title: 'Credit Denied', description: creditCheck.reason, variant: 'destructive' });
      return;
    }
    if (cart.length === 0) {
      toast({ title: 'Error', description: 'Cart is empty', variant: 'destructive' });
      return;
    }
    if (!paymentMethod) {
      toast({ title: 'Payment Method Required', description: 'Please select a payment method before checkout.', variant: 'destructive' });
      return;
    }
    // Prevent selling items with 0 quantity
    const zeroItem = cart.find(item => 
      (item.saleType === 'by_stripe' && (item.stripesCount ?? 0) <= 0) ||
      (item.saleType === 'full_pack' && item.quantity <= 0)
    );
    if (zeroItem) {
      toast({ title: 'Invalid Quantity', description: `"${zeroItem.name}" has 0 quantity. Please set a valid amount or remove it.`, variant: 'destructive' });
      return;
    }
    const change = getChangeAmount();
    if (change > 0.001 && !changeAction) {
      toast({ title: 'Action Required', description: 'Please select Keep Change or Give Change before checkout', variant: 'destructive' });
      return;
    }
    setShowCheckoutConfirm(true);
  };

  const confirmCheckout = async () => {
    setShowCheckoutConfirm(false);
    setProcessing(true);
    try {
      const total = calculateTotal();
      const received = amountReceived !== '' ? parseFloat(amountReceived) : total;
      const change = Math.max(0, received - total);
      const underpaid = total - received; // positive when received < total

      let actualPaid = received; // default: whatever was received
      let extraProfit = 0;
      let finalChangeAction: string | null = null;

      // Track whether we need to deduct from debt (handled separately, not via change_action)
      let shouldDeductDebt = false;

      if (change > 0.001) {
        // Overpayment — handle change options
        if (changeAction === 'give_change') {
          actualPaid = total;
          extraProfit = 0;
          finalChangeAction = 'give_change';
        } else if (changeAction === 'keep_profit') {
          if (keepChangeOption === 'deduct_debt' && customerHasDebt) {
            // DB only allows 'keep_change' or 'give_change' — use 'give_change' and handle debt separately
            actualPaid = total;
            extraProfit = 0;
            finalChangeAction = 'give_change';
            shouldDeductDebt = true;
          } else {
            // Tip / extra profit — map to 'keep_change'
            actualPaid = received;
            extraProfit = change;
            finalChangeAction = 'keep_change';
          }
        }
      } else if (underpaid > 0.001) {
        // Underpayment — record as partial/debt
        actualPaid = received;
        finalChangeAction = null;
      }
      // else exact payment — actualPaid = received = total

      const paymentStatus = actualPaid >= total ? 'paid' : actualPaid > 0 ? 'partial' : 'unpaid';

      // Build the base sale insert payload — only columns confirmed to exist in the DB
      const baseSaleInsert: Record<string, unknown> = {
        total_amount: Number(total.toFixed(2)),
        payment_method: String(paymentMethod),
        discount_amount: Number(calculateDiscount().toFixed(2)),
        sold_by: profile?.id ?? null,
        branch_id: selectedBranch ?? profile?.branch_id ?? null,
        amount_paid: Number(actualPaid.toFixed(2)),
        payment_status: String(paymentStatus),
        // Business/accounting date chosen by the cashier. The DB also stores
        // its own created_at / updated_at timestamps untouched.
        sale_date: saleDate,
      };

      // Only add customer_id if a customer is selected
      if (selectedCustomerId !== 'none') {
        baseSaleInsert.customer_id = selectedCustomerId;
      }

      console.log('[Sale Payload]', baseSaleInsert);

      // Try with extended columns first; fall back to base if schema doesn't have them
      let saleData: any = null;
      const extendedInsert = { ...baseSaleInsert };
      if (finalChangeAction) extendedInsert.change_action = String(finalChangeAction);
      if (extraProfit > 0) extendedInsert.extra_profit = Number(extraProfit.toFixed(2));

      let saleResult = await (supabase as any)
        .from('sales')
        .insert([extendedInsert])
        .select()
        .single();

      // If extended columns don't exist in schema, retry without them (and
      // without sale_date so installs that haven't run the migration still work).
      if (
        saleResult.error?.code === '42703' ||
        saleResult.error?.code === 'PGRST204' ||
        saleResult.error?.message?.includes('does not exist') ||
        saleResult.error?.message?.toLowerCase?.().includes("could not find") 
      ) {
        console.warn('[Sale Insert] Falling back to base payload (extended columns not in schema)');
        const { sale_date: _omitDate, ...legacyInsert } = baseSaleInsert as any;
        saleResult = await (supabase as any)
          .from('sales')
          .insert([legacyInsert])
          .select()
          .single();
      }

      if (saleResult.error) {
        console.error('[Sale Insert Error]', saleResult.error);
        throw saleResult.error;
      }
      saleData = saleResult.data;

      // Keep compatibility with both legacy and new branch_items system.
      // Now using branch_item_id (item.id is branch_items.id).
      const saleItems = cart.map(item => {
        const isMeasurableItem = item.item_type === 'measurable' || isMeasurable(item.unit_label);
        const stripeQty = Number(item.stripesCount || 0);
        const packQty = Number(item.quantity || 0);

        // Resolve the level the cashier picked. New flow uses item.sellLevel
        // ('unit' | 'strip' | 'pack'); legacy flow uses item.saleType
        // ('by_stripe' | 'full_pack'). Map both to the canonical sale_type now
        // that the DB CHECK accepts unit/strip/pack directly.
        let level: 'unit' | 'strip' | 'pack';
        let qtyForRow: number;
        if (item.sellLevel) {
          level = item.sellLevel;
          qtyForRow = Number(item.quantity || 0);
        } else if (isMeasurableItem || item.saleType === 'by_stripe') {
          level = 'strip';
          qtyForRow = stripeQty;
        } else {
          level = 'pack';
          qtyForRow = packQty;
        }

        // Companion columns kept in sync for backward-compatible readers.
        const stripQtyCol = level === 'strip' ? Math.max(0, Math.round(qtyForRow)) : 0;
        const packQtyCol = level === 'pack' ? Math.max(0, Math.round(qtyForRow)) : 0;
        const stripesSoldCol: number | null = level === 'strip' ? Math.round(qtyForRow * 1000) : null;

        return {
          sale_id: saleData.id,
          medicine_id: (item as any).medicine_id || item.id,
          branch_item_id: item.id,
          quantity: Number(Number(qtyForRow).toFixed(4)),
          unit_price: Number(item.selling_price),
          total_price: Number(item.total.toFixed(2)),
          sale_type: level,
          strip_quantity: stripQtyCol,
          pack_quantity: packQtyCol,
          stripes_sold: stripesSoldCol,
        };
      });

      const { error: itemsError } = await (supabase as any).from('sale_items').insert(saleItems);
      if (itemsError) {
        console.error('[Sale Items Error]', itemsError);
        throw itemsError;
      }

      // Stock deduction — FIFO batch deduction + branch_items sync
      for (const item of cart) {
        let totalQtyToDeduct = 0;
        if (item.sellLevel && item.unitsPerLevel) {
          // New multi-level flow: quantity is in sellLevel units → convert to base pieces.
          totalQtyToDeduct = item.quantity * item.unitsPerLevel;
        } else if (item.saleType === 'full_pack') {
          totalQtyToDeduct = item.quantity;
        } else if (item.saleType === 'by_stripe' && item.stripesCount) {
          const upp = item.units_per_pack;
          if (!upp) continue;
          totalQtyToDeduct = item.stripesCount / upp;
        }

        if (totalQtyToDeduct > 0) {
          // Try FIFO batch deduction first
          const { consumed, error: fifoErr } = await deductFIFO(item.id, totalQtyToDeduct);

          if (fifoErr || consumed.length === 0) {
            // Fallback: direct branch_items update (for items without batches)
            const currentMed = medicines.find(m => m.id === item.id);
            if (currentMed) {
              const newQty = Math.max(0, currentMed.stock_quantity - totalQtyToDeduct);
              await (supabase as any)
                .from('branch_items')
                .update({ quantity: newQty, updated_at: new Date().toISOString() })
                .eq('id', item.id);
            }
          }

          // Record sale_item_batches for audit trail
          if (consumed.length > 0) {
            // Find the sale_item_id for this cart item
            const saleItemForThis = saleItems.find((si: any) =>
              si.branch_item_id === item.id
            );
            // We need the inserted sale_item id — fetch it
            const { data: insertedSaleItems } = await (supabase as any)
              .from('sale_items')
              .select('id')
              .eq('sale_id', saleData.id)
              .eq('branch_item_id', item.id)
              .limit(1);

            if (insertedSaleItems && insertedSaleItems.length > 0) {
              await recordSaleItemBatches(insertedSaleItems[0].id, consumed);
            }
          }
        }
      }

      // Handle debt deduction — recorded via a customer_payment entry
      if (shouldDeductDebt && customerHasDebt && selectedCustomer) {
        const deductAmount = Math.min(change, selectedCustomer.computed_debt || 0);
        const { data: deductPayment } = await (supabase as any)
          .from('customer_payments')
          .insert([{
            customer_id: selectedCustomer.id,
            amount: deductAmount,
            payment_method: paymentMethod,
            notes: 'Auto-deducted from change',
            branch_id: selectedBranch ?? profile?.branch_id ?? null,
            created_by: profile?.id ?? null,
          }])
          .select('id')
          .single();

        // Update customer_credits for debt deduction
        const { data: existingCredit } = await (supabase as any)
          .from('customer_credits')
          .select('id, total_debt')
          .eq('customer_id', selectedCustomer.id)
          .single();

        if (existingCredit) {
          const prevBal = Number(existingCredit.total_debt);
          const newBal = Math.max(0, prevBal - deductAmount);
          await (supabase as any).from('customer_credits').update({ total_debt: newBal, last_updated: new Date().toISOString() }).eq('id', existingCredit.id);
          await (supabase as any).from('customer_credit_transactions').insert({
            customer_id: selectedCustomer.id,
            branch_id: selectedBranch ?? profile?.branch_id ?? null,
            transaction_type: 'payment',
            amount: deductAmount,
            previous_balance: prevBal,
            new_balance: newBal,
            payment_id: deductPayment?.id ?? null,
            notes: 'Auto-deducted from change',
            created_by: profile?.id ?? null,
          });
        }
      }

      // Update customer_credits for credit sale (underpaid)
      if (selectedCustomerId !== 'none' && underpaid > 0.001) {
        const branchId = selectedBranch ?? profile?.branch_id ?? null;
        const { data: existingCredit } = await (supabase as any)
          .from('customer_credits')
          .select('id, total_debt')
          .eq('customer_id', selectedCustomerId)
          .single();

        if (existingCredit) {
          const prevBal = Number(existingCredit.total_debt);
          const newBal = prevBal + underpaid;
          await (supabase as any).from('customer_credits').update({ total_debt: newBal, last_updated: new Date().toISOString() }).eq('id', existingCredit.id);
          await (supabase as any).from('customer_credit_transactions').insert({
            customer_id: selectedCustomerId,
            branch_id: branchId,
            transaction_type: 'sale_credit',
            amount: underpaid,
            previous_balance: prevBal,
            new_balance: newBal,
            sale_id: saleData.id,
            notes: null,
            created_by: profile?.id ?? null,
          });
        } else {
          // Create new customer_credits record
          await (supabase as any).from('customer_credits').insert({
            customer_id: selectedCustomerId,
            branch_id: branchId,
            total_debt: underpaid,
          });
          await (supabase as any).from('customer_credit_transactions').insert({
            customer_id: selectedCustomerId,
            branch_id: branchId,
            transaction_type: 'sale_credit',
            amount: underpaid,
            previous_balance: 0,
            new_balance: underpaid,
            sale_id: saleData.id,
            notes: null,
            created_by: profile?.id ?? null,
          });
        }

        // Auto credit score: penalize for debt sale
        const cust = customers.find(c => c.id === selectedCustomerId);
        if (cust) {
          await updateCreditScore({
            customerId: selectedCustomerId,
            currentScore: cust.credit_score ?? 50,
            changeAmount: -5,
            reason: `New debt from sale (ETB ${underpaid.toFixed(2)} unpaid)`,
            createdBy: profile?.id,
            branchId: selectedBranch || profile?.branch_id,
          });
        }
      }

      let successMessage = `Sale completed! Total: ETB ${total.toFixed(2)} via ${paymentMethod}.`;
      if (extraProfit > 0) successMessage += ` Extra profit: ETB ${extraProfit.toFixed(2)}.`;
      if (finalChangeAction === 'give_change') successMessage += ` Change given: ETB ${change.toFixed(2)}.`;
      if (shouldDeductDebt) successMessage += ` ETB ${Math.min(change, selectedCustomer?.computed_debt || 0).toFixed(2)} deducted from customer debt.`;

      toast({ title: 'Success', description: successMessage });

      // Log activity (fire-and-forget)
      logActivity({
        type: 'sell_item',
        entityType: 'sale',
        entityId: (saleData as any)?.id,
        metadata: {
          total: Number(total.toFixed(2)),
          payment_method: paymentMethod,
          discount: Number(calculateDiscount().toFixed(2)),
          customer_name: selectedCustomer?.name || null,
          sale_date: saleDate,
          items: cart.map((it) => {
            const qty = it.saleType === 'by_stripe' ? (it.stripesCount ?? 0) : it.quantity;
            const lineTotal = Number((it as any).total ?? 0);
            const unit = qty > 0 ? lineTotal / qty : Number(it.selling_price ?? 0);
            return {
              name: it.name,
              quantity: qty,
              unit_price: Number(unit.toFixed(2)),
              line_total: Number(lineTotal.toFixed(2)),
              sale_type: it.saleType,
            };
          }),
        },
      });

      // Reset state
      setCart([]);
      setPaymentMethod('Cash');
      setDiscountPercent(0);
      setSelectedCustomerId('none');
      setAmountReceived('');
      setChangeAction(null);
      setKeepChangeOption('profit');
      setCartOpen(false);
      // Reset sale date back to today for the next transaction.
      setSaleDate(todayISO());
      // Revalidate cached product list + customers (debt may have changed).
      invalidateSalesCache();
      // Broadcast to all pages (Inventory, Dashboard, etc.) so stock cards refresh live.
      window.dispatchEvent(new Event('app:refresh'));
    } catch (error: any) {
      console.error('[Checkout Error]', error);
      toast({
        title: 'Payment Failed',
        description: 'Unable to process payment. Please check payment details.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const getDisplayCategory = (medicine: Medicine) => medicine.category || '';
  const getUniqueCategories = () => [...new Set(medicines.map(m => getDisplayCategory(m)).filter(Boolean))].sort() as string[];

  const subtotal = calculateSubtotal();
  const discount = calculateDiscount();
  const total = calculateTotal();
  const totalPages = Math.max(1, Math.ceil(filteredMedicines.length / ITEMS_PER_PAGE));

  const renderSaleCard = (medicine: Medicine) => {
    const pkg = packagingMap[medicine.medicine_id];
    const hasNewPackaging = !!pkg && (pkg.strip_enabled || pkg.pack_enabled);
    const unitName = pkg?.unit_name || medicine.unit_label || 'unit';
    const stripName = pkg?.strip_name || 'strip';
    const packName = pkg?.pack_name || 'pack';

    // Resolve per-level prices when new packaging exists.
    // branch_items.selling_price is per-unit (LPI), so strip/pack prices are
    // simply unit price multiplied by the unit count at each level.
    let unitPrice = 0, stripPrice = 0, packPrice = 0;
    if (hasNewPackaging) {
      const upStrip = unitsPerStripSafe(pkg!);
      const upPack = unitsPerPackSafe(pkg!);
      unitPrice = pkg!.unit_selling_price ?? medicine.selling_price;
      stripPrice = unitPrice * upStrip;
      packPrice = unitPrice * upPack;
    }

    return (
    <Card key={medicine.id} className="group relative overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-border/60 hover:border-primary/40">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60 opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <CardTitle className="text-base leading-tight truncate">{medicine.name}</CardTitle>
              {isPharmacy && medicine.strength && (
                <span className="text-sm font-semibold text-primary tabular-nums">{medicine.strength}</span>
              )}
            </div>
            {medicine.generic_name && (
              <CardDescription className="text-xs mt-0.5 truncate italic">{medicine.generic_name}</CardDescription>
            )}
            {isPharmacy && medicine.medicine_group && (
              <div className="mt-1.5">
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">{medicine.medicine_group}</Badge>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title="Info"
              onClick={(e) => { e.stopPropagation(); setInfoMed({ branchItemId: medicine.id, medicineId: medicine.medicine_id, name: medicine.name }); }}
            >
              <Info className="h-4 w-4" />
            </Button>
            {medicine.category && <Badge variant="outline" className="text-xs">{medicine.category}</Badge>}
            {isMeasurable(medicine.unit_label) ? (
              <Badge variant="secondary" className="text-xs">Measurable ({medicine.unit_label})</Badge>
            ) : hasNewPackaging ? (
              <Badge variant="secondary" className="text-xs">By {unitName}</Badge>
            ) : medicine.units_per_pack ? (
              <Badge variant="secondary" className="text-xs">By {medicine.unit_label || 'unit'}</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {hasNewPackaging ? (
            <>
              <div className="flex justify-between text-sm">
                <span>{unitName} price:</span>
                <span className="font-medium">ETB {Number(unitPrice || 0).toFixed(2)}</span>
              </div>
              {pkg!.strip_enabled && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{stripName} price:</span>
                  <span>ETB {Number(stripPrice || 0).toFixed(2)}</span>
                </div>
              )}
              {pkg!.pack_enabled && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{packName} price:</span>
                  <span>ETB {Number(packPrice || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>Stock:</span>
                <Badge variant={medicine.stock_quantity <= 10 ? 'destructive' : 'secondary'}>
                  {formatStock(medicine.stock_quantity, pkg!)}
                </Badge>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total pieces:</span>
                <span>{medicine.stock_quantity}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between text-sm">
                <span>Price:</span>
                <span className="font-medium">ETB {medicine.selling_price}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Stock:</span>
                <Badge variant={medicine.stock_quantity <= 10 ? 'destructive' : 'secondary'}>
                  {isMeasurable(medicine.unit_label)
                    ? `${medicine.stock_quantity} ${medicine.unit_label}`
                    : `${medicine.stock_quantity} ${unitName}${medicine.stock_quantity === 1 ? '' : 's'}`}
                </Badge>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total pieces:</span>
                <span>{medicine.stock_quantity}</span>
              </div>
            </>
          )}
          {isPharmacy && medicine.expiry_date && (
            <div className="flex justify-between text-sm">
              <span>Expires:</span>
              <div className="flex items-center gap-1">
                <span className={isExpired(medicine.expiry_date) ? 'text-destructive font-medium' : isExpiringSoon(medicine.expiry_date) ? 'text-warning' : ''}>
                  {new Date(medicine.expiry_date).toLocaleDateString()}
                </span>
                {isExpired(medicine.expiry_date) && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                {!isExpired(medicine.expiry_date) && isExpiringSoon(medicine.expiry_date) && <Badge variant="destructive" className="text-xs">Soon</Badge>}
              </div>
            </div>
          )}
          {selectedBranch ? (
            <Button
              onClick={() => addToCartInstant(medicine)}
              className="w-full"
              disabled={readOnly || medicine.stock_quantity === 0 || (isPharmacy && isExpired(medicine.expiry_date))}
            >
              <Plus className="h-4 w-4 mr-2" />
              {readOnly ? 'Read Only' : isPharmacy && isExpired(medicine.expiry_date) ? 'Expired' : 'Add to Cart'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              Please select a branch to sell items
            </p>
          )}
        </div>
      </CardContent>
    </Card>
    );
  };

  if (loading) {
    return <div className="p-4 text-muted-foreground">Loading {isPharmacy ? 'medicines' : 'items'}...</div>;
  }

  const isCustomSaleDate = saleDate !== todayISO();

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 relative">
      {/* Medicine/Item list */}
      <div className="lg:col-span-2 space-y-4">
        {/* Sticky Sale Date bar — applies to every item in this transaction */}
        <div className="sticky top-0 z-30 -mx-2 px-2 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/60">
          <div className={`rounded-lg border ${isCustomSaleDate ? 'border-warning/60 bg-warning/10' : 'border-primary/30 bg-primary/5'} p-3 flex items-center gap-3`}>
            <CalendarIcon className={`h-5 w-5 shrink-0 ${isCustomSaleDate ? 'text-warning' : 'text-primary'}`} />
            <div className="flex-1 min-w-0">
              <Label htmlFor="sale-date-input" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sale Date {isCustomSaleDate && <span className="text-warning normal-case">· Custom date applied to this transaction</span>}
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  id="sale-date-input"
                  type="date"
                  value={saleDate}
                  max={todayISO()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    // Prevent future dates
                    if (v > todayISO()) {
                      toast({ title: 'Invalid date', description: 'Sale date cannot be in the future.', variant: 'destructive' });
                      return;
                    }
                    setSaleDate(v);
                  }}
                  className="h-10 text-base font-semibold w-auto min-w-[180px]"
                />
                {isCustomSaleDate && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 text-xs"
                    onClick={() => setSaleDate(todayISO())}
                  >
                    Reset to today
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Search + Filter row */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isPharmacy ? 'Search medicines...' : 'Search items...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40 md:w-48">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {getUniqueCategories().map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cart icon for < 1024px (mobile + tablet) */}
          {isSmallScreen && (
            <Button
              variant="default"
              size="icon"
              className="relative shrink-0"
              onClick={() => setCartOpen(true)}
            >
              <ShoppingCart className="h-5 w-5" />
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                  {cart.length}
                </span>
              )}
            </Button>
          )}
        </div>

        {/* Item grid */}
        {!selectedBranch && paginatedMedicines.some(m => m.branch_name) ? (
          (() => {
            const grouped: Record<string, Medicine[]> = {};
            paginatedMedicines.forEach(m => {
              const key = m.branch_name || 'Unknown Branch';
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(m);
            });
            return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([branchName, items]) => (
              <div key={branchName} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground">{branchName}</h3>
                  <Badge variant="secondary" className="text-xs">{items.length} {items.length === 1 ? 'item' : 'items'}</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map((medicine) => renderSaleCard(medicine))}
                </div>
              </div>
            ));
          })()
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paginatedMedicines.map((medicine) => renderSaleCard(medicine))}
          </div>
        )}

        {filteredMedicines.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No {isPharmacy ? 'medicines' : 'items'} found.</p>
          </div>
        )}

        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink isActive>
                  {currentPage} / {totalPages}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>

      {/* Cart — desktop sidebar / mobile slider */}
      <CartSlider
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        onRemove={removeFromCart}
        onUpdateQuantity={updateCartQuantity}
        onChangeSaleType={changeSaleType}
        onChangeSellLevel={changeSellLevel}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomer={setSelectedCustomerId}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        discountPercent={discountPercent}
        onDiscountChange={setDiscountPercent}
        discountMode={discountMode}
        onDiscountModeChange={(m) => { setDiscountMode(m); setDiscountPercent(0); }}
        amountReceived={amountReceived}
        onAmountReceivedChange={setAmountReceived}
        changeAction={changeAction}
        onChangeAction={setChangeAction}
        keepChangeOption={keepChangeOption}
        onKeepChangeOption={setKeepChangeOption}
        subtotal={subtotal}
        discount={discount}
        total={total}
        processing={processing}
        onCheckout={handleCheckout}
        creditCheck={creditCheck}
        onSetMeasurableQuantity={setMeasurableQuantity}
      />

      <AddToCartDialog
        open={!!selectedMedicineForDialog}
        onOpenChange={(v) => { if (!v) setSelectedMedicineForDialog(null); }}
        medicine={selectedMedicineForDialog}
        onAddToCart={addToCart}
      />

      <MedicineInfoDialog
        open={!!infoMed}
        onOpenChange={(open) => { if (!open) setInfoMed(null); }}
        branchItemId={infoMed?.branchItemId}
        medicineId={infoMed?.medicineId}
        fallbackName={infoMed?.name}
      />

      <ConfirmationDialog
        open={showCheckoutConfirm}
        onOpenChange={setShowCheckoutConfirm}
        title="Confirm Checkout"
        description={`Complete sale? Total: ETB ${total.toFixed(2)} via ${paymentMethod}`}
        onConfirm={confirmCheckout}
        confirmText="Complete Sale"
      />
    </div>
  );
}
