// Generates fixtures.js for harness.html from live Miro data, using the same
// builders the MCP server uses. Run from the repo root after `npm run build`:
//
//   MIRO_ACCESS_TOKEN=... node dev-harness/make-fixtures.mjs
//
// Then serve this directory together with the built view HTML:
//
//   cp dist/comments.html dist/recent-boards.html dev-harness/
//   cd dev-harness && python3 -m http.server 8763
//   open "http://localhost:8763/harness.html?view=comments&fixture=withComments&theme=light"
import {
  buildBoardSvg,
  buildCommentThreads,
  buildRecentBoards,
} from "../dist/miro-client.js";
import fs from "node:fs";

const boardWithComments = process.argv[2] ?? "uXjVHWiWdK4=";
const boardEmpty = process.argv[3] ?? "uXjVH0Zr5Vk=";

const withComments = await buildCommentThreads(boardWithComments);
const empty = await buildCommentThreads(boardEmpty);
const recent = await buildRecentBoards(8);
const svg = await buildBoardSvg(boardWithComments);
const svgEmpty = await buildBoardSvg(boardEmpty);

fs.writeFileSync(
  new URL("./fixtures.js", import.meta.url),
  "window.FIXTURES=" +
    JSON.stringify({ withComments, empty, recent, svg, svgEmpty }, null, 1) +
    ";\n",
);
console.log("fixtures.js written:", {
  threads: withComments.threads.length,
  emptyThreads: empty.threads.length,
  boards: recent.boards.length,
  svgRects: svg.rects.length,
  svgLabels: svg.labels.length,
  svgEmptyRendered: svgEmpty.rendered,
});
