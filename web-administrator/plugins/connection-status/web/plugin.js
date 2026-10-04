// plugins/connection-status/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
function register(platform2) {
  const { fmtNumber } = platform2.ui;
  let states = /* @__PURE__ */ new Map();
  let polling = false;
  let lastError = null;
  function stateOf(value) {
    const flat = [];
    (function walk(v) {
      if (v === null || v === void 0) return;
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      if (typeof v === "object") {
        Object.values(v).forEach(walk);
        return;
      }
      flat.push(String(v));
    })(value);
    return flat[flat.length - 1] || "";
  }
  async function poll() {
    if (!(platform2.store && platform2.store.getState && platform2.store.getState("user"))) {
      return;
    }
    const path = platform2.router && platform2.router.currentPath && platform2.router.currentPath() || "";
    if (!(path === "/dashboard" || path.startsWith("/dashboard?") || path.startsWith("/dashboard/"))) {
      return;
    }
    try {
      const map = await platform2.api.get("/extensions/dashboardstatus/connectorStates");
      const next = /* @__PURE__ */ new Map();
      for (const entry of platform2.api.asList(map?.entry)) {
        const values = Object.values(entry);
        const key = values.find((v) => typeof v === "string");
        if (key !== void 0) {
          const value = values.find((v) => v !== key);
          next.set(key, stateOf(value));
        }
      }
      states = next;
      lastError = null;
    } catch (e) {
      lastError = e.message;
    }
  }
  function ensurePolling() {
    if (polling) return;
    polling = true;
    poll();
    setInterval(poll, 5e3);
  }
  const dotColor = (state) => {
    const s = state.toLowerCase();
    if (!s || s === "idle") return "var(--idle)";
    if (s.includes("connect") || s.includes("receiv") || s.includes("send") || s.includes("read") || s.includes("writ") || s.includes("poll")) return "var(--ok)";
    if (s.includes("wait")) return "var(--warn)";
    return "var(--busy)";
  };
  const StateCell = (state) => state ? /* @__PURE__ */ React.createElement("span", { className: "status-cell" }, /* @__PURE__ */ React.createElement("span", { className: "w-[6px] h-[6px] rounded-full inline-block", style: { background: dotColor(state) } }), state) : "";
  platform2.registerDashboardColumn({
    id: "connection",
    label: "\u8FDE\u63A5",
    order: 10,
    // Channel-level: show the source connector (metaDataId 0) state.
    cell(status) {
      ensurePolling();
      return StateCell(states.get(`${status.channelId}_0`) || "");
    },
    connectorCell(child) {
      ensurePolling();
      return StateCell(states.get(`${child.channelId}_${child.metaDataId}`) || "");
    }
  });
  function ConnectionLogTab({ selection }) {
    const [items, setItems] = React.useState([]);
    const [error, setError] = React.useState(null);
    const sel = selection && selection.length === 1 ? selection[0] : null;
    const channelId = sel ? sel.channelId : null;
    const metaDataId = sel && sel.metaDataId != null ? Number(sel.metaDataId) : null;
    React.useEffect(() => {
      let timer = null;
      let cancelled = false;
      async function refresh() {
        try {
          const path = channelId ? `/extensions/dashboardstatus/connectionLogs/${channelId}` : "/extensions/dashboardstatus/connectionLogs";
          let next = platform2.api.asList(
            await platform2.api.get(path, { fetchSize: 100 }),
            "connectionLogItem"
          );
          if (metaDataId != null) next = next.filter((it) => Number(it.metadataId) === metaDataId);
          if (cancelled) return;
          setItems(next);
          setError(null);
        } catch (e) {
          if (cancelled) return;
          setItems([]);
          setError(e.message);
        }
        if (!cancelled) timer = setTimeout(refresh, 5e3);
      }
      refresh();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [channelId, metaDataId]);
    const [sort, setSort] = React.useState({ key: null, dir: 1 });
    const sorted = React.useMemo(() => {
      if (!sort.key) return items;
      const num = sort.key === "logId";
      const val = (it) => num ? Number(it[sort.key]) || 0 : String(it[sort.key] ?? "").toLowerCase();
      return [...items].sort((a, b) => {
        const va = val(a), vb = val(b);
        return (num ? va - vb : va.localeCompare(vb)) * sort.dir;
      });
    }, [items, sort]);
    const toggleSort = (key) => setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 });
    const arrow = (key) => sort.key === key ? sort.dir > 0 ? " \u25B2" : " \u25BC" : "";
    return /* @__PURE__ */ React.createElement("div", { className: "dt-wrap h-full" }, /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("logId") }, "ID", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("logId"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("dateAdded") }, "\u65F6\u95F4\u6233", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("dateAdded"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("channelName") }, "\u901A\u9053", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("channelName"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("connectorType") }, "\u8FDE\u63A5\u5668", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("connectorType"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("eventState") }, "\u4E8B\u4EF6", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("eventState"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("information") }, "\u4FE1\u606F", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("information"))))), /* @__PURE__ */ React.createElement("tbody", null, sorted.map((item, i) => /* @__PURE__ */ React.createElement("tr", { key: item.logId != null ? `log-${item.logId}` : `row-${i}` }, /* @__PURE__ */ React.createElement("td", { className: "mono" }, fmtNumber(item.logId)), /* @__PURE__ */ React.createElement("td", { className: "mono" }, String(item.dateAdded ?? "")), /* @__PURE__ */ React.createElement("td", null, String(item.channelName ?? "")), /* @__PURE__ */ React.createElement("td", null, String(item.connectorType ?? "")), /* @__PURE__ */ React.createElement("td", null, StateCell(String(item.eventState ?? ""))), /* @__PURE__ */ React.createElement("td", { className: "mono" }, String(item.information ?? ""))))), !items.length && /* @__PURE__ */ React.createElement("caption", { className: "[caption-side:bottom] p-3.5 text-text-faint" }, error ? `\u8FDE\u63A5\u65E5\u5FD7\u4E0D\u53EF\u7528\uFF1A${error}` : lastError ? `\u8FDE\u63A5\u65E5\u5FD7\u4E0D\u53EF\u7528\uFF1A${lastError}` : "\u6682\u65E0\u8FDE\u63A5\u4E8B\u4EF6")));
  }
  platform2.registerDashboardTab({
    id: "connection-log",
    label: "\u8FDE\u63A5\u65E5\u5FD7",
    order: 20,
    component: ConnectionLogTab
  });
}
export {
  register
};
