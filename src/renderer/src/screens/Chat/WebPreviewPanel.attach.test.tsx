import { fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import { WebPreviewPanel } from "./WebPreviewPanel";

beforeEach(() => {
  localStorage.clear();
});

it("offers the open-in-tab action with the active page", () => {
  const onOpenInTab = vi.fn();
  const { container } = render(
    <I18nProvider>
      <WebPreviewPanel
        initialUrl="https://attach.test/page"
        onClose={() => undefined}
        onOpenInTab={onOpenInTab}
        embedded
      />
    </I18nProvider>,
  );
  const button = container.querySelector<HTMLElement>(
    '[aria-label="Open preview in a tab"]',
  );
  expect(button).not.toBeNull();
  fireEvent.click(button!);
  expect(onOpenInTab).toHaveBeenCalledWith("https://attach.test/page");
});

it("hides the action when the host does not attach tabs", () => {
  const { container } = render(
    <I18nProvider>
      <WebPreviewPanel
        initialUrl="https://attach.test/page"
        onClose={() => undefined}
        embedded
      />
    </I18nProvider>,
  );
  expect(container.querySelector('[aria-label="Open preview in a tab"]')).toBeNull();
});

it("opens a page the host points an already-mounted panel at", () => {
  const view = render(
    <I18nProvider>
      <WebPreviewPanel
        initialUrl="https://one.test"
        onClose={() => undefined}
        embedded
      />
    </I18nProvider>,
  );
  expect(view.container.querySelectorAll(".web-preview-tab-view")).toHaveLength(1);

  view.rerender(
    <I18nProvider>
      <WebPreviewPanel
        initialUrl="https://two.test"
        onClose={() => undefined}
        embedded
      />
    </I18nProvider>,
  );
  const views = [...view.container.querySelectorAll<HTMLElement>(".web-preview-tab-view")];
  expect(views).toHaveLength(2);
  const visible = views.filter((el) => !el.hasAttribute("hidden"));
  expect(visible).toHaveLength(1);
  expect(visible[0]).toBe(views[1]);
});
