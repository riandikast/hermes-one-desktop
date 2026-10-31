let pending = false;

/** In-page confirmation avoids Electron's native-dialog focus loss on Windows. */
export function appConfirm(message: string): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  pending = true;
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "app-confirm";
    dialog.setAttribute("aria-label", "Confirm action");
    const description = document.createElement("p");
    description.textContent = message;
    description.id = "app-confirm-description";
    dialog.setAttribute("aria-describedby", description.id);
    const actions = document.createElement("div");
    actions.className = "app-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn-ghost btn-sm";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn-secondary btn-sm";
    confirm.textContent = "Confirm";
    actions.append(cancel, confirm);
    dialog.append(description, actions);
    let settled = false;
    const observer = new MutationObserver(() => { if (!dialog.isConnected) finish(false); });
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.removeEventListener("pagehide", deny);
      window.removeEventListener("keydown", escape, true);
      dialog.remove();
      pending = false;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      resolve(accepted);
    };
    const deny = (): void => finish(false);
    cancel.addEventListener("click", deny);
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener("close", deny);
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(false); }
    };
    window.addEventListener("keydown", escape, true);
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish(false);
    });
    // Stay within an existing Radix focus scope; native top-layer handles stacking.
    const modals = document.querySelectorAll('[role="dialog"][data-state="open"]');
    const owner = previous instanceof Element ? previous.closest(".source-control-page") : null;
    (modals.item(modals.length - 1) ?? owner ?? document.body).append(dialog);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pagehide", deny, { once: true });
    try { dialog.showModal(); cancel.focus(); }
    catch { finish(false); }
  });
}
