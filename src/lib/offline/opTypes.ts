export type EntityType = 'customer' | 'supplier' | 'medicine_code';
export type OpType = `${EntityType}.${'create' | 'update'}`;
export type OpStatus = 'pending' | 'syncing' | 'synced' | 'needs_attention' | 'discarded';
export interface LocalOp {
  opId: string; userId: string; branchId: string; opType: OpType; entityType: EntityType; entityId: string;
  payload: Record<string, string | null>; baseUpdatedAt?: string; prevOpId?: string; deviceCreatedAt: string;
  status: OpStatus; attempts: number; nextAttemptAt?: number; lastError?: string; reasonCode?: string;
  details?: Record<string, unknown>; serverUpdatedAt?: string; discardNote?: string; discardedAt?: string;
  updatedAt: string; serverIssue?: boolean; ownerVoided?: boolean;
}
export interface OpResult {
  status: 'applied' | 'needs_attention' | 'rejected' | 'voided'; op_id?: string; entity_id?: string;
  updated_at?: string; duplicate?: boolean; reason_code?: string; details?: Record<string, unknown>;
  reason_detail?: unknown; resolution_note?: string;
}
export const OP_FIELDS: Record<EntityType, readonly string[]> = {
  customer: ['name', 'phone', 'notes'],
  supplier: ['name', 'contact_person', 'phone', 'email', 'address'],
  medicine_code: ['code', 'label', 'notes'],
};
export const OP_EXPORT_FIELDS = ['opId', 'userId', 'branchId', 'opType', 'entityType', 'entityId', 'payload',
  'baseUpdatedAt', 'prevOpId', 'deviceCreatedAt', 'status', 'attempts', 'nextAttemptAt', 'lastError', 'reasonCode',
  'details', 'serverUpdatedAt', 'discardNote', 'discardedAt', 'updatedAt', 'serverIssue', 'ownerVoided'] as const;
export const unresolvedOp = (op: LocalOp) => op.status !== 'synced';
export function exportOp(op: LocalOp): LocalOp {
  return Object.fromEntries(OP_EXPORT_FIELDS.map(k => [k, op[k]])) as unknown as LocalOp;
}
export function opReason(code?: string): string {
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
  if (op.status === 'needs_attention') return `Needs attention: ${opReason(op.reasonCode)}`;
  if (op.status === 'discarded') return 'Discarded — not recorded';
}