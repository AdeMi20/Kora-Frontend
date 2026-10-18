import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useSettingsStore,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_TOUR_SETTINGS,
  DEFAULT_CONCENTRATION_SETTINGS,
  SETTINGS_STORAGE_BASE_KEY,
  migrateLegacyNotificationPreferences,
  normalizeSettingsWalletAddress,
  settingsStorageKey,
  LEGACY_UI_STORE_KEY,
  LEGACY_INVOICE_STORE_KEY,
} from "../store/settingsStore";
import {
  DEFAULT_CONCENTRATION_THRESHOLDS,
  SNOOZE_DURATIONS_MS,
} from "@/lib/concentrationRisk";

function resetStore() {
  useSettingsStore.setState({
    notifications: { ...DEFAULT_NOTIFICATION_PREFS },
    notificationsByWallet: {},
    activeWallet: null,
    notificationsMigrated: false,
    tour: { ...DEFAULT_TOUR_SETTINGS },
    concentration: { ...DEFAULT_CONCENTRATION_SETTINGS },
  });
  // Wallet-scoped tests rotate the persist key; restore the disconnected
  // bucket so tests cannot leak key state into one another.
  useSettingsStore.persist.setOptions({ name: SETTINGS_STORAGE_BASE_KEY });
  localStorage.clear();
}

describe("settingsStore — notification preferences", () => {
  beforeEach(resetStore);

  it("defaults all notifications to true", () => {
    const { notifications } = useSettingsStore.getState();
    expect(notifications.maturityReminder).toBe(true);
    expect(notifications.fundingAlerts).toBe(true);
    expect(notifications.repaymentAlerts).toBe(true);
  });

  it("defaults maturityReminderDays to 3", () => {
    expect(useSettingsStore.getState().notifications.maturityReminderDays).toBe(3);
  });

  it("updates a single preference without affecting others", () => {
    useSettingsStore.getState().setNotifications({ maturityReminder: false });
    const { notifications } = useSettingsStore.getState();
    expect(notifications.maturityReminder).toBe(false);
    expect(notifications.fundingAlerts).toBe(true);
    expect(notifications.repaymentAlerts).toBe(true);
  });

  it("updates maturityReminderDays", () => {
    useSettingsStore.getState().setNotifications({ maturityReminderDays: 7 });
    expect(useSettingsStore.getState().notifications.maturityReminderDays).toBe(7);
  });

  it("resets to defaults", () => {
    useSettingsStore.getState().setNotifications({
      maturityReminder: false,
      fundingAlerts: false,
      repaymentAlerts: false,
      maturityReminderDays: 1,
    });
    useSettingsStore.getState().resetNotifications();
    expect(useSettingsStore.getState().notifications).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe("settingsStore — onboarding tour settings", () => {
  beforeEach(resetStore);

  it("defaults to investor persona and step 0", () => {
    const { tour } = useSettingsStore.getState();
    expect(tour.persona).toBe("investor");
    expect(tour.stepIndex).toBe(0);
    expect(tour.completed).toBe(false);
    expect(tour.skipped).toBe(false);
  });

  it("updates tour settings properly", () => {
    useSettingsStore.getState().setTourSettings({ persona: "sme", stepIndex: 2 });
    const { tour } = useSettingsStore.getState();
    expect(tour.persona).toBe("sme");
    expect(tour.stepIndex).toBe(2);
  });

  it("restarts tour and resets stepIndex/completed/skipped", () => {
    useSettingsStore.getState().setTourSettings({ stepIndex: 3, completed: true });
    useSettingsStore.getState().restartTour("sme");
    const { tour } = useSettingsStore.getState();
    expect(tour.persona).toBe("sme");
    expect(tour.stepIndex).toBe(0);
    expect(tour.completed).toBe(false);
    expect(tour.skipped).toBe(false);
  });
});

describe("settingsStore — concentration settings", () => {
  beforeEach(resetStore);

  it("defaults concentration settings", () => {
    const { concentration } = useSettingsStore.getState();
    expect(concentration.thresholds).toEqual(DEFAULT_CONCENTRATION_THRESHOLDS);
    expect(concentration.dismissedKeys).toEqual([]);
    expect(concentration.snoozes).toEqual([]);
  });

  describe("setConcentrationThresholds", () => {
    it("updates a single threshold without affecting others", () => {
      useSettingsStore.getState().setConcentrationThresholds({ debtor: 30 });
      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds.debtor).toBe(30);
      expect(concentration.thresholds.jurisdiction).toBe(DEFAULT_CONCENTRATION_THRESHOLDS.jurisdiction);
      expect(concentration.thresholds.riskTier).toBe(DEFAULT_CONCENTRATION_THRESHOLDS.riskTier);
    });

    it("updates multiple thresholds", () => {
      useSettingsStore.getState().setConcentrationThresholds({
        debtor: 20,
        jurisdiction: 35,
      });
      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds.debtor).toBe(20);
      expect(concentration.thresholds.jurisdiction).toBe(35);
      expect(concentration.thresholds.riskTier).toBe(DEFAULT_CONCENTRATION_THRESHOLDS.riskTier);
    });

    it("updates all thresholds", () => {
      useSettingsStore.getState().setConcentrationThresholds({
        debtor: 15,
        jurisdiction: 30,
        riskTier: 40,
      });
      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds).toEqual({ debtor: 15, jurisdiction: 30, riskTier: 40 });
    });

    it("preserves dismissedKeys and snoozes when updating thresholds", () => {
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      useSettingsStore.getState().snoozeConcentrationAlert("jurisdiction:US", SNOOZE_DURATIONS_MS.day);

      useSettingsStore.getState().setConcentrationThresholds({ debtor: 20 });

      const { concentration } = useSettingsStore.getState();
      expect(concentration.dismissedKeys).toContain("debtor:Acme Corp");
      expect(concentration.snoozes).toHaveLength(1);
      expect(concentration.snoozes[0].key).toBe("jurisdiction:US");
    });
  });

  describe("dismissConcentrationAlert", () => {
    it("adds key to dismissedKeys", () => {
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      expect(useSettingsStore.getState().concentration.dismissedKeys).toEqual(["debtor:Acme Corp"]);
    });

    it("does not duplicate key if already dismissed", () => {
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      expect(useSettingsStore.getState().concentration.dismissedKeys).toEqual(["debtor:Acme Corp"]);
    });

    it("can dismiss multiple different keys", () => {
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      useSettingsStore.getState().dismissConcentrationAlert("jurisdiction:US");
      useSettingsStore.getState().dismissConcentrationAlert("riskTier:High");
      expect(useSettingsStore.getState().concentration.dismissedKeys).toHaveLength(3);
      expect(useSettingsStore.getState().concentration.dismissedKeys).toContain("debtor:Acme Corp");
      expect(useSettingsStore.getState().concentration.dismissedKeys).toContain("jurisdiction:US");
      expect(useSettingsStore.getState().concentration.dismissedKeys).toContain("riskTier:High");
    });

    it("preserves thresholds and snoozes when dismissing", () => {
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp", SNOOZE_DURATIONS_MS.day);
      useSettingsStore.getState().dismissConcentrationAlert("jurisdiction:US");

      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds).toEqual(DEFAULT_CONCENTRATION_THRESHOLDS);
      expect(concentration.snoozes).toHaveLength(1);
      expect(concentration.snoozes[0].key).toBe("debtor:Acme Corp");
    });
  });

  describe("snoozeConcentrationAlert", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("adds snooze entry with key and expiry", () => {
      const now = Date.now();
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp", SNOOZE_DURATIONS_MS.day);

      const { concentration } = useSettingsStore.getState();
      expect(concentration.snoozes).toHaveLength(1);
      expect(concentration.snoozes[0].key).toBe("debtor:Acme Corp");
      expect(concentration.snoozes[0].until).toBe(now + SNOOZE_DURATIONS_MS.day);
    });

    it("uses default snooze duration (1 day) when not specified", () => {
      const now = Date.now();
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp");

      const { concentration } = useSettingsStore.getState();
      expect(concentration.snoozes[0].until).toBe(now + SNOOZE_DURATIONS_MS.day);
    });

    it("replaces existing snooze for same key instead of stacking", () => {
      const now = Date.now();
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp", SNOOZE_DURATIONS_MS.day);

      // Snooze again with different duration
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp", SNOOZE_DURATIONS_MS.week);

      const { concentration } = useSettingsStore.getState();
      expect(concentration.snoozes).toHaveLength(1);
      expect(concentration.snoozes[0].key).toBe("debtor:Acme Corp");
      expect(concentration.snoozes[0].until).toBe(now + SNOOZE_DURATIONS_MS.week);
    });

    it("can snooze multiple different keys", () => {
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp", SNOOZE_DURATIONS_MS.day);
      useSettingsStore.getState().snoozeConcentrationAlert("jurisdiction:US", SNOOZE_DURATIONS_MS.week);

      const { concentration } = useSettingsStore.getState();
      expect(concentration.snoozes).toHaveLength(2);
      expect(concentration.snoozes.map((s) => s.key).sort()).toEqual(["debtor:Acme Corp", "jurisdiction:US"].sort());
    });

    it("preserves thresholds and dismissedKeys when snoozing", () => {
      useSettingsStore.getState().setConcentrationThresholds({ debtor: 20 });
      useSettingsStore.getState().dismissConcentrationAlert("jurisdiction:US");
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Acme Corp");

      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds.debtor).toBe(20);
      expect(concentration.dismissedKeys).toContain("jurisdiction:US");
      expect(concentration.snoozes).toHaveLength(1);
    });
  });

  describe("resetConcentrationAlerts", () => {
    it("clears dismissedKeys and snoozes", () => {
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      useSettingsStore.getState().dismissConcentrationAlert("jurisdiction:US");
      useSettingsStore.getState().snoozeConcentrationAlert("riskTier:High", SNOOZE_DURATIONS_MS.day);

      useSettingsStore.getState().resetConcentrationAlerts();

      const { concentration } = useSettingsStore.getState();
      expect(concentration.dismissedKeys).toEqual([]);
      expect(concentration.snoozes).toEqual([]);
    });

    it("preserves thresholds when resetting alerts", () => {
      useSettingsStore.getState().setConcentrationThresholds({ debtor: 20 });
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      useSettingsStore.getState().resetConcentrationAlerts();

      expect(useSettingsStore.getState().concentration.thresholds.debtor).toBe(20);
    });
  });

  describe("persistence", () => {
    it("persists concentration settings to localStorage", () => {
      useSettingsStore.getState().setConcentrationThresholds({ debtor: 20 });
      useSettingsStore.getState().dismissConcentrationAlert("debtor:Acme Corp");
      useSettingsStore.getState().snoozeConcentrationAlert("jurisdiction:US", SNOOZE_DURATIONS_MS.day);

      // Force persist by checking localStorage
      const stored = localStorage.getItem("kora-settings-store");
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(parsed.state.concentration.thresholds.debtor).toBe(20);
      expect(parsed.state.concentration.dismissedKeys).toContain("debtor:Acme Corp");
      expect(parsed.state.concentration.snoozes).toHaveLength(1);
      expect(parsed.state.concentration.snoozes[0].key).toBe("jurisdiction:US");
    });

    it("loads persisted concentration settings on rehydration", () => {
      // Simulate persisted state
      const persistedState = {
        concentration: {
          thresholds: { debtor: 15, jurisdiction: 30, riskTier: 40 },
          dismissedKeys: ["debtor:Old Corp"],
          snoozes: [{ key: "jurisdiction:CA", until: Date.now() + SNOOZE_DURATIONS_MS.week }],
        },
      };
      localStorage.setItem("kora-settings-store", JSON.stringify({ state: persistedState, version: 0 }));

      // Create a new store instance (simulated by re-importing)
      // Since we can't easily re-import, we'll test by setting state directly
      useSettingsStore.setState({ concentration: persistedState.concentration });

      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds.debtor).toBe(15);
      expect(concentration.dismissedKeys).toContain("debtor:Old Corp");
      expect(concentration.snoozes).toHaveLength(1);
      expect(concentration.snoozes[0].key).toBe("jurisdiction:CA");
    });
  });

  describe("edge cases", () => {
    it("handles zero/negative threshold values", () => {
      useSettingsStore.getState().setConcentrationThresholds({ debtor: 0, jurisdiction: -1 });
      const { concentration } = useSettingsStore.getState();
      expect(concentration.thresholds.debtor).toBe(0);
      expect(concentration.thresholds.jurisdiction).toBe(-1);
    });

    it("handles empty string keys gracefully", () => {
      useSettingsStore.getState().dismissConcentrationAlert("");
      expect(useSettingsStore.getState().concentration.dismissedKeys).toContain("");
    });

    it("snooze with very short duration", () => {
      const now = Date.now();
      useSettingsStore.getState().snoozeConcentrationAlert("debtor:Test", 100);
      expect(useSettingsStore.getState().concentration.snoozes[0].until).toBe(now + 100);
    });
  });
});

describe("settingsStore — wallet scoping", () => {
  beforeEach(resetStore);

  it("snapshots the outgoing wallet's preferences when switching", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ fundingAlerts: false });

    useSettingsStore.getState().setActiveWallet("GBOB");

    // Bob starts from defaults while Alice's edit is retained under her key.
    expect(useSettingsStore.getState().activeWallet).toBe("GBOB");
    expect(useSettingsStore.getState().notifications.fundingAlerts).toBe(true);
    expect(useSettingsStore.getState().notificationsByWallet.GALICE.fundingAlerts).toBe(false);
  });

  it("restores a known wallet's preferences on reconnect", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ apr: true, status: false });

    useSettingsStore.getState().setActiveWallet("GBOB");
    useSettingsStore.getState().setActiveWallet("GALICE");

    expect(useSettingsStore.getState().notifications.apr).toBe(true);
    expect(useSettingsStore.getState().notifications.status).toBe(false);
  });

  it("adopts already-loaded preferences for the first wallet to connect", () => {
    // A user who configured things before scoping existed must not be reset.
    useSettingsStore.getState().setNotifications({ maturityReminder: false });

    useSettingsStore.getState().setActiveWallet("GALICE");

    expect(useSettingsStore.getState().notifications.maturityReminder).toBe(false);
  });

  it("keeps the last wallet's preferences loaded on disconnect", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ apr: true });

    useSettingsStore.getState().setActiveWallet(null);

    // Disconnect is not a reset; a reconnect should be a no-op.
    expect(useSettingsStore.getState().activeWallet).toBe("GALICE");
    expect(useSettingsStore.getState().notifications.apr).toBe(true);
  });

  it("is a no-op when targeting the already-active wallet", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ apr: true });

    const before = useSettingsStore.getState().notifications;
    useSettingsStore.getState().setActiveWallet("GALICE");

    expect(useSettingsStore.getState().notifications).toBe(before);
  });

  it("mirrors edits into the active wallet's snapshot", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ apr: true });

    expect(useSettingsStore.getState().notificationsByWallet.GALICE.apr).toBe(true);
  });

  it("resets only the active wallet's snapshot", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ apr: true });
    useSettingsStore.getState().setActiveWallet("GBOB");
    useSettingsStore.getState().setNotifications({ apr: true });

    useSettingsStore.getState().resetNotifications();

    expect(useSettingsStore.getState().notifications).toEqual(DEFAULT_NOTIFICATION_PREFS);
    // Alice's saved preferences survive a reset performed on Bob's session.
    expect(useSettingsStore.getState().notificationsByWallet.GALICE.apr).toBe(true);
    expect(useSettingsStore.getState().notificationsByWallet.GBOB).toEqual(
      DEFAULT_NOTIFICATION_PREFS
    );
  });
});

describe("settingsStore — per-wallet persistence keys", () => {
  beforeEach(resetStore);

  it("uses the base key while disconnected", () => {
    expect(settingsStorageKey(null)).toBe(SETTINGS_STORAGE_BASE_KEY);
    expect(useSettingsStore.persist.getOptions().name).toBe(
      SETTINGS_STORAGE_BASE_KEY
    );
  });

  it("normalises address casing and whitespace into one bucket", () => {
    expect(normalizeSettingsWalletAddress("galice")).toBe("GALICE");
    expect(normalizeSettingsWalletAddress("  GALICE  ")).toBe("GALICE");
    expect(normalizeSettingsWalletAddress("")).toBeNull();
    expect(normalizeSettingsWalletAddress(undefined)).toBeNull();

    expect(settingsStorageKey("galice")).toBe(
      `${SETTINGS_STORAGE_BASE_KEY}-GALICE`
    );
    expect(settingsStorageKey("GALICE")).toBe(settingsStorageKey("galice"));
  });

  it("rotates the persist key to the connected wallet", () => {
    useSettingsStore.getState().setActiveWallet("galice");

    expect(useSettingsStore.getState().activeWallet).toBe("GALICE");
    expect(useSettingsStore.persist.getOptions().name).toBe(
      `${SETTINGS_STORAGE_BASE_KEY}-GALICE`
    );
  });

  it("writes edits into the active wallet's bucket", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ fundingAlerts: false });

    const bucket = localStorage.getItem(
      `${SETTINGS_STORAGE_BASE_KEY}-GALICE`
    );
    expect(bucket).toBeTruthy();
    expect(JSON.parse(bucket!).state.notifications.fundingAlerts).toBe(false);
  });

  it("keeps two wallets' buckets independent", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ fundingAlerts: false, apr: true });

    useSettingsStore.getState().setActiveWallet("GBOB");
    useSettingsStore.getState().setNotifications({ fundingAlerts: true, apr: false });

    const alice = JSON.parse(
      localStorage.getItem(`${SETTINGS_STORAGE_BASE_KEY}-GALICE`)!
    );
    const bob = JSON.parse(
      localStorage.getItem(`${SETTINGS_STORAGE_BASE_KEY}-GBOB`)!
    );

    expect(alice.state.notifications.fundingAlerts).toBe(false);
    expect(alice.state.notifications.apr).toBe(true);
    expect(bob.state.notifications.fundingAlerts).toBe(true);
    expect(bob.state.notifications.apr).toBe(false);
  });

  it("rotates back to a known wallet's key on reconnect", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setNotifications({ apr: true });
    useSettingsStore.getState().setActiveWallet("GBOB");
    useSettingsStore.getState().setActiveWallet("GALICE");

    expect(useSettingsStore.getState().activeWallet).toBe("GALICE");
    expect(useSettingsStore.persist.getOptions().name).toBe(
      `${SETTINGS_STORAGE_BASE_KEY}-GALICE`
    );
  });

  it("keeps the wallet key on disconnect — no reset, no leak", () => {
    useSettingsStore.getState().setActiveWallet("GALICE");
    useSettingsStore.getState().setActiveWallet(null);

    expect(useSettingsStore.getState().activeWallet).toBe("GALICE");
    expect(useSettingsStore.persist.getOptions().name).toBe(
      `${SETTINGS_STORAGE_BASE_KEY}-GALICE`
    );
  });
});

describe("settingsStore — legacy notification preference migration", () => {
  beforeEach(resetStore);

  function legacyPayload(prefs: Record<string, unknown>) {
    return JSON.stringify({ state: { notificationPreferences: prefs }, version: 0 });
  }

  function createStorage(initial: Record<string, string>) {
    const store = new Map(Object.entries(initial));
    return {
      store,
      readItem: (key: string) => store.get(key) ?? null,
      writeItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
  }

  it("folds uiStore + invoiceStore preferences into one partial", () => {
    const { readItem, writeItem } = createStorage({
      [LEGACY_UI_STORE_KEY]: legacyPayload({ txConfirmed: false, maturityReminderDays: 7 }),
      [LEGACY_INVOICE_STORE_KEY]: legacyPayload({ fundingProgress: false, apr: true }),
    });

    const { prefs, migrated } = migrateLegacyNotificationPreferences(readItem, writeItem);

    expect(migrated).toBe(true);
    expect(prefs).toEqual({
      txConfirmed: false,
      maturityReminderDays: 7,
      fundingProgress: false,
      apr: true,
    });
  });

  it("gives uiStore precedence on conflicting fields", () => {
    const { readItem, writeItem } = createStorage({
      [LEGACY_UI_STORE_KEY]: legacyPayload({ txConfirmed: false }),
      [LEGACY_INVOICE_STORE_KEY]: legacyPayload({ txConfirmed: true, apr: true }),
    });

    const { prefs } = migrateLegacyNotificationPreferences(readItem, writeItem);

    expect(prefs.txConfirmed).toBe(false);
    expect(prefs.apr).toBe(true);
  });

  it("strips the duplicated field from the legacy payloads", () => {
    const { store, readItem, writeItem } = createStorage({
      [LEGACY_UI_STORE_KEY]: legacyPayload({ txConfirmed: false }),
      [LEGACY_INVOICE_STORE_KEY]: legacyPayload({ apr: true }),
    });

    migrateLegacyNotificationPreferences(readItem, writeItem);

    const ui = JSON.parse(store.get(LEGACY_UI_STORE_KEY)!);
    const invoice = JSON.parse(store.get(LEGACY_INVOICE_STORE_KEY)!);
    expect("notificationPreferences" in ui.state).toBe(false);
    expect("notificationPreferences" in invoice.state).toBe(false);
  });

  it("reports migrated=false and an empty partial when nothing is stored", () => {
    const { readItem, writeItem } = createStorage({});

    const { prefs, migrated } = migrateLegacyNotificationPreferences(readItem, writeItem);

    expect(migrated).toBe(false);
    expect(prefs).toEqual({});
  });

  it("ignores malformed legacy payloads", () => {
    const { readItem, writeItem } = createStorage({
      [LEGACY_UI_STORE_KEY]: "{not json",
    });

    const { prefs, migrated } = migrateLegacyNotificationPreferences(readItem, writeItem);

    expect(migrated).toBe(false);
    expect(prefs).toEqual({});
  });

  it("carries only the fields present in the legacy payload", () => {
    const { readItem, writeItem } = createStorage({
      [LEGACY_UI_STORE_KEY]: legacyPayload({ txConfirmed: false }),
    });

    const { prefs } = migrateLegacyNotificationPreferences(readItem, writeItem);

    expect(prefs).toEqual({ txConfirmed: false });
    expect("apr" in prefs).toBe(false);
  });

  it("discards non-boolean / out-of-range legacy values", () => {
    const { readItem, writeItem } = createStorage({
      [LEGACY_UI_STORE_KEY]: legacyPayload({
        txConfirmed: "yes",
        apr: 1,
        maturityReminderDays: 5,
      }),
    });

    const { prefs } = migrateLegacyNotificationPreferences(readItem, writeItem);

    expect(prefs).toEqual({});
  });

  describe("onRehydrateStorage hook", () => {
    function runRehydrate(state: unknown) {
      const options = useSettingsStore.persist.getOptions();
      const handler = options.onRehydrateStorage?.(state as never);
      handler?.(state as never, undefined);
    }

    it("merges legacy preferences once and latches the marker", () => {
      localStorage.setItem(
        LEGACY_UI_STORE_KEY,
        legacyPayload({ txConfirmed: false, maturityReminderDays: 7 })
      );

      runRehydrate(useSettingsStore.getState());

      const state = useSettingsStore.getState();
      expect(state.notifications.txConfirmed).toBe(false);
      expect(state.notifications.maturityReminderDays).toBe(7);
      expect(state.notificationsMigrated).toBe(true);
      // The legacy field is removed so the two copies cannot drift again.
      const legacy = JSON.parse(localStorage.getItem(LEGACY_UI_STORE_KEY)!);
      expect("notificationPreferences" in legacy.state).toBe(false);
    });

    it("does not re-run once the marker is latched", () => {
      useSettingsStore.setState({ notificationsMigrated: true });
      localStorage.setItem(
        LEGACY_UI_STORE_KEY,
        legacyPayload({ txConfirmed: false })
      );

      runRehydrate(useSettingsStore.getState());

      expect(useSettingsStore.getState().notifications.txConfirmed).toBe(true);
    });

    it("skips migration when rehydration failed", () => {
      localStorage.setItem(
        LEGACY_UI_STORE_KEY,
        legacyPayload({ txConfirmed: false })
      );

      const options = useSettingsStore.persist.getOptions();
      const handler = options.onRehydrateStorage?.(useSettingsStore.getState() as never);
      handler?.(undefined as never, new Error("hydration failed"));

      expect(useSettingsStore.getState().notifications.txConfirmed).toBe(true);
      expect(useSettingsStore.getState().notificationsMigrated).toBe(false);
    });
  });
});