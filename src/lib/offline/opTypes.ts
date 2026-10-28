export type EntityType = 'customer' | 'supplier' | 'medicine_code' | 'stock';
export type OpType = `${Exclude<EntityType, 'stock'>}.${'create' | 'update'}` | 'stock.receive' | 'stock.adjust';
export type OpStatus = 'pending' | 'syncing' | 'synced' | 'needs_attention' | 'discarded';
export interface LocalOp {
  opId: string; userId: string; branchId: string; opType: OpType; entityType: EntityType; entityId: string;
  payload: Record<string, string | number | null>; baseUpdatedAt?: string; prevOpId?: string; dependsOn?: string[]; stockItemId?: string; deviceCreatedAt: string;
  status: OpStatus; attempts: number; nextAttemptAt?: number; lastError?: string; reasonCode?: string;
  details?: Record<string, unknown>; serverUpdatedAt?: string; discardNote?: string; discardedAt?: string;
  updatedAt: string; serverIssue?: boolean; ownerVoided?: boolean;
}
export interface OpResult {
  status: 'applied' | 'needs_attention' | 'rejected' | 'voided'; op_id?: string; entity_id?: string;
  updated_at?: string; duplicate?: boolean; reason_code?: string; details?: Record<string, unknown>;
  reason_detail?: unknown; resolution_note?: string;
  result?: { branch_item_id?: string; previous?: number; new?: number }; branch_item_id?: string; previous?: number; new?: number;
}
export const OP_FIELDS: Record<EntityType, readonly string[]> = {
  customer: ['name', 'phone', 'notes'],
  supplier: ['name', 'contact_person', 'phone', 'email', 'address'],
  medicine_code: ['code', 'label', 'notes'],
  stock: ['branch_item_id', 'quantity', 'selling_price', 'purchase_price', 'expiry_date', 'batch_number', 'supplier_id', 'min_stock_level', 'expiry_alert_days', 'batch_id', 'delta', 'reason_type', 'note'],
};
export const OP_EXPORT_FIELDS = ['opId', 'userId', 'branchId', 'opType', 'entityType', 'entityId', 'payload',
  'baseUpdatedAt', 'prevOpId', 'dependsOn', 'stockItemId', 'deviceCreatedAt', 'status', 'attempts', 'nextAttemptAt', 'lastError', 'reasonCode',
  'details', 'serverUpdatedAt', 'discardNote', 'discardedAt', 'updatedAt', 'serverIssue', 'ownerVoided'] as const;
export const unresolvedOp = (op: LocalOp) => op.status !== 'synced';
export function exportOp(op: LocalOp): LocalOp {
  return Object.fromEntries(OP_EXPORT_FIELDS.map(k => [k, op[k]])) as unknown as LocalOp;
}
export function opReason(code?: string, detail?: Record<string, unknown>): string {
  if (code === 'NEGATIVE_STOCK') return `Not enough stock: batch has ${detail?.current ?? '?'}, change was ${detail?.delta ?? '?'}.`;
  if (code === 'SUPPLIER_NOT_FOUND') return 'The supplier is no longer available. The owner can receive without supplier.';
  if (code === 'NOT_FOUND' && detail?.what) return `This ${detail.what === 'batch' ? 'batch' : 'item'} no longer exists. Void this change.`;
  const messages: Record<string, string> = {
    VERSION_CONFLICT: 'This record changed on the server. The owner must review it.',
    DUPLICATE_PHONE: 'This phone number is already used.', DUPLICATE_NAME: 'This name is already used.',
    DUPLICATE_CODE: 'This medicine code is already used.', NOT_FOUND: 'This record no longer exists.',
    INVALID_INPUT: 'Some fields are invalid.', NO_EDIT_PERMISSION: 'You do not have edit permission.',
    BRANCH_NOT_AUTHORIZED: 'You cannot edit records in this branch.', USER_NOT_ALLOWED: 'Your account cannot edit records.',
    ACCOUNT_INACTIVE: 'Your account is inactive.', ID_EXISTS: 'This record ID already exists.',
    INVALID_PAYLOAD: 'The record contains unsupported fields.', UNSUPPORTED_OP: 'This operation is not supported.',
    OP_ID_IN_USE: 'This operation ID is already in use.', DEPENDS_ON_UNSYNCED: 'An earlier change must be resolved first.',
    VOIDED_BY_OWNER: 'Voided by owner',
  };
  return messages[code ?? ''] ?? 'Could not confirm this change. Review the server response.';
}
export function opBadge(op: LocalOp): string | undefined {
  if (op.ownerVoided) return `Voided by owner: ${op.discardNote ?? ''}`;
  if (op.status === 'pending') return 'Pending sync';
  if (op.status === 'syncing') return 'Syncing';
  if (op.status === 'needs_attention') return `Needs attention: ${opReason(op.reasonCode, op.details)}`;
  if (op.status === 'discarded') return 'Discarded — not recorded';
}
export function ownerForceLabel(code?: string, stock = false): string | undefined {
  if (code === 'NEGATIVE_STOCK') return "Write off what's left";
  if (code === 'SUPPLIER_NOT_FOUND') return 'Receive without supplier';
  if (!stock && ['VERSION_CONFLICT', 'DUPLICATE_PHONE', 'DUPLICATE_NAME'].includes(code ?? '')) return 'Keep offline change';
}
export const opLabel = (type: string) => type === 'stock.receive' ? 'Receive stock' : type === 'stock.adjust' ? 'Adjust stock' : type.replace('.', ' ');