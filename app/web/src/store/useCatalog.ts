import { create } from "zustand";
import { getJson } from "../api/client";
import type { FeatureCatalog, ScenarioCatalog } from "../types";

interface CatalogState {
  sets: string[];
  set: string;
  features: FeatureCatalog | null;
  scenarios: ScenarioCatalog | null;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  load: (set?: string) => Promise<void>;
  select: (id: string | null) => void;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  sets: [],
  set: "basic",
  features: null,
  scenarios: null,
  selectedId: null,
  loading: false,
  error: null,
  load: async (s) => {
    const name = s ?? get().set;
    set({ loading: true, error: null });
    try {
      const data = await getJson<{
        features: FeatureCatalog;
        scenarios: ScenarioCatalog;
        sets: string[];
      }>(`/api/scenarios?set=${encodeURIComponent(name)}`);
      set({ sets: data.sets, set: name, features: data.features, scenarios: data.scenarios, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  select: (id) => set({ selectedId: id }),
}));
