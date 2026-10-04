// plugins/datapruner/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PRUNER_STATUS_ORDER = ["currentState", "currentProcess", "lastProcess", "nextProcess", "isRunning"];
function childEl(root, name) {
  if (!root) return null;
  for (const c of root.children) if (c.tagName === name) return c;
  return null;
}
function setChild(doc, root, name, value) {
  let el = childEl(root, name);
  if (value === null || value === void 0) {
    if (el) root.removeChild(el);
    return;
  }
  if (!el) {
    el = doc.createElement(name);
    root.appendChild(el);
  }
  el.textContent = String(value);
}
var elText = (el) => el ? el.textContent : "";
var elBool = (el) => el ? (el.textContent || "").trim() === "true" : false;
var UNIT_MS = { milliseconds: 1, seconds: 1e3, minutes: 6e4, hours: 36e5 };
function msToFreq(ms) {
  if (ms > 0 && ms % 36e5 === 0) return { val: ms / 36e5, unit: "hours" };
  if (ms > 0 && ms % 6e4 === 0) return { val: ms / 6e4, unit: "minutes" };
  if (ms > 0 && ms % 1e3 === 0) return { val: ms / 1e3, unit: "seconds" };
  return { val: ms || "", unit: "milliseconds" };
}
var CONTENT_OPTIONS = [
  { key: "xml", label: "XML \u5E8F\u5217\u5316\u6D88\u606F", contentType: null, dest: false },
  { key: "src-RAW", label: "\u6E90 - \u539F\u59CB", contentType: "RAW", dest: false },
  { key: "src-PROCESSED_RAW", label: "\u6E90 - \u5904\u7406\u540E\u539F\u59CB", contentType: "PROCESSED_RAW", dest: false },
  { key: "src-TRANSFORMED", label: "\u6E90 - \u8F6C\u6362\u540E", contentType: "TRANSFORMED", dest: false },
  { key: "src-ENCODED", label: "\u6E90 - \u7F16\u7801\u540E", contentType: "ENCODED", dest: false },
  { key: "src-RESPONSE", label: "\u6E90 - \u54CD\u5E94", contentType: "RESPONSE", dest: false },
  { key: "dst-RAW", label: "\u76EE\u7684\u5730 - \u539F\u59CB", contentType: "RAW", dest: true },
  { key: "dst-TRANSFORMED", label: "\u76EE\u7684\u5730 - \u8F6C\u6362\u540E", contentType: "TRANSFORMED", dest: true },
  { key: "dst-ENCODED", label: "\u76EE\u7684\u5730 - \u7F16\u7801\u540E", contentType: "ENCODED", dest: true },
  { key: "dst-SENT", label: "\u76EE\u7684\u5730 - \u5DF2\u53D1\u9001", contentType: "SENT", dest: true },
  { key: "dst-RESPONSE", label: "\u76EE\u7684\u5730 - \u54CD\u5E94", contentType: "RESPONSE", dest: true },
  { key: "dst-PROCESSED_RESPONSE", label: "\u76EE\u7684\u5730 - \u5904\u7406\u540E\u54CD\u5E94", contentType: "PROCESSED_RESPONSE", dest: true },
  { key: "map-SOURCE_MAP", label: "\u6E90\u6620\u5C04", contentType: "SOURCE_MAP", dest: false },
  { key: "map-CHANNEL_MAP", label: "\u901A\u9053\u6620\u5C04", contentType: "CHANNEL_MAP", dest: false },
  { key: "map-RESPONSE_MAP", label: "\u54CD\u5E94\u6620\u5C04", contentType: "RESPONSE_MAP", dest: false }
];
var COMPRESS_OPTIONS = [
  { key: "none", label: "\u65E0", archive: null, compress: null },
  { key: "zip", label: "zip", archive: "zip", compress: null },
  { key: "tar.gz", label: "tar.gz", archive: "tar", compress: "gz" },
  { key: "tar.bz2", label: "tar.bz2", archive: "tar", compress: "bzip2" }
];
var ENCRYPTION_OPTIONS = [
  { value: "STANDARD", label: "\u6807\u51C6" },
  { value: "AES128", label: "AES-128" },
  { value: "AES256", label: "AES-256" }
];
var ARCHIVE_VARS = [
  { label: "\u6D88\u606F ID", token: "${message.messageId}" },
  { label: "\u670D\u52A1\u5668 ID", token: "${message.serverId}" },
  { label: "\u901A\u9053 ID", token: "${message.channelId}" },
  { label: "\u539F\u59CB\u6587\u4EF6\u540D", token: "${originalFilename}" },
  { label: "\u683C\u5F0F\u5316\u6D88\u606F\u65E5\u671F", token: "${date.format('yyyy-MM-dd',$message.getConnectorMessages().get(0).getReceivedDate())}" },
  { label: "\u683C\u5F0F\u5316\u5F53\u524D\u65E5\u671F", token: "${date.get('yyyy-MM-dd')}" },
  { label: "\u65F6\u95F4\u6233", token: "${SYSTIME}" },
  { label: "\u552F\u4E00 ID", token: "${UUID}" },
  { label: "\u8BA1\u6570", token: "${COUNT}" }
];
var ARCHIVE_VAR_MIME = "application/x-oie-archivevar";
function register(platform2) {
  const { taskButton, toast, confirmDialog } = platform2.ui;
  const api = platform2.api;
  function labelCase(key) {
    const s = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function propsToList(raw) {
    const list = [];
    if (!raw || typeof raw !== "object") return list;
    if (raw.property !== void 0) {
      for (const p of api.asList(raw.property)) {
        if (!p || typeof p !== "object") continue;
        list.push({ name: String(p["@name"] ?? p.name ?? ""), value: p.$ ?? p.value ?? "" });
      }
      return list;
    }
    if (raw.entry !== void 0) {
      for (const e of api.asList(raw.entry)) {
        if (!e || typeof e !== "object") continue;
        const s = e.string;
        if (Array.isArray(s)) list.push({ name: String(s[0] ?? ""), value: s.length > 1 ? s[1] : "" });
        else {
          const vals = Object.values(e);
          list.push({ name: String(vals[0] ?? ""), value: vals.length > 1 ? vals[1] : "" });
        }
      }
      return list;
    }
    for (const [name, value] of Object.entries(raw)) {
      if (name.startsWith("@")) continue;
      list.push({ name, value });
    }
    return list;
  }
  function listToProps(list) {
    return { property: list.map((p) => ({ "@name": p.name, $: String(p.value ?? "") })) };
  }
  function statusPairs(raw) {
    const pairs = [];
    if (raw && typeof raw === "object" && raw.entry !== void 0) {
      for (const e of api.asList(raw.entry)) {
        if (!e || typeof e !== "object") continue;
        const s = e.string;
        if (Array.isArray(s)) pairs.push([String(s[0] ?? ""), s.length > 1 ? String(s[1] ?? "") : ""]);
        else if (s !== void 0) pairs.push([String(s), ""]);
      }
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("@")) continue;
        pairs.push([k, String(v ?? "")]);
      }
    }
    pairs.sort((a, b) => {
      const ia = PRUNER_STATUS_ORDER.indexOf(a[0]), ib = PRUNER_STATUS_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return pairs;
  }
  function YesNo({ value, onChange, disabled }) {
    const name = React.useMemo(() => "datapruner-rg-" + Math.random().toString(36).slice(2), []);
    return /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "radio",
        name,
        value: "yes",
        checked: value === true,
        disabled,
        onChange: () => onChange(true)
      }
    ), " \u662F"), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "radio",
        name,
        value: "no",
        checked: value === false,
        disabled,
        onChange: () => onChange(false)
      }
    ), " \u5426"));
  }
  function Field({ label, hint, children }) {
    return /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, label), children, hint ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, hint) : null);
  }
  function Loading({ text = "\u52A0\u8F7D\u4E2D\u2026" }) {
    return /* @__PURE__ */ React.createElement("div", { className: "loading-block" }, /* @__PURE__ */ React.createElement("div", { className: "spinner" }), text);
  }
  function DataPrunerPanel({ platform: platform3, setTasks, setSave, markDirty, markClean }) {
    const [phase, setPhase] = React.useState("loading");
    const [errorMessage, setErrorMessage] = React.useState("");
    const [statusState, setStatusState] = React.useState({ phase: "loading", pairs: [], message: "" });
    const [busy, setBusy] = React.useState(false);
    const operationRef = React.useRef(false);
    const mountedRef = React.useRef(true);
    const propListRef = React.useRef([]);
    const scheduleRef = React.useRef(null);
    const archiverRef = React.useRef(null);
    const [enabled, setEnabled] = React.useState(false);
    const [blockSize, setBlockSize] = React.useState("");
    const [pruneEvents, setPruneEvents] = React.useState(false);
    const [maxEventAge, setMaxEventAge] = React.useState("");
    const [archiveEnabled, setArchiveEnabled] = React.useState(false);
    const [archiverBlockSize, setArchiverBlockSize] = React.useState("");
    const [includeAttachments, setIncludeAttachments] = React.useState(null);
    const [scheduleType, setScheduleType] = React.useState("INTERVAL");
    const [freqValue, setFreqValue] = React.useState("");
    const [freqUnit, setFreqUnit] = React.useState("minutes");
    const [pollTime, setPollTime] = React.useState("00:00");
    const [cronJobs, setCronJobs] = React.useState([]);
    const [scheduleDirty, setScheduleDirty] = React.useState(false);
    const [hasSchedule, setHasSchedule] = React.useState(false);
    const [contentKey, setContentKey] = React.useState("xml");
    const [encrypt, setEncrypt] = React.useState(false);
    const [compressKey, setCompressKey] = React.useState("none");
    const [passwordEnabled, setPasswordEnabled] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [encryptionType, setEncryptionType] = React.useState("AES128");
    const [rootFolder, setRootFolder] = React.useState("");
    const [filePattern, setFilePattern] = React.useState("");
    const rootInputRef = React.useRef(null);
    const patternInputRef = React.useRef(null);
    const lastVarTargetRef = React.useRef(null);
    const insertArchiveVar = (input, token) => {
      if (!input || input.disabled) return;
      const setter = input === rootInputRef.current ? setRootFolder : setFilePattern;
      const s = input.selectionStart ?? input.value.length;
      const e = input.selectionEnd ?? input.value.length;
      setter(input.value.slice(0, s) + token + input.value.slice(e));
      setArchiverDirty(true);
      const pos = s + token.length;
      requestAnimationFrame(() => {
        input.focus();
        try {
          input.setSelectionRange(pos, pos);
        } catch {
        }
      });
    };
    const onArchiveVarDragOver = (ev) => {
      if (!ev.currentTarget.disabled && Array.from(ev.dataTransfer.types).includes(ARCHIVE_VAR_MIME)) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }
    };
    const onArchiveVarDrop = (ev) => {
      const token = ev.dataTransfer.getData(ARCHIVE_VAR_MIME);
      if (!token || ev.currentTarget.disabled) return;
      ev.preventDefault();
      insertArchiveVar(ev.currentTarget, token);
    };
    const [archiverDirty, setArchiverDirty] = React.useState(false);
    const [hasArchiver, setHasArchiver] = React.useState(false);
    const dirtyRef = React.useRef(false);
    const cleanRef = React.useRef(null);
    const snapshot = () => JSON.stringify([
      enabled,
      blockSize,
      pruneEvents,
      maxEventAge,
      archiveEnabled,
      archiverBlockSize,
      includeAttachments,
      contentKey,
      encrypt,
      compressKey,
      passwordEnabled,
      password,
      encryptionType,
      rootFolder,
      filePattern,
      scheduleType,
      freqValue,
      freqUnit,
      pollTime,
      cronJobs
    ]);
    const latestSnapshotRef = React.useRef(snapshot());
    latestSnapshotRef.current = snapshot();
    const getProp = (name, dflt = "") => {
      const p = propListRef.current.find((x) => x.name === name);
      return p === void 0 ? dflt : String(p.value ?? "");
    };
    const setProp = (name, value) => {
      const p = propListRef.current.find((x) => x.name === name);
      if (p) p.value = value;
      else propListRef.current.push({ name, value });
    };
    function buildSchedule() {
      scheduleRef.current = null;
      const xml = getProp("pollingProperties");
      if (!xml || xml.trim() === "" || xml.trim()[0] !== "<") return false;
      let doc = null;
      try {
        doc = new DOMParser().parseFromString(xml, "text/xml");
      } catch (e) {
        return false;
      }
      if (!doc || doc.querySelector("parsererror")) return false;
      const root = doc.documentElement;
      const typeEl = childEl(root, "pollingType");
      if (!typeEl) return false;
      scheduleRef.current = { doc, root };
      setScheduleType((typeEl.textContent || "").trim() || "INTERVAL");
      const freqMs = parseInt(elText(childEl(root, "pollingFrequency")), 10) || 0;
      const f = msToFreq(freqMs);
      setFreqValue(f.val);
      setFreqUnit(f.unit);
      const hour = parseInt(elText(childEl(root, "pollingHour")), 10) || 0;
      const minute = parseInt(elText(childEl(root, "pollingMinute")), 10) || 0;
      setPollTime(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
      const jobs = [];
      const cronEl = childEl(root, "cronJobs");
      if (cronEl) {
        for (const cp of cronEl.children) {
          if (cp.tagName !== "cronProperty") continue;
          jobs.push({
            expression: elText(childEl(cp, "expression")),
            description: elText(childEl(cp, "description"))
          });
        }
      }
      setCronJobs(jobs);
      setScheduleDirty(false);
      return true;
    }
    function buildArchiver() {
      archiverRef.current = null;
      const xml = getProp("archiverOptions");
      if (!xml || xml.trim() === "" || xml.trim()[0] !== "<") return false;
      let doc = null;
      try {
        doc = new DOMParser().parseFromString(xml, "text/xml");
      } catch (e) {
        return false;
      }
      if (!doc || doc.querySelector("parsererror")) return false;
      const root = doc.documentElement;
      archiverRef.current = { doc, root };
      const ctVal = (elText(childEl(root, "contentType")) || "").trim() || null;
      const dest = elBool(childEl(root, "destinationContent"));
      let ckey = "xml";
      if (ctVal) {
        const opt = CONTENT_OPTIONS.find((o) => o.contentType === ctVal && o.dest === dest);
        ckey = opt ? opt.key : "xml";
      }
      setContentKey(ckey);
      setEncrypt(elBool(childEl(root, "encrypt")));
      const af = (elText(childEl(root, "archiveFormat")) || "").trim() || null;
      const cf = (elText(childEl(root, "compressFormat")) || "").trim() || null;
      const copt = COMPRESS_OPTIONS.find((o) => o.archive === af && o.compress === cf);
      setCompressKey(copt ? copt.key : "none");
      setPasswordEnabled(elBool(childEl(root, "passwordEnabled")));
      setPassword(elText(childEl(root, "password")));
      setEncryptionType((elText(childEl(root, "encryptionType")) || "").trim() || "AES128");
      setRootFolder(elText(childEl(root, "rootFolder")));
      setFilePattern(elText(childEl(root, "filePattern")));
      setArchiverDirty(false);
      return true;
    }
    function applyPropsToForm() {
      setEnabled(getProp("enabled") === "true");
      setBlockSize(getProp("pruningBlockSize"));
      setPruneEvents(getProp("pruneEvents") === "true");
      setMaxEventAge(getProp("maxEventAge"));
      setArchiveEnabled(getProp("archiveEnabled") === "true");
      setArchiverBlockSize(getProp("archiverBlockSize"));
      const incAttachMatch = /^<boolean>(true|false)<\/boolean>$/.exec(getProp("includeAttachments").trim());
      setIncludeAttachments(incAttachMatch ? incAttachMatch[1] === "true" : null);
      setHasSchedule(buildSchedule());
      setHasArchiver(buildArchiver());
    }
    async function refreshStatus() {
      try {
        const raw = await api.get("/extensions/datapruner/status");
        setStatusState({ phase: "ready", pairs: statusPairs(raw), message: "" });
      } catch (e) {
        setStatusState({ phase: "error", pairs: [], message: `\u65E0\u6CD5\u83B7\u53D6\u72B6\u6001\uFF1A${e.message}` });
      }
    }
    async function load() {
      if (operationRef.current || !mountedRef.current) return;
      operationRef.current = true;
      setBusy(true);
      setPhase("loading");
      try {
        const properties = await api.extensions.properties("Data Pruner");
        if (!mountedRef.current) return;
        propListRef.current = propsToList(properties);
        applyPropsToForm();
        setPhase("ready");
        refreshStatus();
      } catch (e) {
        if (!mountedRef.current) return;
        toast(`\u52A0\u8F7D\u6570\u636E\u4FEE\u526A\u5668\u5C5E\u6027\u5931\u8D25\uFF1A${e.message}`, "error");
        setErrorMessage(String(e.message || e));
        setPhase("error");
      } finally {
        operationRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    }
    async function save() {
      if (operationRef.current || phase !== "ready" || !mountedRef.current) return false;
      operationRef.current = true;
      setBusy(true);
      const submittedSnapshot = snapshot();
      try {
        setProp("enabled", String(enabled));
        setProp("pruningBlockSize", blockSize);
        setProp("pruneEvents", String(pruneEvents));
        setProp("maxEventAge", maxEventAge);
        setProp("archiveEnabled", String(archiveEnabled));
        setProp("archiverBlockSize", archiverBlockSize);
        const effIncludeAttachments = contentKey === "xml" ? includeAttachments : false;
        if (includeAttachments !== null) {
          setProp("includeAttachments", `<boolean>${effIncludeAttachments}</boolean>`);
        }
        const schedule = scheduleRef.current;
        if (schedule && scheduleDirty) {
          const { doc, root } = schedule;
          setChild(doc, root, "pollingType", scheduleType);
          if (scheduleType === "INTERVAL") {
            const ms = Math.round((parseFloat(freqValue) || 0) * (UNIT_MS[freqUnit] || 6e4));
            if (ms > 0) setChild(doc, root, "pollingFrequency", String(ms));
          } else if (scheduleType === "TIME") {
            const [hh, mm] = String(pollTime || "00:00").split(":");
            setChild(doc, root, "pollingHour", String(parseInt(hh, 10) || 0));
            setChild(doc, root, "pollingMinute", String(parseInt(mm, 10) || 0));
          } else if (scheduleType === "CRON") {
            let cronEl = childEl(root, "cronJobs");
            if (!cronEl) {
              cronEl = doc.createElement("cronJobs");
              root.appendChild(cronEl);
            }
            while (cronEl.firstChild) cronEl.removeChild(cronEl.firstChild);
            for (const job of cronJobs) {
              if (!job.expression || !job.expression.trim()) continue;
              const cp = doc.createElement("cronProperty");
              const desc = doc.createElement("description");
              desc.textContent = job.description || "";
              const expr = doc.createElement("expression");
              expr.textContent = job.expression;
              cp.appendChild(desc);
              cp.appendChild(expr);
              cronEl.appendChild(cp);
            }
          }
          setProp("pollingProperties", new XMLSerializer().serializeToString(doc));
        }
        const archiver = archiverRef.current;
        if (archiver && archiverDirty) {
          const { doc, root } = archiver;
          const cOpt = CONTENT_OPTIONS.find((o) => o.key === contentKey) || CONTENT_OPTIONS[0];
          setChild(doc, root, "contentType", cOpt.contentType);
          setChild(doc, root, "destinationContent", String(!!cOpt.dest));
          setChild(doc, root, "encrypt", String(encrypt));
          if (includeAttachments !== null) {
            setChild(doc, root, "includeAttachments", String(effIncludeAttachments));
          }
          const zOpt = COMPRESS_OPTIONS.find((o) => o.key === compressKey) || COMPRESS_OPTIONS[0];
          setChild(doc, root, "archiveFormat", zOpt.archive);
          setChild(doc, root, "compressFormat", zOpt.compress);
          const passwordActive = compressKey === "zip" && passwordEnabled;
          setChild(doc, root, "passwordEnabled", String(passwordActive));
          setChild(doc, root, "password", passwordActive ? password : "");
          setChild(doc, root, "encryptionType", encryptionType);
          setChild(doc, root, "rootFolder", rootFolder);
          setChild(doc, root, "filePattern", filePattern);
          setProp("archiverOptions", new XMLSerializer().serializeToString(doc));
        }
        await api.extensions.setProperties("Data Pruner", listToProps(propListRef.current));
        if (!mountedRef.current) return false;
        toast("\u6570\u636E\u4FEE\u526A\u5668\u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
        cleanRef.current = submittedSnapshot;
        dirtyRef.current = latestSnapshotRef.current !== submittedSnapshot;
        if (dirtyRef.current) markDirty();
        else markClean();
        return !dirtyRef.current;
      } catch (e) {
        if (mountedRef.current) toast(`\u4FDD\u5B58\u5931\u8D25\uFF1A${e.message}`, "error");
        return false;
      } finally {
        operationRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    }
    async function pruneNow() {
      if (await confirmDialog("\u7ACB\u5373\u4FEE\u526A", "\u786E\u5B9A\u8981\u7ACB\u5373\u542F\u52A8\u6570\u636E\u4FEE\u526A\u5668\u5417\uFF1F\u5728\u5927\u578B\u6D88\u606F\u5E93\u4E0A\u4FEE\u526A\u53EF\u80FD\u8017\u65F6\u8F83\u957F", { okLabel: "\u542F\u52A8" })) {
        try {
          await api.post("/extensions/datapruner/_start");
          toast("\u6570\u636E\u4FEE\u526A\u5668\u5DF2\u542F\u52A8");
        } catch (e) {
          toast(`\u542F\u52A8\u5931\u8D25\uFF1A${e.message}`, "error");
        }
        refreshStatus();
      }
    }
    async function stopPruner() {
      try {
        await api.post("/extensions/datapruner/_stop");
        toast("\u5DF2\u8BF7\u6C42\u505C\u6B62");
      } catch (e) {
        toast(`\u505C\u6B62\u5931\u8D25\uFF1A${e.message}`, "error");
      }
      refreshStatus();
    }
    React.useEffect(() => {
      mountedRef.current = true;
      load();
      return () => {
        mountedRef.current = false;
      };
    }, []);
    React.useEffect(() => {
      setSave(save);
      setTasks("\u6570\u636E\u4FEE\u526A\u5668\u4EFB\u52A1", [
        taskButton("\u5237\u65B0", "refresh", () => {
          load();
        }, { disabled: busy }),
        taskButton("\u4FDD\u5B58", "save", save, { primary: true, disabled: busy || phase !== "ready" }),
        taskButton("\u67E5\u770B\u4E8B\u4EF6", "events", () => platform3.router.navigate("/events")),
        taskButton("\u7ACB\u5373\u4FEE\u526A", "play", pruneNow),
        taskButton("\u505C\u6B62\u4FEE\u526A", "stop", stopPruner, { danger: true })
      ]);
    }, [
      busy,
      phase,
      enabled,
      blockSize,
      pruneEvents,
      maxEventAge,
      archiveEnabled,
      archiverBlockSize,
      includeAttachments,
      scheduleType,
      freqValue,
      freqUnit,
      pollTime,
      cronJobs,
      scheduleDirty,
      contentKey,
      encrypt,
      compressKey,
      passwordEnabled,
      password,
      encryptionType,
      rootFolder,
      filePattern,
      archiverDirty
    ]);
    React.useEffect(() => {
      if (phase === "ready") {
        cleanRef.current = snapshot();
        dirtyRef.current = false;
        markClean();
      }
    }, [phase]);
    React.useEffect(() => {
      if (cleanRef.current == null) return;
      const isDirty = snapshot() !== cleanRef.current;
      dirtyRef.current = isDirty;
      if (isDirty) markDirty();
      else markClean();
    }, [
      enabled,
      blockSize,
      pruneEvents,
      maxEventAge,
      archiveEnabled,
      archiverBlockSize,
      includeAttachments,
      contentKey,
      encrypt,
      compressKey,
      passwordEnabled,
      password,
      encryptionType,
      rootFolder,
      filePattern,
      scheduleType,
      freqValue,
      freqUnit,
      pollTime,
      cronJobs
    ]);
    if (phase === "loading") return /* @__PURE__ */ React.createElement(Loading, null);
    if (phase === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "dt-empty" }, /* @__PURE__ */ React.createElement("div", { className: "empty-icon" }, /* @__PURE__ */ React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: "30",
          height: "30",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.7",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        },
        /* @__PURE__ */ React.createElement("path", { d: "M12 3l9 16H3zM12 10v4M12 17.5v.5" })
      )), /* @__PURE__ */ React.createElement("div", null, "\u52A0\u8F7D\u5931\u8D25"), /* @__PURE__ */ React.createElement("div", { className: "text-text-faint mt-[13px]" }, errorMessage));
    }
    const attachmentsEnabled = archiveEnabled && contentKey === "xml";
    const passwordSectionEnabled = archiveEnabled && compressKey === "zip";
    const updateCronJob = (idx, key, value) => {
      setCronJobs(cronJobs.map((job, i) => i === idx ? { ...job, [key]: value } : job));
      setScheduleDirty(true);
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "\u72B6\u6001"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, statusState.phase === "loading" && /* @__PURE__ */ React.createElement(Loading, { text: "\u6B63\u5728\u52A0\u8F7D\u72B6\u6001\u2026" }), statusState.phase === "error" && /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, statusState.message), statusState.phase === "ready" && (statusState.pairs.length ? /* @__PURE__ */ React.createElement("dl", { className: "kv" }, statusState.pairs.map(([k, v], i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: `${k}-${i}` }, /* @__PURE__ */ React.createElement("dt", null, labelCase(k)), /* @__PURE__ */ React.createElement("dd", null, v)))) : /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, "\u672A\u4E0A\u62A5\u72B6\u6001")))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "\u8C03\u5EA6"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u542F\u7528"), /* @__PURE__ */ React.createElement(YesNo, { value: enabled, onChange: setEnabled })), hasSchedule ? /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "\u8C03\u5EA6\u65B9\u5F0F" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: scheduleType,
        disabled: !enabled,
        onChange: (e) => {
          setScheduleType(e.target.value);
          setScheduleDirty(true);
        }
      },
      /* @__PURE__ */ React.createElement("option", { value: "INTERVAL" }, "\u95F4\u9694"),
      /* @__PURE__ */ React.createElement("option", { value: "TIME" }, "\u65F6\u95F4"),
      /* @__PURE__ */ React.createElement("option", { value: "CRON" }, "Cron")
    )), scheduleType === "INTERVAL" && /* @__PURE__ */ React.createElement(Field, { label: "\u95F4\u9694", hint: "\u6362\u7B97\u4E3A\u6BEB\u79D2\u540E\u5FC5\u987B\u5728 1 \u81F3 24 \u5C0F\u65F6\u4E4B\u95F4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "0",
        step: "any",
        className: "max-w-[108px]",
        value: freqValue,
        disabled: !enabled,
        onInput: (e) => {
          setFreqValue(e.target.value);
          setScheduleDirty(true);
        },
        onChange: (e) => {
          setFreqValue(e.target.value);
          setScheduleDirty(true);
        }
      }
    ), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "max-w-[126px]",
        value: freqUnit,
        disabled: !enabled,
        onChange: (e) => {
          setFreqUnit(e.target.value);
          setScheduleDirty(true);
        }
      },
      /* @__PURE__ */ React.createElement("option", { value: "milliseconds" }, "\u6BEB\u79D2"),
      /* @__PURE__ */ React.createElement("option", { value: "seconds" }, "\u79D2"),
      /* @__PURE__ */ React.createElement("option", { value: "minutes" }, "\u5206\u949F"),
      /* @__PURE__ */ React.createElement("option", { value: "hours" }, "\u5C0F\u65F6")
    ))), scheduleType === "TIME" && /* @__PURE__ */ React.createElement(Field, { label: "\u65F6\u95F4", hint: "\u6BCF\u5929\u5728\u6B64\u65F6\u95F4\u4FEE\u526A\u4E00\u6B21" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "time",
        className: "max-w-[126px]",
        value: pollTime,
        disabled: !enabled,
        onInput: (e) => {
          setPollTime(e.target.value);
          setScheduleDirty(true);
        },
        onChange: (e) => {
          setPollTime(e.target.value);
          setScheduleDirty(true);
        }
      }
    )), scheduleType === "CRON" && /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("label", null, "Cron \u4EFB\u52A1"), /* @__PURE__ */ React.createElement("div", { className: "dt-wrap" }, /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "\u8868\u8FBE\u5F0F"), /* @__PURE__ */ React.createElement("th", null, "\u63CF\u8FF0"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, cronJobs.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 3, className: "text-text-faint" }, "\u672A\u5B9A\u4E49 Cron \u4EFB\u52A1")), cronJobs.map((job, idx) => /* @__PURE__ */ React.createElement("tr", { key: idx }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "w-full",
        value: job.expression,
        disabled: !enabled,
        placeholder: "0 0 */1 * * ?",
        onInput: (e) => updateCronJob(idx, "expression", e.target.value),
        onChange: (e) => updateCronJob(idx, "expression", e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "w-full",
        value: job.description,
        disabled: !enabled,
        onInput: (e) => updateCronJob(idx, "description", e.target.value),
        onChange: (e) => updateCronJob(idx, "description", e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-sm btn-danger",
        disabled: !enabled,
        onClick: () => {
          setCronJobs(cronJobs.filter((_, i) => i !== idx));
          setScheduleDirty(true);
        }
      },
      "\u5220\u9664"
    ))))))), /* @__PURE__ */ React.createElement("div", { className: "mt-[7px]" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-sm",
        disabled: !enabled,
        onClick: () => {
          setCronJobs([...cronJobs, { expression: "", description: "" }]);
          setScheduleDirty(true);
        }
      },
      "\u6DFB\u52A0"
    )), /* @__PURE__ */ React.createElement("div", { className: "hint mt-[5px]" }, "Quartz cron \u8868\u8FBE\u5F0F\uFF0C\u81F3\u5C11 6 \u4E2A\u5B57\u6BB5\uFF08\u79D2 \u5206 \u65F6 \u65E5 \u6708 \u5468 [\u5E74]\uFF09"))) : /* @__PURE__ */ React.createElement("div", { className: "hint" }, "\u65E0\u6CD5\u89E3\u6790\u8F6E\u8BE2\u8C03\u5EA6\uFF08pollingProperties\uFF09\uFF0C\u5C06\u539F\u6837\u4FDD\u7559"))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "\u4FEE\u526A\u8BBE\u7F6E"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "\u5757\u5927\u5C0F" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "50",
        value: blockSize,
        onInput: (e) => setBlockSize(e.target.value),
        onChange: (e) => setBlockSize(e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u4FEE\u526A\u4E8B\u4EF6"), /* @__PURE__ */ React.createElement(YesNo, { value: pruneEvents, onChange: setPruneEvents })), /* @__PURE__ */ React.createElement(Field, { label: "\u4FEE\u526A\u4E8B\u4EF6\u4FDD\u7559\u5929\u6570" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "1",
        value: maxEventAge,
        disabled: !pruneEvents,
        onInput: (e) => setMaxEventAge(e.target.value),
        onChange: (e) => setMaxEventAge(e.target.value)
      }
    ))))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "\u5F52\u6863\u8BBE\u7F6E"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u542F\u7528\u5F52\u6863"), /* @__PURE__ */ React.createElement(YesNo, { value: archiveEnabled, onChange: setArchiveEnabled })), /* @__PURE__ */ React.createElement(Field, { label: "\u5F52\u6863\u5668\u5757\u5927\u5C0F" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "1",
        value: archiverBlockSize,
        disabled: !archiveEnabled,
        onInput: (e) => setArchiverBlockSize(e.target.value),
        onChange: (e) => setArchiverBlockSize(e.target.value)
      }
    ))), hasArchiver ? /* @__PURE__ */ React.createElement("div", { className: "form-grid mt-[11px]" }, /* @__PURE__ */ React.createElement(Field, { label: "\u5185\u5BB9" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: contentKey,
        disabled: !archiveEnabled,
        onChange: (e) => {
          const key = e.target.value;
          setContentKey(key);
          if (key !== "xml" && includeAttachments !== null) setIncludeAttachments(false);
          setArchiverDirty(true);
        }
      },
      CONTENT_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.key, value: o.key }, o.label))
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u52A0\u5BC6"), /* @__PURE__ */ React.createElement("label", { className: "inline-flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: encrypt,
        disabled: !archiveEnabled,
        onChange: (e) => {
          setEncrypt(e.target.checked);
          setArchiverDirty(true);
        }
      }
    ), "\u52A0\u5BC6\u5BFC\u51FA\u7684\u5185\u5BB9")), includeAttachments !== null && /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u5305\u542B\u9644\u4EF6"), /* @__PURE__ */ React.createElement(
      YesNo,
      {
        value: includeAttachments,
        disabled: !attachmentsEnabled,
        onChange: (v) => {
          setIncludeAttachments(v);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "\u538B\u7F29\u65B9\u5F0F" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: compressKey,
        disabled: !archiveEnabled,
        onChange: (e) => {
          setCompressKey(e.target.value);
          setArchiverDirty(true);
        }
      },
      COMPRESS_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.key, value: o.key }, o.label))
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u5BC6\u7801\u4FDD\u62A4"), /* @__PURE__ */ React.createElement(
      YesNo,
      {
        value: passwordEnabled,
        disabled: !passwordSectionEnabled,
        onChange: (v) => {
          setPasswordEnabled(v);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "\u5BC6\u7801" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "password",
        value: password,
        disabled: !passwordSectionEnabled || !passwordEnabled,
        onInput: (e) => {
          setPassword(e.target.value);
          setArchiverDirty(true);
        },
        onChange: (e) => {
          setPassword(e.target.value);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "\u52A0\u5BC6\u7C7B\u578B" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: encryptionType,
        disabled: !passwordSectionEnabled || !passwordEnabled,
        onChange: (e) => {
          setEncryptionType(e.target.value);
          setArchiverDirty(true);
        }
      },
      ENCRYPTION_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label))
    )), /* @__PURE__ */ React.createElement("div", { className: "span-2 flex gap-3 items-stretch" }, /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-w-0 flex flex-col gap-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u6839\u8DEF\u5F84" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: rootInputRef,
        type: "text",
        value: rootFolder,
        disabled: !archiveEnabled,
        onFocus: () => {
          lastVarTargetRef.current = rootInputRef.current;
        },
        onDragOver: onArchiveVarDragOver,
        onDrop: onArchiveVarDrop,
        onInput: (e) => {
          setRootFolder(e.target.value);
          setArchiverDirty(true);
        },
        onChange: (e) => {
          setRootFolder(e.target.value);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "\u6587\u4EF6\u6A21\u5F0F" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: patternInputRef,
        type: "text",
        value: filePattern,
        disabled: !archiveEnabled,
        onFocus: () => {
          lastVarTargetRef.current = patternInputRef.current;
        },
        onDragOver: onArchiveVarDragOver,
        onDrop: onArchiveVarDrop,
        onInput: (e) => {
          setFilePattern(e.target.value);
          setArchiverDirty(true);
        },
        onChange: (e) => {
          setFilePattern(e.target.value);
          setArchiverDirty(true);
        }
      }
    ))), /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "border border-line rounded-[4px] py-1 min-w-[162px] max-w-[207px] bg-bg1 overflow-auto self-stretch",
        style: { opacity: archiveEnabled ? 1 : 0.5 },
        title: "\u62D6\u52A8\u53D8\u91CF\u5230\u6839\u8DEF\u5F84 / \u6587\u4EF6\u6A21\u5F0F\uFF0C\u6216\u70B9\u51FB\u63D2\u5165\u5230\u6700\u8FD1\u805A\u7126\u7684\u8F93\u5165\u6846"
      },
      ARCHIVE_VARS.map((v) => /* @__PURE__ */ React.createElement(
        "div",
        {
          key: v.label,
          draggable: archiveEnabled,
          className: "py-[3px] px-3 text-[11px] select-none cursor-grab hover:bg-bg2",
          onClick: () => archiveEnabled && insertArchiveVar(lastVarTargetRef.current || rootInputRef.current, v.token),
          onDragStart: (ev) => {
            ev.dataTransfer.clearData();
            ev.dataTransfer.setData(ARCHIVE_VAR_MIME, v.token);
            ev.dataTransfer.effectAllowed = "copy";
          }
        },
        v.label
      ))
    ))) : /* @__PURE__ */ React.createElement("div", { className: "hint mt-[11px]" }, "\u65E0\u6CD5\u89E3\u6790\u5F52\u6863\u9AD8\u7EA7\u9009\u9879\uFF08archiverOptions\uFF09\uFF0C\u5C06\u539F\u6837\u4FDD\u7559"))));
  }
  platform2.registerSettingsPanel({
    label: "Data Pruner",
    component: DataPrunerPanel
  });
}
export {
  register
};
