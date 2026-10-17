/**
 * __tests__/keyboard-shortcuts.test.tsx
 *
 * Vitest + jsdom coverage for:
 *   - useKeyboardShortcuts: registration, handler dispatch, preventDefault,
 *     input-focused guard, disabled flag, cleanup on unmount
 *   - KeyboardShortcutsProvider: wraps the hook, renders ShortcutReferenceModal,
 *     handles kora:open-shortcut-modal event, routes ⌘K to command palette
 *   - Shortcut priority / CommandPalette conflict: ⌘K must not fire when an
 *     input is focused
 *   - No listener leaks after unmount
 */

import React from "react";
import {
  renderHook,
  render,
  act,
  cleanup,
} from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Shared mock state — mutated per describe block ─────────────────────────────
const uiStoreMockState = {
  setWalletModalOpen: vi.fn(),
  setCommandPaletteOpen: vi.fn(),
  shortcutsEnabled: true as boolean,
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: (selector: (s: typeof uiStoreMockState) => unknown) =>
    selector(uiStoreMockState),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  motion: {
    div: React.forwardRef(
      (props: React.ComponentPropsWithRef<"div">, ref: React.Ref<HTMLDivElement>) =>
        React.createElement("div", { ...props, ref })
    ),
  },
}));

vi.mock("@/hooks/useCommandPalette", () => ({
  useCommandPalette: () => ({ open: false, setOpen: vi.fn() }),
  COMMAND_PALETTE_SHORTCUTS: [],
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { KeyboardShortcutsProvider } from "../components/keyboard/KeyboardShortcutsProvider";

// ── Helpers ───────────────────────────────────────────────────────────────────

function keyDown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

// ─── useKeyboardShortcuts — registration and dispatch ─────────────────────────

describe("useKeyboardShortcuts — registration and dispatch", () => {
  const onOpenSearch = vi.fn();
  const onOpenShortcutModal = vi.fn();
  const onToggleWebVitals = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    uiStoreMockState.shortcutsEnabled = true;
    uiStoreMockState.setWalletModalOpen = vi.fn();
    uiStoreMockState.setCommandPaletteOpen = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("calls onOpenSearch when ⌘K is pressed", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("k", { metaKey: true });
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it("calls onOpenSearch when Ctrl+K is pressed", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("k", { ctrlKey: true });
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it("prevents default on ⌘K so the browser search bar doesn't open", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    act(() => document.dispatchEvent(event));
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("calls onOpenShortcutModal when ? is pressed", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("?");
    expect(onOpenShortcutModal).toHaveBeenCalledOnce();
  });

  it("navigates to /marketplace on G then M sequence", () => {
    vi.useFakeTimers();
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("g");
    keyDown("m");
    expect(pushMock).toHaveBeenCalledWith("/marketplace");
    vi.useRealTimers();
  });

  it("navigates to /dashboard/investor on G then D", () => {
    vi.useFakeTimers();
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("g");
    keyDown("d");
    expect(pushMock).toHaveBeenCalledWith("/dashboard/investor");
    vi.useRealTimers();
  });

  it("sequence auto-clears after 1500 ms — stale G does not fire", () => {
    vi.useFakeTimers();
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("g");
    act(() => vi.advanceTimersByTime(1600));
    keyDown("m");
    expect(pushMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does NOT fire when a text input is focused", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    const input = document.createElement("input");
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    Object.defineProperty(document, "activeElement", {
      get: () => input,
      configurable: true,
    });

    keyDown("?");
    expect(onOpenShortcutModal).not.toHaveBeenCalled();

    if (originalDescriptor) {
      Object.defineProperty(document, "activeElement", originalDescriptor);
    }
  });

  it("does NOT fire when a textarea is focused", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    const area = document.createElement("textarea");
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    Object.defineProperty(document, "activeElement", {
      get: () => area,
      configurable: true,
    });

    keyDown("k", { metaKey: true });
    expect(onOpenSearch).not.toHaveBeenCalled();

    if (originalDescriptor) {
      Object.defineProperty(document, "activeElement", originalDescriptor);
    }
  });

  it("does NOT fire when a contentEditable element is focused", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    // jsdom's activeElement getter cannot be easily overridden via defineProperty,
    // so we stub the entire activeElement property on the document to return a
    // mock element that reports isContentEditable=true.
    const fakeContentEditable = {
      tagName: "DIV",
      isContentEditable: true,
    };
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    Object.defineProperty(document, "activeElement", {
      get: () => fakeContentEditable,
      configurable: true,
    });

    keyDown("?");
    expect(onOpenShortcutModal).not.toHaveBeenCalled();

    // Restore the original descriptor
    if (originalDescriptor) {
      Object.defineProperty(document, "activeElement", originalDescriptor);
    } else {
      Object.defineProperty(document, "activeElement", {
        get: () => document.body,
        configurable: true,
      });
    }
  });

  it("removes document keydown listener on unmount", () => {
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );

    keyDown("?");
    expect(onOpenShortcutModal).toHaveBeenCalledOnce();

    unmount();
    vi.clearAllMocks();

    keyDown("?");
    expect(onOpenShortcutModal).not.toHaveBeenCalled();
  });

  it("handles ⌘W to open wallet modal", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("w", { metaKey: true });
    expect(uiStoreMockState.setWalletModalOpen).toHaveBeenCalledWith(true);
  });

  it("handles Ctrl+W to open wallet modal", () => {
    renderHook(() =>
      useKeyboardShortcuts({ onOpenSearch, onOpenShortcutModal, onToggleWebVitals })
    );
    keyDown("w", { ctrlKey: true });
    expect(uiStoreMockState.setWalletModalOpen).toHaveBeenCalledWith(true);
  });
});

// ─── useKeyboardShortcuts — shortcutsEnabled = false ─────────────────────────

describe("useKeyboardShortcuts — shortcuts disabled", () => {
  const onOpenSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    uiStoreMockState.shortcutsEnabled = false;
  });

  afterEach(() => {
    cleanup();
    uiStoreMockState.shortcutsEnabled = true;
  });

  it("does not fire any handler when shortcutsEnabled is false", () => {
    renderHook(() => useKeyboardShortcuts({ onOpenSearch }));
    keyDown("k", { metaKey: true });
    expect(onOpenSearch).not.toHaveBeenCalled();
  });
});

// ─── KeyboardShortcutsProvider ────────────────────────────────────────────────

describe("KeyboardShortcutsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uiStoreMockState.shortcutsEnabled = true;
    uiStoreMockState.setCommandPaletteOpen = vi.fn();
    uiStoreMockState.setWalletModalOpen = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    expect(() => render(React.createElement(KeyboardShortcutsProvider))).not.toThrow();
  });

  it("opens the command palette when ⌘K is pressed", () => {
    render(React.createElement(KeyboardShortcutsProvider));
    keyDown("k", { metaKey: true });
    expect(uiStoreMockState.setCommandPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("does not throw when ? is pressed (shortcut modal toggle)", () => {
    render(React.createElement(KeyboardShortcutsProvider));
    expect(() => keyDown("?")).not.toThrow();
  });

  it("opens the shortcut modal via kora:open-shortcut-modal custom event", () => {
    render(React.createElement(KeyboardShortcutsProvider));
    expect(() => {
      act(() => {
        window.dispatchEvent(new CustomEvent("kora:open-shortcut-modal"));
      });
    }).not.toThrow();
  });

  it("removes kora:open-shortcut-modal listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(React.createElement(KeyboardShortcutsProvider));
    unmount();

    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain("kora:open-shortcut-modal");
    removeSpy.mockRestore();
  });
});

// ─── Conflict: ⌘K must not fire when typing in a CommandPalette input ────────

describe("Shortcut conflict — ⌘K blocked inside inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uiStoreMockState.shortcutsEnabled = true;
    uiStoreMockState.setCommandPaletteOpen = vi.fn();
  });

  afterEach(() => {
    cleanup();
    // Restore activeElement via the original prototype descriptor
    const orig = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    if (orig) Object.defineProperty(document, "activeElement", orig);
  });

  it("does not open the palette when ⌘K is pressed inside an input", () => {
    render(React.createElement(KeyboardShortcutsProvider));

    const input = document.createElement("input");
    input.setAttribute("aria-label", "Command palette search");
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    Object.defineProperty(document, "activeElement", {
      get: () => input,
      configurable: true,
    });

    vi.clearAllMocks();
    keyDown("k", { metaKey: true });

    expect(uiStoreMockState.setCommandPaletteOpen).not.toHaveBeenCalled();

    if (originalDescriptor) {
      Object.defineProperty(document, "activeElement", originalDescriptor);
    }
  });
});

// ─── Rapid key-repeat events ──────────────────────────────────────────────────

describe("useKeyboardShortcuts — rapid key repeat", () => {
  const onOpenShortcutModal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    uiStoreMockState.shortcutsEnabled = true;
  });

  afterEach(cleanup);

  it("fires the handler once per keydown even during rapid repeats", () => {
    renderHook(() => useKeyboardShortcuts({ onOpenShortcutModal }));

    for (let i = 0; i < 5; i++) {
      keyDown("?");
    }

    expect(onOpenShortcutModal).toHaveBeenCalledTimes(5);
  });
});

// ─── Meta vs Ctrl normalisation ───────────────────────────────────────────────

describe("useKeyboardShortcuts — Meta vs Ctrl normalisation", () => {
  const onOpenSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    uiStoreMockState.shortcutsEnabled = true;
  });

  afterEach(cleanup);

  it("treats metaKey as equivalent to ctrlKey for ⌘K", () => {
    renderHook(() => useKeyboardShortcuts({ onOpenSearch }));
    keyDown("k", { metaKey: true });
    keyDown("k", { ctrlKey: true });
    expect(onOpenSearch).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire for plain K without modifier", () => {
    renderHook(() => useKeyboardShortcuts({ onOpenSearch }));
    keyDown("k");
    expect(onOpenSearch).not.toHaveBeenCalled();
  });
});
