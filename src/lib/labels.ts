// Human-readable labels for the enum-style values stored in the database and returned by the API.

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  RECEIPT: "Receipt",
  ISSUE: "Issue",
  RETURN: "Return",
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
  SCRAP: "Scrapped",
  SHARPEN_DISPATCH: "Sharpening dispatch",
  SHARPEN_RETURN: "Sharpening return",
  REVERSAL: "Reversal",
};

export const MOVEMENT_STATUS_LABELS: Record<string, string> = {
  POSTED: "Posted",
  PENDING_APPROVAL: "Pending approval",
  CANCELLED: "Rejected",
  REVERSED: "Reversed",
  DRAFT: "Draft",
};

export const STOCK_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  SHARPENING: "In sharpening",
  SCRAPPED: "Scrapped",
  RESERVED: "Reserved",
};

export const RECORD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const ADJUSTMENT_DIRECTION_LABELS: Record<string, string> = {
  INCREASE: "Increase",
  DECREASE: "Decrease",
};

function titleCase(value: string) {
  const words = value.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelFrom(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—";
  return map[value] ?? titleCase(value);
}

export const movementTypeLabel = (value: string | null | undefined) => labelFrom(MOVEMENT_TYPE_LABELS, value);
export const movementStatusLabel = (value: string | null | undefined) => labelFrom(MOVEMENT_STATUS_LABELS, value);
export const stockStatusLabel = (value: string | null | undefined) => labelFrom(STOCK_STATUS_LABELS, value);
export const recordStatusLabel = (value: string | null | undefined) => labelFrom(RECORD_STATUS_LABELS, value);

// "1 tool", "2 tools".
export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
