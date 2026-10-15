"use client";

import { CheckCheck, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/**
 * The one row-selection system every table in the site uses.
 *
 * Three pieces, always combined the same way:
 *
 *   <TableSelectionProvider ids={rows.map((row) => row.id)}>
 *     <table>
 *       <thead><th><SelectAllRowsCheckbox /></th></thead>
 *       <tbody><tr><td><RowSelectCheckbox id={row.id} /></td></tr></tbody>
 *     </table>
 *     <SelectionBar noun="طالب">{...bulk actions...}</SelectionBar>
 *   </TableSelectionProvider>
 *
 * The provider only knows identifiers. What a selection *does* — deleting,
 * enrolling, marking attendance — belongs to the table that owns it, which is
 * why the bulk actions are passed in as children instead of being configured
 * here. That keeps this file free of any entity or permission knowledge, so a
 * table in the student portal behaves like one in the admin portal without either
 * learning about the other.
 *
 * ## Why this is a store and not a context of selected ids
 *
 * The obvious implementation puts the ticked ids in context. A table of two
 * thousand students then has two thousand checkbox consumers, and every single
 * tick changes that context, so React re-renders all two thousand of them. Ticking
 * two rows in a subject roster took over forty seconds, and selecting all of them
 * took close to ninety — the same class of freeze the attendance sheet had, moved
 * from form controls to selection.
 *
 * So the ids live in a small store and each checkbox subscribes to *only its own*
 * id through `useSyncExternalStore`. React compares the snapshot it gets back and
 * skips the rows whose state did not change, which makes the cost of a tick
 * proportional to the rows that actually moved rather than to the size of the
 * table. The provider itself never re-renders on a tick, so the rows rendered on
 * the server are left alone.
 */
type SelectionStore = {
  setIds: (ids: string[]) => void;
  subscribe: (listener: () => void) => () => void;
  getVersion: () => number;
  isSelected: (id: string) => boolean;
  isAllSelected: () => boolean;
  isSomeSelected: () => boolean;
  selectedIds: () => string[];
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
};

function createSelectionStore(): SelectionStore {
  let ids: string[] = [];
  let selected = new Set<string>();
  let version = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  return {
    setIds(next) {
      // Compared by content: a server re-render hands over a new array holding the
      // same ids, and that must not drop the ticks or notify anybody.
      if (next.length === ids.length && next.every((id, index) => id === ids[index])) return;

      const available = new Set(next);
      let pruned: Set<string> | null = null;
      for (const id of selected) {
        if (available.has(id)) continue;
        (pruned ??= new Set(selected)).delete(id);
      }

      ids = next;
      if (pruned) selected = pruned;
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getVersion: () => version,

    isSelected: (id) => selected.has(id),
    isAllSelected: () => ids.length > 0 && selected.size === ids.length,
    isSomeSelected: () => selected.size > 0 && selected.size < ids.length,
    selectedIds: () => [...selected],

    toggle(id) {
      const next = new Set(selected);
      if (!next.delete(id)) next.add(id);
      selected = next;
      emit();
    },

    toggleAll() {
      selected = selected.size === ids.length ? new Set() : new Set(ids);
      emit();
    },

    clear() {
      if (selected.size === 0) return;
      selected = new Set();
      emit();
    },
  };
}

const SelectionStoreContext = createContext<SelectionStore | null>(null);

function useStore(): SelectionStore {
  const store = useContext(SelectionStoreContext);
  if (!store) throw new Error("row selection must be used inside TableSelectionProvider");
  return store;
}

/**
 * `ids` must be the ids of the rows currently rendered, in display order.
 *
 * Ids are pruned whenever that list changes, so ticking rows and then paging or
 * filtering can never leave a bulk action pointing at rows that are no longer on
 * screen. That is why the provider is given the visible ids rather than the full
 * page's worth of data.
 */
export function TableSelectionProvider({
  children,
  ids,
}: {
  children: React.ReactNode;
  ids: string[];
}) {
  // Built once per provider instance so its identity — and therefore every
  // subscription — survives the re-renders that follow a tick.
  const [store] = useState(createSelectionStore);
  const [synced, setSynced] = useState<string[]>([]);

  // Synced during render rather than in an effect: doing it in an effect would
  // leave one paint in which the table lists rows the bar does not know about.
  if (ids.length !== synced.length || ids.some((id, index) => id !== synced[index])) {
    store.setIds(ids);
    setSynced(ids);
  }

  return (
    <SelectionStoreContext.Provider value={store}>{children}</SelectionStoreContext.Provider>
  );
}

/**
 * The selection controls a bulk action needs: which ids are ticked, the counts,
 * and the three commands.
 *
 * It subscribes to the whole store rather than a single row, because a bulk
 * action is a single component — one subscriber no matter how many rows exist.
 */
export function useTableSelection() {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

  return useMemo(
    () => ({
      selectedIds: store.selectedIds(),
      isSelected: store.isSelected,
      allSelected: store.isAllSelected(),
      someSelected: store.isSomeSelected(),
      toggle: store.toggle,
      toggleAll: store.toggleAll,
      clear: store.clear,
    }),
    // The version is the real dependency: it changes on every mutation, which is
    // exactly when the derived values above are re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, store.getVersion()],
  );
}

/**
 * The selected rows as full objects, in the order they were ticked.
 *
 * The store only holds identifiers, because a shared store cannot be typed per
 * table without casting. A bulk action that needs more than an id — a name to
 * confirm a deletion with, a question to preview — passes its own rows here and
 * gets them back, keeping the type of whatever the table is listing.
 */
export function useSelectedRows<T>(rows: T[], getId: (row: T) => string): T[] {
  const { selectedIds } = useTableSelection();

  const rowsById = useMemo(() => {
    const map = new Map<string, T>();
    for (const row of rows) map.set(getId(row), row);
    return map;
  }, [getId, rows]);

  return useMemo(
    () =>
      selectedIds
        .map((id) => rowsById.get(id))
        .filter((row): row is T => row !== undefined),
    [selectedIds, rowsById],
  );
}

/**
 * One row's checkbox.
 *
 * It watches its own id and nothing else, so ticking one row in a table of two
 * thousand re-renders one checkbox instead of two thousand.
 */
export function RowSelectCheckbox({ id, label }: { id: string; label: string }) {
  const store = useStore();
  const selected = useSyncExternalStore(
    store.subscribe,
    () => store.isSelected(id),
    () => store.isSelected(id),
  );

  return (
    <input
      aria-label={label}
      checked={selected}
      className="size-4 cursor-pointer accent-brand-600"
      onChange={() => store.toggle(id)}
      type="checkbox"
    />
  );
}

/**
 * Header checkbox for the selection column.
 *
 * React has no `indeterminate` prop, so the half-selected state — some rows
 * ticked, which is the state a "select part of the table" workflow spends most of
 * its time in — is set on the DOM node through a ref.
 */
export function SelectAllRowsCheckbox({ label }: { label: string }) {
  const { allSelected, someSelected, toggleAll } = useTableSelection();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !allSelected && someSelected;
  }, [allSelected, someSelected]);

  return (
    <input
      aria-label={label}
      checked={allSelected}
      className="size-4 cursor-pointer accent-brand-600"
      onChange={toggleAll}
      ref={ref}
      type="checkbox"
    />
  );
}

/**
 * The floating bar that appears once rows are ticked.
 *
 * It is the same bar everywhere, so its position, the count wording and the two
 * selection controls never move between tables. `noun` is the singular noun used in
 * "تم تحديد ٣ طلاب", with `nounPlural` for nouns whose plural reads differently.
 * `notice` lets a table surface a caveat such as a truncated scan.
 */
export function SelectionBar({
  children,
  disabled = false,
  noun,
  nounPlural,
  notice,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  noun: string;
  nounPlural?: string;
  notice?: React.ReactNode;
}) {
  const { allSelected, clear, selectedIds, toggleAll } = useTableSelection();

  if (selectedIds.length === 0) return null;

  const label = `${formatNumber(selectedIds.length)} ${nounPlural ?? noun}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--glass-border-strong)] bg-[var(--glass-bg-strong)] px-4 py-3 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-bold text-[var(--app-text)]">تم تحديد {label}</p>
          {notice}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={disabled} onClick={toggleAll} size="sm" type="button" variant="ghost">
            <CheckCheck aria-hidden className="size-4" />
            {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
          </Button>

          {children}

          <Button disabled={disabled} onClick={clear} size="sm" type="button" variant="ghost">
            <X aria-hidden className="size-4" />
            إلغاء التحديد
          </Button>
        </div>
      </div>
    </div>
  );
}