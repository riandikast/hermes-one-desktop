import { ipcRenderer } from "electron";
import { APPROVAL_SUBMIT_CHANNEL } from "../shared/askpass";

function submit(choice: string): void {
  ipcRenderer.send(APPROVAL_SUBMIT_CHANNEL, choice);
}

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("approval-actions");
  const fallback = document.getElementById("approval-deny");
  if (!root || !fallback) {
    submit("deny");
    return;
  }

  root.querySelectorAll<HTMLButtonElement>("button[data-choice]").forEach((button) => {
    button.addEventListener("click", () => submit(button.dataset.choice || "deny"));
  });
  fallback.addEventListener("click", () => submit("deny"));
  fallback.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      submit("deny");
    }
  });
});
