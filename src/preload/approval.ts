import { ipcRenderer } from "electron";
import { APPROVAL_SUBMIT_CHANNEL } from "../shared/askpass";

function submit(choice: string): void {
  ipcRenderer.send(APPROVAL_SUBMIT_CHANNEL, choice);
}

function attach(): void {
  const root = document.getElementById("approval-actions");
  const fallback = document.getElementById("approval-deny");

  if (root) {
    root.querySelectorAll<HTMLButtonElement>("button[data-choice]").forEach((button) => {
      button.addEventListener("click", () => submit(button.dataset.choice || "deny"));
    });
  }
  if (fallback) {
    fallback.addEventListener("click", () => submit("deny"));
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      submit("deny");
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", attach);
} else {
  attach();
}
