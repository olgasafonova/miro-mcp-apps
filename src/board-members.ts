/**
 * Miro board-members UI. Receives BoardMembersResult and renders an avatar
 * grid — initials-based avatars (the REST API exposes no photos), name, and
 * a role badge — sorted owner-first by the builder.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./board-members.css";

interface Member {
  id: string;
  name: string;
  role: string;
}

interface BoardMembersResult {
  boardId: string;
  boardName: string;
  viewLink: string;
  total: number;
  members: Member[];
  roleCounts: Record<string, number>;
}

// Role → badge tone. Owner gets the Miro accent; the rest step down.
const ROLE_STYLE: Record<string, { bg: string; fg: string }> = {
  owner: { bg: "#ffd02f", fg: "#050038" },
  coowner: { bg: "#fde68a", fg: "#78350f" },
  editor: { bg: "#bbf7d0", fg: "#14532d" },
  commenter: { bg: "#bfdbfe", fg: "#1e3a8a" },
  viewer: { bg: "#e5e7eb", fg: "#1f2937" },
  guest: { bg: "#fce7f3", fg: "#831843" },
};

// Deterministic avatar palette; a member keeps their color across renders
// because it hashes from the member id.
const AVATAR_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#0891b2",
  "#4f46e5",
  "#b91c1c",
];

function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const appEl = document.getElementById("app")!;
const boardNameEl = document.getElementById("board-name")!;
const subtitleEl = document.getElementById("subtitle")!;
const membersEl = document.getElementById("members")!;
const openBoardBtn = document.getElementById(
  "open-board-btn",
) as HTMLButtonElement;

let currentData: BoardMembersResult | null = null;

function extractData(result: CallToolResult): BoardMembersResult | null {
  const sc = result.structuredContent as
    Partial<BoardMembersResult> | undefined;
  if (!sc?.boardId || !sc.boardName || !Array.isArray(sc.members)) return null;
  return sc as BoardMembersResult;
}

function renderMembers(members: Member[]) {
  membersEl.replaceChildren();
  if (members.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No members on this board.";
    membersEl.appendChild(empty);
    return;
  }
  for (const member of members) {
    const card = document.createElement("div");
    card.className = "member";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.style.background = avatarColor(member.id);
    avatar.textContent = initials(member.name);

    const info = document.createElement("div");
    info.className = "member-info";
    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = member.name;
    const role = document.createElement("span");
    role.className = "member-role";
    const tone = ROLE_STYLE[member.role];
    if (tone) {
      role.style.background = tone.bg;
      role.style.color = tone.fg;
    }
    role.textContent = member.role;
    info.append(name, role);

    card.append(avatar, info);
    membersEl.appendChild(card);
  }
}

function render(data: BoardMembersResult) {
  currentData = data;
  boardNameEl.textContent = data.boardName;
  const breakdown = Object.entries(data.roleCounts)
    .map(([role, n]) => `${n} ${role}${n === 1 ? "" : "s"}`)
    .join(" · ");
  subtitleEl.textContent =
    `${data.total} member${data.total === 1 ? "" : "s"}` +
    (breakdown ? ` · ${breakdown}` : "");
  openBoardBtn.disabled = !data.viewLink;
  renderMembers(data.members);
}

function renderError(message: string) {
  appEl.replaceChildren();
  const errEl = document.createElement("div");
  errEl.className = "error";
  errEl.textContent = message;
  appEl.appendChild(errEl);
}

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    appEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    appEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    appEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    appEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Miro Board Members", version: "0.1.0" });

app.ontoolresult = (result) => {
  const data = extractData(result);
  if (!data) {
    renderError("Server returned no member data.");
    return;
  }
  render(data);
};

app.onerror = (e) => {
  console.error(e);
  renderError(`Error: ${String(e)}`);
};

app.onhostcontextchanged = handleHostContextChanged;

openBoardBtn.addEventListener("click", async () => {
  if (!currentData?.viewLink) return;
  try {
    await app.openLink({ url: currentData.viewLink });
  } catch (e) {
    console.error("Open link failed:", e);
  }
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
