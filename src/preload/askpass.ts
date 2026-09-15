import { ipcRenderer } from "electron";
// ponytail: keep sandbox preloads self-contained; shared imports emit unsupported require(chunk).
const ASKPASS_SUBMIT_CHANNEL = "askpass-submit";
const APPROVAL_SUBMIT_CHANNEL = "approval-submit";

function submitAskpass(value: string | null): void {
  ipcRenderer.send(ASKPASS_SUBMIT_CHANNEL, value);
}

function submitApproval(choice: string): void {
  ipcRenderer.send(APPROVAL_SUBMIT_CHANNEL, choice);
}

function attach(): void {
  const passwordInput = document.getElementById(
    "pw",
  ) as HTMLInputElement | null;
  const okButton = document.getElementById("ok");
  const cancelButton = document.getElementById("cancel");

  if (passwordInput && okButton && cancelButton) {
    okButton.addEventListener("click", () => submitAskpass(passwordInput.value));
    cancelButton.addEventListener("click", () => submitAskpass(null));
    passwordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitAskpass(passwordInput.value);
      if (event.key === "Escape") submitAskpass(null);
    });
    passwordInput.focus();
    return;
  }

  const root = document.getElementById("approval-actions");
  const fallback = document.getElementById("approval-deny");

  if (root) {
    root.querySelectorAll<HTMLButtonElement>("button[data-choice]").forEach((button) => {
      button.addEventListener("click", () => submitApproval(button.dataset.choice || "deny"));
    });
  }
  if (fallback) {
    fallback.addEventListener("click", () => submitApproval("deny"));
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      submitApproval("deny");
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", attach);
} else {
  attach();
}
