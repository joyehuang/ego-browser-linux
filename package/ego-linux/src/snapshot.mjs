import { createSessionResolver } from "./session.mjs";
import { egoRejectedError } from "./task-spaces.mjs";

/**
 * snapshot() — the semantic page view the agent reads.
 *
 * Contract (`docs/native-bindings-api.md` + `package/ego-browser/src/snapshot-result.ts`):
 *   snapshot(options?) -> {
 *     content: string,
 *     refs: [{ refId, backendNodeId, role, name, loc?, frameId? }]
 *   }
 *
 * `content` starts with `root` and uses 2-space indentation compatible with
 * `compactSnapshotContent`. Same-origin iframes and best-effort OOPIF targets
 * are pierced and emit `iframe ...` -> `root` -> child nodes with unique
 * `refId`s across frames.
 */

const VALID_SCOPES = new Set(["full_page", "only_within_viewport", "subtree"]);

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "head", "meta", "link", "title", "template", "br",
]);

const ROLE_BY_TAG = new Map(Object.entries({
  a: "link", button: "button", select: "combobox", textarea: "textbox",
  h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
  img: "img", nav: "navigation", main: "main", header: "banner", footer: "contentinfo",
  form: "form", ul: "list", ol: "list", li: "listitem", table: "table", tr: "row",
  td: "cell", th: "columnheader", dialog: "dialog", option: "option", summary: "button",
  details: "group", label: "label", fieldset: "group", legend: "legend", article: "article",
  section: "region", aside: "complementary", iframe: "iframe", video: "video", audio: "audio",
}));

const INPUT_TYPE_ROLE = new Map(Object.entries({
  button: "button", submit: "button", reset: "button", image: "button",
  checkbox: "checkbox", radio: "radio", range: "slider", file: "file-input",
  hidden: "hidden",
}));

/** Roles worth handing the agent a ref for. */
const INTERACTIVE_ROLES = new Set([
  "link", "button", "textbox", "checkbox", "radio", "combobox", "option", "slider",
  "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "switch", "searchbox",
  "file-input", "spinbutton",
]);

/**
 * Roles whose accessible name comes from their own text content (ARIA's
 * "name from content"). Everything else is a container.
 */
const NAME_FROM_CONTENT = new Set([
  "button", "link", "heading", "option", "tab", "menuitem", "menuitemcheckbox",
  "menuitemradio", "label", "legend", "switch",
]);

/** Roles that carry structure worth printing even without a ref. */
const STRUCTURAL_ROLES = new Set([
  "heading", "list", "listitem", "table", "row", "cell", "columnheader", "navigation",
  "main", "banner", "contentinfo", "form", "dialog", "article", "region", "complementary",
  "img", "label", "legend", "group", "iframe", "video", "audio",
]);

const MAX_NAME = 120;
const MAX_TEXT = 200;

function squash(value, limit = MAX_TEXT) {
  const raw = String(value ?? "");
  if (raw.replace(/[\s\p{Cf}]/gu, "") === "") return "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function rareBooleanSet(rare) {
  return new Set(rare?.index || []);
}

function rareMap(rare) {
  const map = new Map();
  const index = rare?.index || [];
  const value = rare?.value || [];
  for (let i = 0; i < index.length; i += 1) map.set(index[i], value[i]);
  return map;
}

function cssEscapeIdent(value) {
  return String(value).replace(/([^\w-])/g, "\\$1");
}

function inc(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

/** A document's nodes, decoded from the string table into a usable shape. */
function decodeDocument(document, strings, { frameId = undefined } = {}) {
  const nodes = document.nodes || {};
  const count = nodes.nodeName?.length || 0;
  const str = (index) => (index === undefined || index < 0 ? "" : strings[index] || "");

  const contentDocumentIndex = rareMap(nodes.contentDocumentIndex);
  const clickable = rareBooleanSet(nodes.isClickable);
  const inputValue = rareMap(nodes.inputValue);
  const inputChecked = rareBooleanSet(nodes.inputChecked);

  const layoutBounds = new Map();
  const layoutText = new Map();
  const layout = document.layout || {};
  for (let i = 0; i < (layout.nodeIndex || []).length; i += 1) {
    const nodeIndex = layout.nodeIndex[i];
    layoutBounds.set(nodeIndex, layout.bounds?.[i]);
    const text = str(layout.text?.[i]);
    if (text) layoutText.set(nodeIndex, text);
  }

  const decoded = [];
  const children = new Map();
  const byId = new Map();
  const counts = {
    id: new Map(),
    testId: new Map(),
    dataTest: new Map(),
    tagName: new Map(),
    href: new Map(),
  };

  for (let i = 0; i < count; i += 1) {
    const attributes = {};
    const flat = nodes.attributes?.[i] || [];
    for (let a = 0; a + 1 < flat.length; a += 2) {
      attributes[str(flat[a]).toLowerCase()] = str(flat[a + 1]);
    }
    const tag = str(nodes.nodeName?.[i]).toLowerCase();
    const node = {
      index: i,
      parent: nodes.parentIndex?.[i] ?? -1,
      nodeType: nodes.nodeType?.[i],
      tag,
      value: str(nodes.nodeValue?.[i]),
      backendNodeId: nodes.backendNodeId?.[i],
      attributes,
      bounds: layoutBounds.get(i),
      text: layoutText.get(i),
      clickable: clickable.has(i),
      inputValue: inputValue.has(i) ? str(inputValue.get(i)) : undefined,
      inputChecked: inputChecked.has(i),
      contentDocumentIndex: contentDocumentIndex.get(i),
    };
    decoded.push(node);
    if (node.parent >= 0) {
      if (!children.has(node.parent)) children.set(node.parent, []);
      children.get(node.parent).push(i);
    }
    if (node.attributes.id) {
      byId.set(node.attributes.id, node);
      inc(counts.id, node.attributes.id);
    }
    if (node.attributes["data-testid"]) inc(counts.testId, node.attributes["data-testid"]);
    if (node.attributes["data-test"]) inc(counts.dataTest, node.attributes["data-test"]);
    if (node.attributes.name && tag) inc(counts.tagName, `${tag}\u0000${node.attributes.name}`);
    if (tag === "a" && node.attributes.href) inc(counts.href, node.attributes.href);
  }

  const docFrameId = document.frameId !== undefined ? str(document.frameId) : "";
  return {
    nodes: decoded,
    children,
    byId,
    counts,
    frameId: frameId || docFrameId || undefined,
    scrollX: document.scrollOffsetX || 0,
    scrollY: document.scrollOffsetY || 0,
    url: str(document.documentURL),
  };
}

function roleOf(node) {
  const explicit = node.attributes.role;
  if (explicit) return explicit.trim().split(/\s+/)[0];
  if (node.tag === "input") {
    const type = (node.attributes.type || "text").toLowerCase();
    if (INPUT_TYPE_ROLE.has(type)) return INPUT_TYPE_ROLE.get(type);
    if (type === "search") return "searchbox";
    if (type === "number") return "spinbutton";
    return "textbox";
  }
  if (node.tag === "a") return node.attributes.href !== undefined ? "link" : "generic";
  if (node.attributes.contenteditable === "" || node.attributes.contenteditable === "true") {
    return "textbox";
  }
  return ROLE_BY_TAG.get(node.tag) || "generic";
}

function subtreeText(doc, index, budget = MAX_NAME) {
  const parts = [];
  const walk = (current) => {
    if (parts.join(" ").length > budget) return;
    const node = doc.nodes[current];
    if (!node) return;
    if (node.nodeType === 3) {
      const text = node.text || node.value;
      if (text && text.replace(/[\s\p{Cf}]/gu, "") !== "") parts.push(text.trim());
      return;
    }
    if (SKIP_TAGS.has(node.tag)) return;
    for (const child of doc.children.get(current) || []) walk(child);
  };
  walk(index);
  return squash(parts.join(" "), budget);
}

function accessibleName(doc, node, role) {
  const attrs = node.attributes;
  if (attrs["aria-label"]) return squash(attrs["aria-label"], MAX_NAME);
  if (attrs["aria-labelledby"]) {
    const labels = attrs["aria-labelledby"]
      .split(/\s+/)
      .map((id) => doc.byId.get(id))
      .filter(Boolean)
      .map((target) => subtreeText(doc, target.index));
    if (labels.length) return squash(labels.join(" "), MAX_NAME);
  }
  if (node.tag === "img") return squash(attrs.alt || "", MAX_NAME);
  if (node.tag === "input" || node.tag === "textarea" || node.tag === "select") {
    if (attrs.id) {
      for (const candidate of doc.nodes) {
        if (candidate.tag === "label" && candidate.attributes.for === attrs.id) {
          return subtreeText(doc, candidate.index);
        }
      }
    }
    let parent = node.parent;
    while (parent >= 0) {
      const ancestor = doc.nodes[parent];
      if (!ancestor) break;
      if (ancestor.tag === "label") return subtreeText(doc, ancestor.index);
      parent = ancestor.parent;
    }
    return squash(attrs.placeholder || attrs.title || attrs.name || "", MAX_NAME);
  }
  if (role === "iframe") return squash(attrs.title || attrs.name || "", MAX_NAME);
  if (NAME_FROM_CONTENT.has(role)) return subtreeText(doc, node.index);
  return squash(attrs.title || "", MAX_NAME);
}

/**
 * Only emit locators accepted by `element-resolver.ts` (`css:...`, `href:...`,
 * `role:...`). Never emit `testid:...`, `placeholder:...`, `unstable`, or
 * `ambiguous`.
 */
function stableLocator(doc, node, role, name, roleNameCounts) {
  const attrs = node.attributes;
  if (attrs["data-testid"] && doc.counts.testId.get(attrs["data-testid"]) === 1) {
    return `css:[data-testid=${JSON.stringify(attrs["data-testid"])}]`;
  }
  if (attrs.id && /^[A-Za-z][\w-]*$/.test(attrs.id) && doc.counts.id.get(attrs.id) === 1) {
    return `css:#${cssEscapeIdent(attrs.id)}`;
  }
  if (role === "link" && attrs.href && doc.counts.href.get(attrs.href) === 1) {
    return `href:${attrs.href}`;
  }
  if (attrs["data-test"] && doc.counts.dataTest.get(attrs["data-test"]) === 1) {
    return `css:[data-test=${JSON.stringify(attrs["data-test"])}]`;
  }
  if (
    attrs.name &&
    /^[A-Za-z][\w-]*$/.test(node.tag) &&
    doc.counts.tagName.get(`${node.tag}\u0000${attrs.name}`) === 1
  ) {
    return `css:${node.tag}[name=${JSON.stringify(attrs.name)}]`;
  }
  if (
    name &&
    INTERACTIVE_ROLES.has(role) &&
    roleNameCounts.get(`${role}\u0000${name}`) === 1
  ) {
    return `role:${role}[name=${JSON.stringify(name)}]`;
  }
  return null;
}

function buildRoleNameCounts(doc) {
  const counts = new Map();
  for (const node of doc.nodes) {
    if (node.nodeType !== 1 || SKIP_TAGS.has(node.tag)) continue;
    if (node.attributes["aria-hidden"] === "true") continue;
    const role = roleOf(node);
    if (!INTERACTIVE_ROLES.has(role)) continue;
    const name = accessibleName(doc, node, role);
    if (name) inc(counts, `${role}\u0000${name}`);
  }
  return counts;
}

function intersectsViewport(bounds, viewport) {
  if (!bounds || !viewport) return true;
  const [x, y, width, height] = bounds;
  return (
    x + width >= viewport.x &&
    y + height >= viewport.y &&
    x <= viewport.x + viewport.width &&
    y <= viewport.y + viewport.height
  );
}

function renderSubtree(doc, startIndex, state, out, refs, depth) {
  const {
    documents,
    oopifByBackendNode,
    oopifDocs,
    usedOopifs,
    viewport,
    interactiveOnly,
    includeActionMarks,
    includeStableLocator,
    allocateRefId,
  } = state;
  const roleNameCounts = buildRoleNameCounts(doc);

  const emit = (indent, line) => out.push(`${"  ".repeat(indent)}${line}`);

  const walk = (index, indent) => {
    const node = doc.nodes[index];
    if (!node) return;

    if (node.nodeType === 3) {
      if (interactiveOnly) return;
      const text = squash(node.text || node.value);
      if (
        text &&
        node.text !== undefined &&
        intersectsViewport(node.bounds, viewport)
      ) {
        emit(indent, `text: ${text}`);
      }
      return;
    }
    if (node.nodeType !== 1) {
      for (const child of doc.children.get(index) || []) walk(child, indent);
      return;
    }
    if (SKIP_TAGS.has(node.tag)) return;
    if (node.attributes["aria-hidden"] === "true") return;

    const role = roleOf(node);
    if (role === "hidden") return;

    const rendered = node.bounds && node.bounds[2] > 0 && node.bounds[3] > 0;
    const inScope = rendered && intersectsViewport(node.bounds, viewport);

    // Same-origin iframe document embedded in DOMSnapshot.
    if (node.contentDocumentIndex !== undefined) {
      const childDoc = documents[node.contentDocumentIndex];
      if (childDoc && !state.seenDocs.has(node.contentDocumentIndex)) {
        state.seenDocs.add(node.contentDocumentIndex);
        const name = accessibleName(doc, node, role);
        const frameOut = [];
        renderSubtree(childDoc, 0, state, frameOut, refs, indent + 2);
        if (!interactiveOnly || frameOut.length > 0) {
          emit(
            indent,
            `iframe${name ? ` ${JSON.stringify(name)}` : ""} [url=${childDoc.url}]`,
          );
          emit(indent + 1, "root");
          out.push(...frameOut);
        }
        return;
      }
    }

    // Out-of-process iframe (OOPIF) mapped to its attached target document.
    if (node.tag === "iframe" && oopifDocs.size > 0) {
      const mappedFrameId = oopifByBackendNode.get(node.backendNodeId);
      const childDoc = mappedFrameId ? oopifDocs.get(mappedFrameId) : undefined;
      if (childDoc && !usedOopifs.has(mappedFrameId)) {
        usedOopifs.add(mappedFrameId);
        const name = accessibleName(doc, node, role);
        const frameOut = [];
        renderSubtree(childDoc, 0, state, frameOut, refs, indent + 2);
        if (!interactiveOnly || frameOut.length > 0) {
          emit(
            indent,
            `iframe${name ? ` ${JSON.stringify(name)}` : ""} [url=${childDoc.url}]`,
          );
          emit(indent + 1, "root");
          out.push(...frameOut);
        }
        return;
      }
    }

    const interactive =
      INTERACTIVE_ROLES.has(role) ||
      node.clickable ||
      node.attributes.onclick !== undefined ||
      node.attributes.tabindex !== undefined;

    const shouldEmit =
      inScope && (interactive || (!interactiveOnly && STRUCTURAL_ROLES.has(role)));
    const addressable = interactive && node.backendNodeId !== undefined;

    const name =
      shouldEmit || addressable ? accessibleName(doc, node, role) : "";
    const loc =
      (shouldEmit || addressable) && includeStableLocator
        ? stableLocator(doc, node, role, name, roleNameCounts)
        : null;

    let refId;
    if (addressable) {
      refId = allocateRefId(node.backendNodeId);
      refs.push({
        refId,
        backendNodeId: node.backendNodeId,
        role,
        name,
        ...(loc ? { loc } : {}),
        ...(doc.frameId ? { frameId: doc.frameId } : {}),
      });
    }

    if (shouldEmit) {
      const marks = [];
      if (addressable) marks.push(`ref=${refId}`);
      if (loc) marks.push(`loc=${loc}`);
      if (role === "link" && node.attributes.href) marks.push(`url=${node.attributes.href}`);
      if (includeActionMarks && interactive) {
        marks.push(role === "textbox" || role === "searchbox" ? "action=type" : "action=click");
      }
      if (node.inputValue) marks.push(`value=${squash(node.inputValue, 40)}`);
      if (node.inputChecked) marks.push("checked");
      if (node.attributes.disabled !== undefined) marks.push("disabled");

      const heading = node.tag.match(/^h([1-6])$/);
      const label = heading ? `heading${heading[1]}` : role;
      const suffix = marks.length ? ` [${marks.join(", ")}]` : "";
      emit(indent, `${label}${name ? ` ${JSON.stringify(name)}` : ""}${suffix}`);

      if (name && NAME_FROM_CONTENT.has(role) && subtreeText(doc, index) === name) {
        return;
      }
    }

    const nextIndent = shouldEmit ? indent + 1 : indent;
    for (const child of doc.children.get(index) || []) walk(child, nextIndent);
  };

  walk(startIndex, depth);
}

function collectDescendantIframeIds(targetInfos, frameTree, pageTargetId) {
  const frameParents = new Map();
  const walkTree = (tree, parentId) => {
    const id = tree?.frame?.id;
    if (typeof id !== "string") return;
    frameParents.set(id, typeof tree?.frame?.parentId === "string" ? tree.frame.parentId : parentId);
    for (const child of tree?.childFrames || []) walkTree(child, id);
  };
  if (frameTree) walkTree(frameTree, undefined);
  const rootFrameId = frameTree?.frame?.id;

  const iframes = (targetInfos || []).filter(
    (info) => info?.type === "iframe" && typeof info.targetId === "string",
  );
  const byId = new Map(iframes.map((info) => [info.targetId, info]));

  const belongs = (targetId) => {
    let cur = targetId;
    const visited = new Set();
    while (cur && !visited.has(cur)) {
      if (cur === pageTargetId || (rootFrameId && cur === rootFrameId)) return true;
      visited.add(cur);
      cur = frameParents.get(cur) ?? byId.get(cur)?.parentFrameId ?? byId.get(cur)?.parentId;
    }
    return false;
  };

  return iframes.filter((info) => belongs(info.targetId));
}

async function captureOopifDocs(cdp, mainDocs, sessionId, pageTargetId) {
  const oopifDocs = new Map();
  const oopifByBackendNode = new Map();

  let targetInfos = [];
  let frameTree;
  try {
    const [targetsRes, treeRes] = await Promise.all([
      cdp.call("Target.getTargets", {}),
      cdp.call("Page.getFrameTree", {}, sessionId).catch(() => null),
    ]);
    targetInfos = targetsRes?.targetInfos || [];
    frameTree = treeRes?.frameTree;
  } catch {
    return { oopifDocs, oopifByBackendNode };
  }

  const iframeTargets = collectDescendantIframeIds(targetInfos, frameTree, pageTargetId);
  if (iframeTargets.length === 0) return { oopifDocs, oopifByBackendNode };

  for (const info of iframeTargets) {
    let iframeSessionId = null;
    try {
      const attached = await cdp.call("Target.attachToTarget", {
        targetId: info.targetId,
        flatten: true,
      });
      iframeSessionId = attached?.sessionId;
      if (!iframeSessionId) continue;
      cdp.claimSession?.(iframeSessionId);
      const captured = await cdp.call(
        "DOMSnapshot.captureSnapshot",
        { computedStyles: [], includeDOMRects: false, includePaintOrder: false },
        iframeSessionId,
      );
      const strings = captured?.strings || [];
      const docs = (captured?.documents || []).map((d) =>
        decodeDocument(d, strings, { frameId: info.targetId }),
      );
      if (docs.length > 0) oopifDocs.set(info.targetId, docs[0]);
    } catch {
      // Best-effort OOPIF capture.
    } finally {
      if (iframeSessionId) {
        cdp.releaseSession?.(iframeSessionId);
        await cdp.call("Target.detachFromTarget", { sessionId: iframeSessionId }).catch(() => {});
      }
    }
  }

  if (oopifDocs.size > 0) {
    for (const doc of mainDocs) {
      for (const node of doc.nodes) {
        if (
          node.tag === "iframe" &&
          node.contentDocumentIndex === undefined &&
          node.backendNodeId !== undefined
        ) {
          try {
            const described = await cdp.call(
              "DOM.describeNode",
              { backendNodeId: node.backendNodeId },
              sessionId,
            );
            const childFrameId = described?.node?.frameId;
            if (childFrameId && oopifDocs.has(childFrameId)) {
              oopifByBackendNode.set(node.backendNodeId, childFrameId);
            }
          } catch {
            // Fall back to appending unmatched OOPIFs below.
          }
        }
      }
    }
  }

  return { oopifDocs, oopifByBackendNode };
}

export function createSnapshotApi(cdp, { listTabs, checkControl } = {}) {
  const sessionForActiveTab = createSessionResolver(cdp, {
    listTabs,
    op: "snapshot",
  });

  return {
    async snapshot(options = {}) {
      if (checkControl) {
        const blocked = await checkControl();
        if (blocked) {
          throw egoRejectedError(blocked.error, blocked.error_code);
        }
      }

      const scope = options.scope ?? "full_page";
      if (!VALID_SCOPES.has(scope)) {
        throw egoRejectedError(
          `Invalid snapshot scope: ${scope}`,
          "EGO_SNAPSHOT_FAILED",
        );
      }
      if (
        scope === "subtree" &&
        (typeof options.root !== "number" || !Number.isInteger(options.root))
      ) {
        throw egoRejectedError(
          "subtree snapshot requires numeric root backendNodeId",
          "EGO_SNAPSHOT_FAILED",
        );
      }

      const sessionId = await sessionForActiveTab();
      const pageTargetId = cdp.attachedHint?.();

      let viewport = null;
      if (scope === "only_within_viewport") {
        const metrics = await cdp.call("Page.getLayoutMetrics", {}, sessionId);
        const visual = metrics.cssVisualViewport || metrics.visualViewport;
        if (visual) {
          viewport = {
            x: visual.pageX ?? 0,
            y: visual.pageY ?? 0,
            width: visual.clientWidth ?? 0,
            height: visual.clientHeight ?? 0,
          };
        }
      }

      const captured = await cdp.call(
        "DOMSnapshot.captureSnapshot",
        { computedStyles: [], includeDOMRects: false, includePaintOrder: false },
        sessionId,
      );

      const strings = captured.strings || [];
      const documents = (captured.documents || []).map((document, idx) => {
        const decoded = decodeDocument(document, strings);
        if (idx === 0) decoded.frameId = undefined;
        return decoded;
      });
      if (!documents.length) return { content: "", refs: [] };

      const { oopifDocs, oopifByBackendNode } = await captureOopifDocs(
        cdp,
        documents,
        sessionId,
        pageTargetId,
      );

      let maxBackendNodeId = 0;
      for (const doc of [...documents, ...oopifDocs.values()]) {
        for (const node of doc.nodes) {
          if (typeof node.backendNodeId === "number" && node.backendNodeId > maxBackendNodeId) {
            maxBackendNodeId = node.backendNodeId;
          }
        }
      }
      const usedRefIds = new Set();
      let nextSyntheticRefId = maxBackendNodeId + 1;
      const allocateRefId = (backendNodeId) => {
        if (!usedRefIds.has(backendNodeId)) {
          usedRefIds.add(backendNodeId);
          return backendNodeId;
        }
        while (usedRefIds.has(nextSyntheticRefId)) nextSyntheticRefId += 1;
        const id = nextSyntheticRefId;
        usedRefIds.add(id);
        nextSyntheticRefId += 1;
        return id;
      };

      const renderState = {
        documents,
        oopifByBackendNode,
        oopifDocs,
        usedOopifs: new Set(),
        seenDocs: new Set([0]),
        viewport,
        interactiveOnly: Boolean(options.interactiveOnly),
        includeActionMarks: options.includeActionMarks ?? true,
        includeStableLocator: options.includeStableLocator ?? true,
        allocateRefId,
      };

      const out = ["root"];
      const refs = [];

      if (scope === "subtree") {
        const matches = [];
        for (const doc of [...documents, ...oopifDocs.values()]) {
          for (const node of doc.nodes) {
            if (node.backendNodeId === options.root) {
              matches.push({ doc, node });
            }
          }
        }
        if (matches.length === 0) {
          throw egoRejectedError(
            `Subtree root node not found: ${options.root}`,
            "EGO_SNAPSHOT_FAILED",
          );
        }
        if (matches.length > 1) {
          throw egoRejectedError(
            `Ambiguous subtree root backendNodeId: ${options.root}`,
            "EGO_SNAPSHOT_FAILED",
          );
        }
        const [{ doc, node }] = matches;
        renderSubtree(doc, node.index, renderState, out, refs, 1);
      } else {
        renderSubtree(documents[0], 0, renderState, out, refs, 1);
        for (const [frameId, childDoc] of oopifDocs.entries()) {
          if (renderState.usedOopifs.has(frameId)) continue;
          const frameOut = [];
          renderSubtree(childDoc, 0, renderState, frameOut, refs, 3);
          if (!renderState.interactiveOnly || frameOut.length > 0) {
            out.push(`  iframe [url=${childDoc.url}]`);
            out.push("    root");
            out.push(...frameOut);
          }
        }
      }

      let content = out.join("\n");
      const maxLen = options.maxResultLength;
      if (typeof maxLen === "number" && Number.isFinite(maxLen) && maxLen > 0 && content.length > maxLen) {
        content = content.slice(0, maxLen);
      }

      return { content, refs };
    },
  };
}
