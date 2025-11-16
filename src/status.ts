const errorSpan = document.querySelector<HTMLSpanElement>("#bb-error");

function setStatus(message: string | null, kind: "error" | "info") {
  if (!errorSpan) return;
  errorSpan.textContent = message ?? "";
  errorSpan.classList.remove("bb-error--error", "bb-error--info");
  if (!message) return;
  if (kind === "error") {
    errorSpan.classList.add("bb-error--error");
  } else {
    errorSpan.classList.add("bb-error--info");
  }
}

export function setError(message: string | null) {
  setStatus(message, "error");
}

export function setInfo(message: string | null) {
  setStatus(message, "info");
}