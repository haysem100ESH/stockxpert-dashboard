## Goal

Three focused changes to the inventory "Add Item → Custom Item" and per-branch add/edit price flows so packaging is strictly **unit → strip → pack** (no sub-units) and prices are always entered for the **LPI** (least possible item / single unit / tablet), with strip and pack prices auto-derived and shown read-only.

---

## 1. Custom Item form: Medicine Group → Medicine Code

File: `src/components/inventory/CreateCustomItemDialog.tsx`

- Remove the `Medicine Group` `Select` (and `medicineGroup` / `customGroup` state + reset + `medicine_group` field in the insert payload + `useMedicineGroups` import).
- Add a new `Medicine Code` field in the same grid cell, using the existing `MedicineCodeCombobox` component (`src/components/inventory/MedicineCodeCombobox.tsx`).
  - State: `const [medicineCodeId, setMedicineCodeId] = useState<string | null>(null)` — optional.
  - Inline-create is already supported by the combobox (popover with "+ Create new code") — works for new codes scoped to the current owner.
- On insert into `medicines`, include `medicine_code_id: medicineCodeId` (column already used elsewhere — see `useBranchInventory.tsx` select list).
- Keep the pharmacy-only wrapper around `Strength` (medicine code is pharmacy-only too, to match existing UI grouping).
- Reset `medicineCodeId` in `resetForm()`.

Result: When creating a custom item, the user picks (or inline-creates) a medicine code instead of a medicine group. Codes are owner-scoped and already filter to the current owner's branch context via `useMedicineCodes`.

---

## 2. Remove the "Sub-unit" feature (strip sub-level)

The packaging hierarchy is strictly: **Unit → Strip → Pack**. Anywhere a sub-unit-of-strip section exists, remove it.

### a) `src/components/inventory/CreateCustomItemDialog.tsx`
- Delete the entire "Sub-unit (optional)" block (the `<div>` rendered when `itemType === 'full_pcs' && packagingMode === 'with_strip'` containing `Sub-units per Unit` and `Sub-unit Name`).
- Remove related state: `subUnitsPerUnit`, `subUnitName` (and their resets).
- Remove the `sub_units_per_unit` / `sub_unit_name` assignment from `insertPayload`.

### b) `src/components/inventory/EditBranchItemDialog.tsx`
- Remove the `subUnitsPerUnit`, `subUnitName`, `subUnitPrice` state, their seeding from `item`, their dirty-check entries, and their inclusion in the update payload (`sub_units_per_unit`, `sub_unit_name`, `sub_unit_price`).
- Remove the UI section that edits these fields (the sub-unit input block).

### c) Display surfaces (read-only)
- `src/components/inventory/MedicineInfoDialog.tsx`: drop the `sub_units_per_unit` / `sub_unit_name` / `sub_unit_price` lines from the rendered breakdown and from the `select(...)` column list. Keep `unit_price`.
- `src/hooks/useBranchInventory.tsx` and `src/hooks/useSalesInventory.tsx`: drop `sub_units_per_unit`, `main_unit_name`, `sub_unit_name`, `sub_unit_price` from the `.select(...)` strings and from the mapped objects + TypeScript interfaces.
- `src/components/sales/SalesManagement.tsx`: remove the `sub_units_per_unit` / `sub_unit_name` / `sub_unit_price` interface fields and the comment referencing sub-unit sales. Verify no logic actually consumes them (a quick grep shows only field declarations/interfaces, not arithmetic).

The DB columns themselves are left intact (no migration in this change) — we simply stop reading and writing them so the UI behaves as if they don't exist.

---

## 3. Prices = LPI only; strip/pack prices auto-calculated (read-only)

The user enters **selling price** and **purchase price** for a single unit (LPI / tablet). Strip and pack prices, when applicable, are computed automatically and shown as read-only.

### a) `src/components/inventory/AddBranchItemDialog.tsx`
- Change the two price inputs (`Selling Price *`, `Purchase Price (Cost) *`) to be explicitly labeled `Selling Price per <unit_name>` and `Purchase Price per <unit_name>` (defaulting to "unit" / "tablet" from the item's packaging).
- Beneath each input, if `units_per_strip` and/or `strips_per_pack` are configured for the selected item, render a small read-only summary:
  - `Strip price: {unit × units_per_strip}` (auto)
  - `Pack price: {unit × units_per_strip × strips_per_pack}` (auto)
- On submit, the stored `selling_price` / `purchase_price` on `branch_items` and on the created batch remain the LPI value (consistent with how `EditBranchItemDialog` already stores `lpiSell` and lets `autoStripPrice` / `autoPackPrice` compute the rest).

### b) `src/components/inventory/EditBranchItemDialog.tsx`
- The form already converts to LPI on load (`Number(item.selling_price) / upp`) and writes via `autoStripPrice` / `autoPackPrice`. Tighten the UI:
  - Label the price inputs as LPI/unit explicitly (`Selling Price per {unit_name}`).
  - Render the computed `strip_selling_price` and `pack_selling_price` as **disabled inputs** (or plain read-only text) directly under the LPI inputs so the user can see them.
  - Remove any existing editable strip-price / pack-price field if present.
- Ensure `medicine_packaging` upsert continues to send `unit_selling_price = lpiSell`, `strip_selling_price = autoStripPrice(...)`, `pack_selling_price = autoPackPrice(...)`.

### c) Helpers
- Reuse `autoStripPrice` and `autoPackPrice` from `src/lib/packaging.ts` — no changes needed.

---

## Out of scope

- No DB migrations (existing `sub_*` columns stay; we just stop reading/writing them).
- No changes to sales/cart math — strip/pack pricing already derives from packaging via `usePackaging`.
- No changes to the standalone "Add Medicine" dialog beyond what's listed; if it also exposes sub-unit fields, they will be removed in the same pass as section 2 above.

## Verification

1. Open Inventory → Add Item → Custom Item: confirm "Medicine Group" is gone, "Medicine Code" combobox is present, inline-create works.
2. Confirm the "Sub-unit (optional)" panel no longer appears for any strip-mode item, and Edit Branch Item no longer shows sub-unit fields.
3. Add a new branch item with `units_per_strip = 10`, `strips_per_pack = 10`, selling price 2.00: verify it displays "Strip price: 20.00" and "Pack price: 200.00" read-only, and that `medicine_packaging` row stores `unit_selling_price = 2`, `strip_selling_price = 20`, `pack_selling_price = 200`.
4. Sales screen still renders unit/strip/pack prices correctly (driven by `medicine_packaging`, unchanged).
