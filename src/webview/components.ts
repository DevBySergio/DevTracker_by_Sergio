export type MetricTone = "default" | "success" | "warning" | "danger";

export interface ToolbarItem {
  id: string;
  label: string;
  value: string;
  active?: boolean;
}

export function Card(body: string, className = ""): string {
  const classes = ["card", className].filter(Boolean).join(" ");
  return `<div class="${escapeAttribute(classes)}">${body}</div>`;
}

export function Metric(options: {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  ariaLabel?: string;
  tone?: MetricTone;
  valueSuffix?: string;
}): string {
  const tone = options.tone && options.tone !== "default"
    ? ` ${options.tone}`
    : "";
  const aria = options.ariaLabel
    ? ` aria-label="${escapeAttribute(options.ariaLabel)}"`
    : "";
  const suffix = options.valueSuffix ?? "";
  return `<div class="card metric-card${tone}"${aria}><div class="card-title">${escapeHtml(options.title)}</div><div class="metric-big" id="${escapeAttribute(options.id)}" aria-live="polite">${escapeHtml(options.value)}</div><div class="metric-sub" id="${escapeAttribute(options.id)}-sub">${escapeHtml(options.subtitle)}</div>${suffix}</div>`;
}

export function Toolbar(options: {
  id?: string;
  hidden?: boolean;
  className: string;
  buttonClassName: string;
  ariaLabel: string;
  role: "tablist" | "group";
  dataAttribute: "tab" | "range";
  items: readonly ToolbarItem[];
}): string {
  const items = options.items.map((item) => {
    const active = item.active === true;
    const role = options.role === "tablist" ? ' role="tab"' : "";
    const selected = options.role === "tablist"
      ? ` aria-selected="${String(active)}" aria-controls="view-${escapeAttribute(item.value)}"`
      : "";
    return `<button class="${escapeAttribute(options.buttonClassName)}${active ? " active" : ""}" data-${options.dataAttribute}="${escapeAttribute(item.value)}" id="${escapeAttribute(item.id)}"${role}${selected}>${escapeHtml(item.label)}</button>`;
  }).join("");
  const id = options.id ? ` id="${escapeAttribute(options.id)}"` : "";
  const hidden = options.hidden === true ? " hidden" : "";
  return `<div${id} class="${escapeAttribute(options.className)}" role="${options.role}" aria-label="${escapeAttribute(options.ariaLabel)}"${hidden}>${items}</div>`;
}

export function EmptyState(message: string): string {
  return `<div class="empty" role="status">${escapeHtml(message)}</div>`;
}

export function ChartPanel(options: {
  title: string;
  canvasId: string;
  ariaLabel: string;
  short?: boolean;
  accessory?: string;
}): string {
  const heading = options.accessory
    ? `<div class="metric-row"><div class="card-title">${escapeHtml(options.title)}</div>${options.accessory}</div>`
    : `<div class="card-title">${escapeHtml(options.title)}</div>`;
  return Card(
    `${heading}<div class="chart-container${options.short ? " chart-short" : ""}"><canvas id="${escapeAttribute(options.canvasId)}" role="img" aria-label="${escapeAttribute(options.ariaLabel)}"></canvas></div>`,
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
