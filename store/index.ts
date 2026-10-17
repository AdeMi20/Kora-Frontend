export * from "./walletStore";
export * from "./invoiceStore";
export * from "./uiStore";
export * from "./transactionStore";
export * from "./positionListingStore";
export { useTransactionHistoryStore } from "./transactionHistoryStore";
export type { TransactionRecord, TxType as HistoryTxType, TxStatus as HistoryTxStatus } from "./transactionHistoryStore";

// Canonical notification preferences live in `settingsStore`. The legacy
// `uiStore`/`invoiceStore` aliases below are deprecated shims kept only so
// existing imports keep resolving.
export { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "./settingsStore";
export { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "./uiStore";

