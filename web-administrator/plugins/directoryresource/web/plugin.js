// plugins/directoryresource/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var DIRECTORY_RESOURCE_CLASS = "com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties";
function register(platform2) {
  function LoadedLibraries({ entry, api }) {
    const [state, setState] = React.useState({ phase: "loading", libs: [] });
    const id = entry.obj.id;
    React.useEffect(() => {
      let cancelled = false;
      setState({ phase: "loading", libs: [] });
      (async () => {
        try {
          const raw = await api.get(`/extensions/directoryresource/resources/${encodeURIComponent(id)}/libraries`);
          const libs = api.asList(raw, "string").map(String).filter((s) => s !== "");
          if (cancelled) return;
          setState({ phase: "ready", libs });
        } catch (e) {
          if (cancelled) return;
          setState({ phase: "error", libs: [] });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [id, api]);
    if (state.phase === "loading") {
      return /* @__PURE__ */ React.createElement("div", { className: "loading-block" }, /* @__PURE__ */ React.createElement("div", { className: "spinner" }), "\u6B63\u5728\u52A0\u8F7D\u5E93\u2026");
    }
    if (state.phase === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, "\u65E0\u6CD5\u83B7\u53D6\u5E93\u5217\u8868");
    }
    if (!state.libs.length) {
      return /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, "\u672A\u52A0\u8F7D\u4EFB\u4F55\u5E93");
    }
    return /* @__PURE__ */ React.createElement("ul", { className: "m-0 pl-[16px] max-h-[162px] overflow-auto font-mono text-[11px]" }, state.libs.map((l, i) => /* @__PURE__ */ React.createElement("li", { key: `${i}-${l}` }, l)));
  }
  function DirectoryDetail({ entry, locked, platform: platform3, refreshTable }) {
    const obj = entry.obj;
    const [name, setName] = React.useState(obj.name || "");
    const [directory, setDirectory] = React.useState(obj.directory || "");
    const [recursion, setRecursion] = React.useState(obj.directoryRecursion !== false);
    const [description, setDescription] = React.useState(obj.description || "");
    return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u540D\u79F0"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: name,
        disabled: locked,
        onInput: (e) => {
          obj.name = e.target.value;
          setName(e.target.value);
        },
        onChange: (e) => {
          obj.name = e.target.value;
          setName(e.target.value);
        },
        onBlur: () => {
          if (refreshTable) refreshTable();
        }
      }
    ), locked ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, "\u7F3A\u7701\u8D44\u6E90\u4E0D\u80FD\u91CD\u547D\u540D") : null), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u76EE\u5F55"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: directory,
        disabled: locked,
        onInput: (e) => {
          obj.directory = e.target.value;
          setDirectory(e.target.value);
        },
        onChange: (e) => {
          obj.directory = e.target.value;
          setDirectory(e.target.value);
        }
      }
    ), locked ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, "\u7F3A\u7701\u8D44\u6E90\u7684\u76EE\u5F55\u4E0D\u80FD\u66F4\u6539") : null), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\u5B50\u76EE\u5F55"), /* @__PURE__ */ React.createElement("label", { className: "check" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: recursion,
        onChange: (e) => {
          obj.directoryRecursion = e.target.checked;
          setRecursion(e.target.checked);
        }
      }
    ), "\u5305\u542B\u6240\u6709\u5B50\u76EE\u5F55")), /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("label", null, "\u63CF\u8FF0"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: description,
        onInput: (e) => {
          obj.description = e.target.value;
          setDescription(e.target.value);
        },
        onChange: (e) => {
          obj.description = e.target.value;
          setDescription(e.target.value);
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("label", null, "\u5DF2\u52A0\u8F7D\u7684\u5E93"), /* @__PURE__ */ React.createElement(LoadedLibraries, { entry, api: platform3.api })));
  }
  platform2.registerResourceType("Directory", {
    type: "Directory",
    label: "\u76EE\u5F55",
    propertiesClass: DIRECTORY_RESOURCE_CLASS,
    detailHeader: "\u76EE\u5F55\u8BBE\u7F6E",
    /* New directory resource. ctx: { version, containerIsArray } — version
       mirrors an existing entry so the engine doesn't migrate from scratch;
       the @class is only needed for the array-shaped container. */
    create({ version, containerIsArray }) {
      const obj = {};
      if (version) obj["@version"] = version;
      if (containerIsArray) obj["@class"] = DIRECTORY_RESOURCE_CLASS;
      obj.pluginPointName = "Directory Resource";
      obj.type = "Directory";
      obj.id = crypto.randomUUID();
      obj.name = "";
      obj.description = "";
      obj.includeWithGlobalScripts = false;
      obj.loadParentFirst = false;
      obj.directory = "";
      obj.directoryRecursion = true;
      return obj;
    },
    // The detail editor is now a React component (was renderDetail(host, ctx));
    // the Resources panel renders <def.component {...ctx}/> via <PluginSlot>.
    component: DirectoryDetail
  });
}
export {
  register
};
