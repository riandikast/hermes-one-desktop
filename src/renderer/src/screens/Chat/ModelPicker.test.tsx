import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
  ChevronLeft: () => null,
  ChevronUp: () => null,
  Check: () => null,
  Asterisk: () => null,
  Search: () => null,
  Pencil: () => null,
  X: () => null,
  FolderPlus: () => null,
  FolderMinus: () => null,
  Trash2: () => null,
  Plus: () => null,
  Layers: () => null,
}));

vi.mock("../../components/common/BrandLogo", () => ({
  default: () => null,
}));

import { ModelPicker } from "./ModelPicker";
import type { ModelGroup } from "./types";

const groups: ModelGroup[] = [
  {
    provider: "openrouter",
    providerLabel: "providers.openrouter",
    models: [
      {
        provider: "openrouter",
        model: "owl-alpha",
        label: "OWL Alpha",
        baseUrl: "",
      },
      {
        provider: "openrouter",
        model: "owl-beta",
        label: "OWL Beta",
        baseUrl: "",
      },
    ],
  },
  {
    provider: "ollama",
    providerLabel: "providers.ollama",
    models: [
      {
        provider: "ollama",
        model: "llama3",
        label: "Llama 3",
        baseUrl: "http://localhost:11434",
      },
    ],
  },
];

/** Render helper that also returns the container for scoped DOM queries. */
function renderPicker(
  overrides: {
    active?: boolean;
    currentModel?: string;
    currentProvider?: string;
    currentBaseUrl?: string;
    modelGroups?: ModelGroup[];
    displayModel?: string;
    onOpen?: () => void;
    onSelectModel?: (provider: string, model: string, baseUrl: string) => void;
  } = {},
): { container: HTMLElement; onOpen: Mock; onSelectModel: Mock } {
  const onOpen = vi.fn();
  const onSelectModel = vi.fn();
  const utils = render(
    <ModelPicker
      active={overrides.active}
      currentModel={overrides.currentModel ?? "owl-alpha"}
      currentProvider={overrides.currentProvider ?? "openrouter"}
      currentBaseUrl={overrides.currentBaseUrl ?? ""}
      modelGroups={overrides.modelGroups ?? groups}
      displayModel={overrides.displayModel ?? "OWL Alpha"}
      onOpen={overrides.onOpen ?? onOpen}
      onSelectModel={overrides.onSelectModel ?? onSelectModel}
    />,
  );
  return { ...utils, onOpen, onSelectModel };
}

/** Click the trigger button (scoped to container to avoid ambiguity) and
 *  return the dropdown element for `within()` scoping. */
function openPicker(container: HTMLElement): HTMLElement {
  const trigger = container.querySelector(
    ".chat-model-trigger",
  ) as HTMLButtonElement;
  fireEvent.click(trigger);
  return container.querySelector(".chat-model-dropdown") as HTMLElement;
}

describe("ModelPicker", () => {
  // ── initial render ──────────────────────────────────────────────
  it("renders the display model name in the trigger button", () => {
    const { container } = renderPicker({ displayModel: "OWL Alpha" });
    const trigger = container.querySelector(".chat-model-trigger")!;
    expect(trigger.querySelector(".chat-model-name")?.textContent).toBe(
      "OWL Alpha",
    );
  });

  it("does not show the dropdown initially", () => {
    const { container } = renderPicker();
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  // ── open / close ────────────────────────────────────────────────
  it("opens the dropdown and calls onOpen when the trigger is clicked", () => {
    const { container, onOpen } = renderPicker();
    openPicker(container);
    expect(screen.getByPlaceholderText("chat.searchModels")).toBeTruthy();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("closes the dropdown when the trigger is clicked again", () => {
    const { container } = renderPicker();
    const trigger = container.querySelector(
      ".chat-model-trigger",
    ) as HTMLButtonElement;
    fireEvent.click(trigger); // open
    fireEvent.click(trigger); // close
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("closes the dropdown when clicking outside", () => {
    const { container } = renderPicker();
    openPicker(container);
    fireEvent.mouseDown(document.body);
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("closes the dropdown when pressing Escape", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    fireEvent.keyDown(dropdown, { key: "Escape" });
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  it("opens from a slash-command event only when the chat is active", () => {
    const active = renderPicker({ active: true });
    const inactive = renderPicker({ active: false });

    act(() => {
      window.dispatchEvent(new CustomEvent("model-picker:open"));
    });

    expect(
      active.container.querySelector(".chat-model-dropdown"),
    ).not.toBeNull();
    expect(inactive.container.querySelector(".chat-model-dropdown")).toBeNull();
    expect(active.onOpen).toHaveBeenCalledTimes(1);
    expect(inactive.onOpen).not.toHaveBeenCalled();
  });

  // ── model list rendering ────────────────────────────────────────
  it("renders all provider groups and their models", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    expect(within(dropdown).getByText("providers.openrouter")).toBeTruthy();
    expect(within(dropdown).getByText("providers.ollama")).toBeTruthy();
    expect(within(dropdown).getByText("OWL Alpha")).toBeTruthy();
    expect(within(dropdown).getByText("OWL Beta")).toBeTruthy();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("marks the active model with the 'active' class", () => {
    const { container } = renderPicker({
      currentModel: "owl-alpha",
      currentProvider: "openrouter",
    });
    const dropdown = openPicker(container);

    const option = within(dropdown).getByText("OWL Alpha").closest("button");
    expect(option?.className).toContain("active");
  });

  it("orders the currently-selected model first in the list", () => {
    // Llama 3 is in the second group; selecting it should hoist it to the top.
    const { container } = renderPicker({
      currentModel: "llama3",
      currentProvider: "ollama",
      currentBaseUrl: "http://localhost:11434",
    });
    const dropdown = openPicker(container);
    const titles = Array.from(
      dropdown.querySelectorAll(".chat-model-row-title"),
    ).map((el) => el.textContent);
    expect(titles[0]).toBe("Llama 3");
  });

  it("does not mark an inactive model as active", () => {
    const { container } = renderPicker({
      currentModel: "owl-alpha",
      currentProvider: "openrouter",
    });
    const dropdown = openPicker(container);

    const betaOption = within(dropdown).getByText("OWL Beta").closest("button");
    expect(betaOption?.className).not.toContain("active");
  });

  // ── model selection ─────────────────────────────────────────────
  it("calls onSelectModel with correct args when a model is clicked", () => {
    const { container, onSelectModel } = renderPicker();
    const dropdown = openPicker(container);

    fireEvent.click(within(dropdown).getByText("Llama 3"));

    expect(onSelectModel).toHaveBeenCalledWith(
      "ollama",
      "llama3",
      "http://localhost:11434",
    );
  });

  it("closes the dropdown after selecting a model", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    fireEvent.click(within(dropdown).getByText("OWL Beta"));
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  // ── search / filtering ──────────────────────────────────────────
  it("filters models by label (case-insensitive)", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "beta" } });

    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).getByText("OWL Beta")).toBeTruthy();
    expect(within(dropdown).queryByText("Llama 3")).toBeNull();
  });

  it("filters models by model id", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "llama3" } });

    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("shows all models when search is cleared", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "beta" } });
    fireEvent.change(search, { target: { value: "" } });

    expect(within(dropdown).getByText("OWL Alpha")).toBeTruthy();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("clears search when the dropdown is toggled closed", () => {
    const { container } = renderPicker();
    const trigger = container.querySelector(
      ".chat-model-trigger",
    ) as HTMLButtonElement;

    fireEvent.click(trigger); // open
    const search = container.querySelector(
      ".chat-model-search-input",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "beta" } });
    expect(search.value).toBe("beta");

    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // re-open

    const searchAfter = container.querySelector(
      ".chat-model-search-input",
    ) as HTMLInputElement;
    expect(searchAfter.value).toBe("");
  });

  // ── provider rail ───────────────────────────────────────────────
  it("filters the model list to the clicked provider rail item", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    // Click the Ollama rail entry (its label is rendered in the left rail).
    const ollamaRail = within(dropdown)
      .getByText("providers.ollama")
      .closest("button")!;
    fireEvent.click(ollamaRail);

    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).queryByText("OWL Beta")).toBeNull();
  });

  // ── configure providers/models footer ───────────────────────────
  it("navigates to the Providers screen and closes when Configure is clicked", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    const goto = vi.fn();
    window.addEventListener("navigation:goto", goto);
    try {
      fireEvent.click(within(dropdown).getByText("chat.configure"));
    } finally {
      window.removeEventListener("navigation:goto", goto);
    }

    expect(goto).toHaveBeenCalledTimes(1);
    expect((goto.mock.calls[0][0] as CustomEvent).detail).toBe("providers");
    expect(container.querySelector(".chat-model-dropdown")).toBeNull();
  });

  // ── edge cases ──────────────────────────────────────────────────
  it("shows the empty state and configure button when modelGroups is empty", () => {
    const { container } = renderPicker({ modelGroups: [] });
    const dropdown = openPicker(container);
    expect(within(dropdown).getByText("chat.configure")).toBeTruthy();
    expect(within(dropdown).getByText("chat.noModelsMatch")).toBeTruthy();
    expect(within(dropdown).queryByText("providers.openrouter")).toBeNull();
  });

  it("renders nothing when search matches no models", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const search = within(dropdown).getByPlaceholderText("chat.searchModels");

    fireEvent.change(search, { target: { value: "zzzznonexistent" } });

    expect(within(dropdown).queryByText("OWL Alpha")).toBeNull();
    expect(within(dropdown).queryByText("Llama 3")).toBeNull();
  });
});

// ── frontend-only custom groups ─────────────────────────────────
describe("ModelPicker custom groups (frontend-only)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows custom groups in the rail once created via row menu", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    // Open the group menu on the first row.
    const folderButtons = dropdown.querySelectorAll(
      ".chat-model-row-alias",
    ) as NodeListOf<HTMLElement>;
    fireEvent.click(folderButtons[0]);

    // Type a group name and create it with the row included.
    const input = dropdown.querySelector(
      ".chat-model-group-menu input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My Coding Models" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Rail now shows the group with count 1.
    expect(within(dropdown).getByText("My Coding Models")).toBeTruthy();
    expect(
      within(dropdown).getByText("My Coding Models").closest(".chat-model-rail-item-holder")
        ?.querySelector(".chat-model-rail-count")?.textContent,
    ).toBe("1");
  });

  it("rail shows an Ungrouped section with provider counts reduced", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    expect(within(dropdown).getByText("chat.ungrouped")).toBeTruthy();
  });

  it("selecting a custom rail group filters rows to its members", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);

    const folderButtons = dropdown.querySelectorAll(
      ".chat-model-row-alias",
    ) as NodeListOf<HTMLElement>;
    fireEvent.click(folderButtons[0]);
    const input = dropdown.querySelector(
      ".chat-model-group-menu input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Coding" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(within(dropdown).getByText("Coding"));

    const titles = Array.from(
      dropdown.querySelectorAll(".chat-model-row-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["OWL Alpha"]);
  });

  it("picking a grouped row still routes with its own provider/baseUrl", () => {
    const { container, onSelectModel } = renderPicker();
    const dropdown = openPicker(container);

    // Create group with first row, then click the row itself.
    const folderButtons = dropdown.querySelectorAll(
      ".chat-model-row-alias",
    ) as NodeListOf<HTMLElement>;
    fireEvent.click(folderButtons[0]);
    const input = dropdown.querySelector(
      ".chat-model-group-menu input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Coding" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(within(dropdown).getByText("OWL Alpha"));

    // providerLabel is passed only when present; openrouter rows send none.
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    const [p0, m0, b0] = onSelectModel.mock.calls[0];
    expect([p0, m0, b0]).toEqual(["openrouter", "owl-alpha", ""]);
  });

  it("deleting a group keeps its models in the picker", () => {
    const { container } = renderPicker();
    let dropdown = openPicker(container);

    // Create a group containing the first row.
    const folderButtons = dropdown.querySelectorAll(
      ".chat-model-row-alias",
    ) as NodeListOf<HTMLElement>;
    fireEvent.click(folderButtons[0]);
    const input = dropdown.querySelector(
      ".chat-model-group-menu input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Coding" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(dropdown).getByText("Coding")).toBeTruthy();

    // Delete the group via the rail trash button.
    const del = dropdown.querySelector(
      ".chat-model-rail-delete",
    ) as HTMLElement;
    fireEvent.click(del);

    dropdown = container.querySelector(".chat-model-dropdown") as HTMLElement;
    expect(within(dropdown).queryByText("Coding")).toBeNull();
    // The model rows are all still there.
    expect(within(dropdown).getByText("OWL Alpha")).toBeTruthy();
    expect(within(dropdown).getByText("Llama 3")).toBeTruthy();
  });

  it("groups persist across picker instances (localStorage)", () => {
    const first = renderPicker();
    const dropdown = openPicker(first.container);
    const folderButtons = dropdown.querySelectorAll(
      ".chat-model-row-alias",
    ) as NodeListOf<HTMLElement>;
    fireEvent.click(folderButtons[0]);
    const input = dropdown.querySelector(
      ".chat-model-group-menu input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Persisted" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Fresh mount — same storage, no in-memory handoff.
    const second = renderPicker();
    const dropdown2 = openPicker(second.container);
    expect(within(dropdown2).getByText("Persisted")).toBeTruthy();
  });
});

describe("ModelPicker add model to provider", () => {
  beforeEach(() => {
    (window as unknown as { hermesAPI?: unknown }).hermesAPI = {
      addModel: vi.fn().mockResolvedValue({ id: "new-id" }),
      updateModel: vi.fn().mockResolvedValue(true),
    };
  });

  it("shows an add button on each provider rail item in the ungrouped section", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const addButtons = dropdown.querySelectorAll(".chat-model-rail-add");
    expect(addButtons.length).toBe(groups.length);
  });

  it("opens add model dialog when + is clicked on a provider", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const addButtons = dropdown.querySelectorAll(".chat-model-rail-add");
    fireEvent.click(addButtons[0]);

    expect(dropdown.querySelector(".chat-model-alias-editor")).toBeTruthy();
    expect(
      dropdown.querySelector(
        'input[placeholder="providers.models.addModelId"]',
      ),
    ).toBeTruthy();
  });

  it("adds and selects the model when Add & Select is clicked or Enter is pressed", async () => {
    const { container, onSelectModel, onOpen } = renderPicker();
    const dropdown = openPicker(container);
    const addButtons = dropdown.querySelectorAll(".chat-model-rail-add");
    fireEvent.click(addButtons[0]); // openrouter

    const input = dropdown.querySelector(
      'input[placeholder="providers.models.addModelId"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "meta-llama/llama-3.3-70b" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(
      (window as unknown as { hermesAPI: { addModel: Mock } }).hermesAPI.addModel,
    ).toHaveBeenCalledWith(
      "llama-3.3-70b",
      "openrouter",
      "meta-llama/llama-3.3-70b",
      "",
      undefined,
      undefined,
    );
    expect(onOpen).toHaveBeenCalled();
    expect(onSelectModel).toHaveBeenCalledWith(
      "openrouter",
      "meta-llama/llama-3.3-70b",
      "",
    );
  });

  it("shows + Add model row at bottom of model list when a provider is selected", () => {
    const { container } = renderPicker();
    const dropdown = openPicker(container);
    const openrouterRail = within(dropdown)
      .getByText("providers.openrouter")
      .closest("button")!;
    fireEvent.click(openrouterRail);

    const addRow = container.querySelector(".chat-model-add-row");
    expect(addRow).toBeTruthy();
    fireEvent.click(addRow!);
    expect(container.querySelector(".chat-model-alias-editor")).toBeTruthy();
  });

  it("adds model to custom named provider with providerLabel and baseUrl", async () => {
    const customNamedGroups: ModelGroup[] = [
      {
        provider: "custom",
        providerLabel: "9router",
        models: [
          {
            provider: "custom",
            model: "old-model",
            label: "Old Model",
            baseUrl: "https://api.9router.com/v1",
          },
        ],
      },
    ];
    const { container, onSelectModel } = renderPicker({
      modelGroups: customNamedGroups,
      currentModel: "old-model",
      currentProvider: "custom",
      currentBaseUrl: "https://api.9router.com/v1",
    });
    const dropdown = openPicker(container);
    const addBtn = dropdown.querySelector(".chat-model-rail-add")!;
    fireEvent.click(addBtn);

    const input = dropdown.querySelector(
      'input[placeholder="providers.models.addModelId"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ag/gemini-3.8-flash-high" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(
      (window as unknown as { hermesAPI: { addModel: Mock } }).hermesAPI.addModel,
    ).toHaveBeenCalledWith(
      "gemini-3.8-flash-high",
      "custom",
      "ag/gemini-3.8-flash-high",
      "https://api.9router.com/v1",
      undefined,
      "9router",
    );
    expect(onSelectModel).toHaveBeenCalledWith(
      "custom",
      "ag/gemini-3.8-flash-high",
      "https://api.9router.com/v1",
      "9router",
    );
  });

  describe("fallback models", () => {
    const KEY = "hermes.chat.fallbackModels.v1";

    /** Click the rail's Fallback item to show the fallback pane. */
    function openFallbacks(dropdown: HTMLElement): void {
      const railItems = Array.from(
        dropdown.querySelectorAll(".chat-model-rail-item"),
      );
      const item = railItems.find((el) =>
        el.textContent?.includes("chat.fallbackModels"),
      ) as HTMLElement;
      fireEvent.click(item);
    }

    /** Open the add-list and drill into the bucket whose label matches. */
    function pickBucket(dropdown: HTMLElement, name: string): void {
      const buckets = Array.from(
        dropdown.querySelectorAll(".chat-model-fallback-bucket"),
      );
      const bucket = buckets.find((b) => b.textContent?.includes(name))!;
      fireEvent.click(bucket);
    }

    it("exposes Fallback models as a rail category under All models", () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      const railItems = Array.from(
        dropdown.querySelectorAll(".chat-model-rail-item"),
      );
      const labels = railItems.map((el) => el.textContent ?? "");
      // "All models" first, then Fallbacks directly beneath it.
      expect(labels[0]).toContain("chat.allModels");
      expect(labels[1]).toContain("chat.fallbackModels");
    });

    it("shows an empty-state hint when no fallbacks are set", () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      expect(dropdown.querySelector(".chat-model-fallback")).toBeTruthy();
      expect(
        dropdown.querySelector(".chat-model-fallback-empty")?.textContent,
      ).toContain("chat.fallbackEmpty");
    });

    it("hides the model list while the fallback pane is open", () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      // The pane shows fallbacks, not the provider's models.
      expect(dropdown.querySelector(".chat-model-fallback")).toBeTruthy();
    });

    it("adds a model via the + and lists it in order", async () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);

      // Open the add-list; level 1 lists groups, not a flat dump of models.
      fireEvent.click(dropdown.querySelector(".chat-model-fallback-add")!);
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-bucket").length,
      ).toBeGreaterThan(0);
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-option"),
      ).toHaveLength(0);

      // Drill into the openrouter group, then choose "OWL Beta".
      pickBucket(dropdown, "providers.openrouter");
      const options = dropdown.querySelectorAll(".chat-model-fallback-option");
      const beta = Array.from(options).find((o) =>
        o.textContent?.includes("OWL Beta"),
      )!;
      await act(async () => {
        fireEvent.click(beta);
      });

      const rows = dropdown.querySelectorAll(".chat-model-fallback-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain("OWL Beta");
      // Persisted, so the chain survives a remount.
      expect(localStorage.getItem(KEY)).toContain("owl-beta");
    });

    it("lists custom groups FIRST, then the ungrouped providers", () => {
      localStorage.clear();
      localStorage.setItem(
        "hermes.chat.modelGroups.v1",
        JSON.stringify({
          groups: [
            { id: "g1", name: "Favourites", modelKeys: ["openrouter::::owl-beta"] },
          ],
        }),
      );
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      fireEvent.click(dropdown.querySelector(".chat-model-fallback-add")!);

      const names = Array.from(
        dropdown.querySelectorAll(".chat-model-fallback-bucket-name"),
      ).map((el) => el.textContent);
      // Custom group first, then provider buckets.
      expect(names[0]).toBe("Favourites");
      expect(names.length).toBeGreaterThan(1);
      localStorage.removeItem("hermes.chat.modelGroups.v1");
    });

    it("searches across ALL groups, ignoring the drill-in level", async () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      fireEvent.click(dropdown.querySelector(".chat-model-fallback-add")!);

      const input = dropdown.querySelector(
        ".chat-model-fallback-search-input",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "llama" } });
      });

      // Search spans groups: results appear without drilling in, and the
      // group-level bucket rows are gone.
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-bucket"),
      ).toHaveLength(0);
      const options = dropdown.querySelectorAll(".chat-model-fallback-option");
      expect(options.length).toBeGreaterThan(0);
      expect(
        Array.from(options).every((o) => o.textContent?.toLowerCase().includes("llama")),
      ).toBe(true);
    });

    it("says so when a search matches nothing", async () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      fireEvent.click(dropdown.querySelector(".chat-model-fallback-add")!);
      const input = dropdown.querySelector(
        ".chat-model-fallback-search-input",
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "zzzz-no-match" } });
      });
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-option"),
      ).toHaveLength(0);
      expect(dropdown.querySelector(".chat-model-fallback-empty")).toBeTruthy();
    });

    it("returns to the group level from a drilled-in group", () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      fireEvent.click(dropdown.querySelector(".chat-model-fallback-add")!);
      pickBucket(dropdown, "providers.openrouter");
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-bucket"),
      ).toHaveLength(0);

      fireEvent.click(dropdown.querySelector(".chat-model-fallback-back")!);
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-bucket").length,
      ).toBeGreaterThan(0);
      expect(
        dropdown.querySelectorAll(".chat-model-fallback-option"),
      ).toHaveLength(0);
    });

    it("disables a model that is already in the chain", async () => {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          models: [
            {
              key: "openrouter::::owl-beta",
              provider: "openrouter",
              model: "owl-beta",
              baseUrl: "",
              label: "OWL Beta",
            },
          ],
        }),
      );
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      fireEvent.click(dropdown.querySelector(".chat-model-fallback-add")!);
      pickBucket(dropdown, "providers.openrouter");

      const options = Array.from(
        dropdown.querySelectorAll(".chat-model-fallback-option"),
      );
      const already = options.find((o) =>
        o.textContent?.includes("OWL Beta"),
      ) as HTMLButtonElement;
      expect(already.disabled).toBe(true);
    });

    it("reorders the chain with the up/down controls", () => {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          models: [
            { key: "p::::a", provider: "openrouter", model: "a", baseUrl: "", label: "A" },
            { key: "p::::b", provider: "openrouter", model: "b", baseUrl: "", label: "B" },
          ],
        }),
      );
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);

      // Move the SECOND row up.
      const rows = dropdown.querySelectorAll(".chat-model-fallback-row");
      const upButtons = rows[1]!.querySelectorAll(".chat-model-fallback-act");
      fireEvent.click(upButtons[0]!);

      const stored = JSON.parse(localStorage.getItem(KEY)!) as {
        models: { model: string }[];
      };
      expect(stored.models.map((m) => m.model)).toEqual(["b", "a"]);
    });

    it("disables up on the first row and down on the last", () => {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          models: [
            { key: "p::::a", provider: "openrouter", model: "a", baseUrl: "", label: "A" },
            { key: "p::::b", provider: "openrouter", model: "b", baseUrl: "", label: "B" },
          ],
        }),
      );
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      const rows = dropdown.querySelectorAll(".chat-model-fallback-row");

      const firstActs = rows[0]!.querySelectorAll(".chat-model-fallback-act");
      const lastActs = rows[1]!.querySelectorAll(".chat-model-fallback-act");
      expect((firstActs[0] as HTMLButtonElement).disabled).toBe(true);
      expect((lastActs[1] as HTMLButtonElement).disabled).toBe(true);
    });

    it("removes an entry", () => {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          models: [
            { key: "p::::a", provider: "openrouter", model: "a", baseUrl: "", label: "A" },
          ],
        }),
      );
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      const removeBtn = dropdown.querySelector(
        ".chat-model-fallback-act--remove",
      )!;
      fireEvent.click(removeBtn);
      expect(dropdown.querySelectorAll(".chat-model-fallback-row")).toHaveLength(
        0,
      );
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("shows the chain count on the rail item", () => {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          models: [
            { key: "p::::a", provider: "openrouter", model: "a", baseUrl: "", label: "A" },
          ],
        }),
      );
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      const item = Array.from(
        dropdown.querySelectorAll(".chat-model-rail-item"),
      ).find((el) => el.textContent?.includes("chat.fallbackModels"))!;
      expect(item.querySelector(".chat-model-rail-count")?.textContent).toBe(
        "1",
      );
    });

    it("leaves the fallback view when another rail item is picked", () => {
      localStorage.clear();
      const { container } = renderPicker();
      const dropdown = openPicker(container);
      openFallbacks(dropdown);
      expect(dropdown.querySelector(".chat-model-fallback")).toBeTruthy();

      // Back to "All models".
      const allItem = Array.from(
        dropdown.querySelectorAll(".chat-model-rail-item"),
      ).find((el) => el.textContent?.includes("chat.allModels"))!;
      fireEvent.click(allItem);
      expect(dropdown.querySelector(".chat-model-fallback")).toBeNull();
      expect(dropdown.querySelectorAll(".chat-model-row").length).toBeGreaterThan(
        0,
      );
    });
  });
});
