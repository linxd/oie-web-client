// plugins/transformer-steps/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var SCOPES = [
  { value: "CHANNEL", label: "\u901A\u9053\u6620\u5C04" },
  { value: "CONNECTOR", label: "\u8FDE\u63A5\u5668\u6620\u5C04" },
  { value: "GLOBAL_CHANNEL", label: "\u5168\u5C40\u901A\u9053\u6620\u5C04" },
  { value: "GLOBAL", label: "\u5168\u5C40\u6620\u5C04" },
  { value: "RESPONSE", label: "\u54CD\u5E94\u6620\u5C04" }
];
var CONDITIONS = [
  { value: "EXISTS", label: "\u5B58\u5728" },
  { value: "NOT_EXIST", label: "\u4E0D\u5B58\u5728" },
  { value: "EQUALS", label: "\u7B49\u4E8E" },
  { value: "NOT_EQUAL", label: "\u4E0D\u7B49\u4E8E" },
  { value: "CONTAINS", label: "\u5305\u542B" },
  { value: "NOT_CONTAIN", label: "\u4E0D\u5305\u542B" }
];
var BEHAVIORS = [
  { value: "REMOVE", label: "\u79FB\u9664\u4EE5\u4E0B\u9879" },
  { value: "REMOVE_ALL_EXCEPT", label: "\u9664\u4EE5\u4E0B\u9879\u5916\u5168\u90E8\u79FB\u9664" },
  { value: "REMOVE_ALL", label: "\u5168\u90E8\u79FB\u9664" }
];
var CONDITION_USES_VALUES = /* @__PURE__ */ new Set(["EQUALS", "NOT_EQUAL", "CONTAINS", "NOT_CONTAIN"]);
var isBlank = (v) => v == null || String(v).trim() === "";
function stringListToLines(value) {
  if (!value || typeof value !== "object") return [];
  const list = value.string;
  if (list === null || list === void 0) return [];
  return (Array.isArray(list) ? list : [list]).map((v) => String(v ?? ""));
}
function linesToStringList(text) {
  const lines = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return lines.length ? { string: lines } : "";
}
function checkedIdSet(value) {
  if (!value || typeof value !== "object") return /* @__PURE__ */ new Set();
  const list = value.int;
  if (list === null || list === void 0) return /* @__PURE__ */ new Set();
  return new Set((Array.isArray(list) ? list : [list]).map((v) => String(v)));
}
function idSetToMetaData(set, destinations) {
  const ordered = destinations.map((d) => String(d.metaDataId)).filter((id) => set.has(id));
  for (const id of set) if (!ordered.includes(id)) ordered.push(id);
  return ordered.length ? { int: ordered } : "";
}
function stringArrayToList(arr) {
  return arr.length ? { string: arr.map((s) => String(s ?? "")) } : "";
}
function Field({ label, hint, children }) {
  return /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, label), children, hint ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, hint) : null);
}
function Select({ options, value, onChange }) {
  return /* @__PURE__ */ React.createElement("select", { value, onChange }, options.map((opt) => {
    const o = typeof opt === "object" ? opt : { value: opt, label: String(opt) };
    return /* @__PURE__ */ React.createElement("option", { key: String(o.value), value: o.value }, o.label);
  }));
}
function useRerender() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  return force;
}
function CodeEditorIsland({ value, minHeight, fill, onChange }) {
  const hostRef = React.useRef(null);
  const editorRef = React.useRef(null);
  React.useEffect(() => {
    const editor = platform.createCodeEditor({
      value: value ?? "",
      minHeight,
      popoutable: true,
      // full-screen code view; the transformer editor moves its
      popoutTitle: "JavaScript",
      // Reference/Templates/Trees panel in (oie:code-view)
      onChange
    });
    editorRef.current = editor;
    if (fill) {
      editor.el.style.flex = "1";
      editor.el.style.minHeight = "0";
    }
    hostRef.current.appendChild(editor.el);
    return () => {
      if (editor.el && editor.el.parentNode) editor.el.parentNode.removeChild(editor.el);
      editorRef.current = null;
    };
  }, []);
  return /* @__PURE__ */ React.createElement("div", { ref: hostRef, style: fill ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : void 0 });
}
function ScriptEditor({ element, onChange }) {
  return /* @__PURE__ */ React.createElement(Field, { label: "\u811A\u672C" }, /* @__PURE__ */ React.createElement(
    CodeEditorIsland,
    {
      value: element.script ?? "",
      minHeight: "260px",
      fill: true,
      onChange: (value) => {
        element.script = value;
        onChange();
      }
    }
  ));
}
function ScriptPathEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement(
    Field,
    {
      label: "\u811A\u672C\u8DEF\u5F84",
      hint: "\u670D\u52A1\u5668\u4E0A JavaScript \u6587\u4EF6\u7684\u8DEF\u5F84\u2014\u2014\u901A\u9053\u90E8\u7F72\u65F6\u5C06\u52A0\u8F7D\u5176\u5185\u5BB9"
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: "/opt/scripts/example.js",
        value: element.scriptPath ?? "",
        onChange: (e) => {
          element.scriptPath = e.target.value;
          onChange();
          force();
        }
      }
    )
  );
}
function emptyIteratorProperties() {
  return { target: "", indexVariable: "i", prefixSubstitutions: "", children: "" };
}
function makeIteratorEditor(isRule) {
  const type = isRule ? "com.mirth.connect.model.IteratorRule" : "com.mirth.connect.model.IteratorStep";
  const childNoun = isRule ? "\u89C4\u5219" : "\u6B65\u9AA4";
  function IteratorEditor({ element, onChange }) {
    const force = useRerender();
    if (!element.properties || typeof element.properties !== "object") {
      element.properties = emptyIteratorProperties();
    }
    const props = element.properties;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(
      Field,
      {
        label: "\u8FED\u4EE3\u5BF9\u8C61\uFF08\u76EE\u6807\uFF09",
        hint: "\u8981\u8FED\u4EE3\u7684 E4X XML \u8282\u70B9\u5217\u8868\u6216 JavaScript \u6570\u7EC4"
      },
      /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "text",
          placeholder: "msg['OBX']",
          value: props.target ?? "",
          onChange: (e) => {
            props.target = e.target.value;
            onChange();
            force();
          }
        }
      )
    ), /* @__PURE__ */ React.createElement(Field, { label: "\u7D22\u5F15\u53D8\u91CF" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: props.indexVariable ?? "i",
        onChange: (e) => {
          props.indexVariable = e.target.value;
          onChange();
          force();
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(
      Field,
      {
        label: "\u524D\u7F00\u66FF\u6362",
        hint: "\u6BCF\u884C\u4E00\u4E2A\u524D\u7F00\u2014\u2014\u628A\u53D6\u503C\u62D6\u5165\u5B50\u9879\u65F6\uFF0C\u7D22\u5F15\u53D8\u91CF\uFF08\u5982 [i]\uFF09\u4F1A\u6CE8\u5165\u5230\u8FD9\u4E9B\u524D\u7F00\u4E4B\u540E"
      },
      /* @__PURE__ */ React.createElement(
        "textarea",
        {
          rows: 3,
          placeholder: "msg['OBX']",
          value: stringListToLines(props.prefixSubstitutions).join("\n"),
          onChange: (e) => {
            props.prefixSubstitutions = linesToStringList(e.target.value);
            onChange();
            force();
          }
        }
      )
    ))), /* @__PURE__ */ React.createElement("div", { className: "text-text-faint pt-2.5 px-0 pb-0 text-[10px]" }, `\u5B50${childNoun}\u4F1A\u5D4C\u5957\u663E\u793A\u5728\u6B64\u8FED\u4EE3\u5668\u4E4B\u4E0B \xB7 \u9009\u4E2D\u5B50\u9879\u65F6\u53EF\u6DFB\u52A0${childNoun}\uFF0C\u6216\u53F3\u952E\u70B9\u51FB${childNoun}\u5E76\u9009\u62E9"\u6307\u6D3E\u7ED9\u8FED\u4EE3\u5668"`));
  }
  return {
    label: "\u8FED\u4EE3\u5668",
    create: () => ({
      __type: type,
      name: "",
      enabled: true,
      ...isRule ? { operator: "AND" } : null,
      properties: emptyIteratorProperties()
    }),
    validate: (el) => {
      const p = el.properties || {};
      let m = "";
      if (isBlank(p.target)) m += "\u8FED\u4EE3\u76EE\u6807\u8868\u8FBE\u5F0F\u4E0D\u80FD\u4E3A\u7A7A\n";
      if (isBlank(p.indexVariable)) m += "\u8FED\u4EE3\u7D22\u5F15\u53D8\u91CF\u4E0D\u80FD\u4E3A\u7A7A\n";
      return m.trim();
    },
    component: IteratorEditor
  };
}
function MapperEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "\u53D8\u91CF" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.variable ?? "",
      onChange: (e) => {
        element.variable = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "\u6DFB\u52A0\u5230" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: SCOPES,
      value: element.scope || "CHANNEL",
      onChange: (e) => {
        element.scope = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u6620\u5C04" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.mapping ?? "",
      onChange: (e) => {
        element.mapping = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u9ED8\u8BA4\u503C" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.defaultValue ?? "",
      onChange: (e) => {
        element.defaultValue = e.target.value;
        onChange();
        force();
      }
    }
  ))));
}
function MessageBuilderEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u6D88\u606F\u6BB5" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "tmp['MSH']['MSH.3']['MSH.3.1']",
      value: element.messageSegment ?? "",
      onChange: (e) => {
        element.messageSegment = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u6620\u5C04" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.mapping ?? "",
      onChange: (e) => {
        element.mapping = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u9ED8\u8BA4\u503C" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.defaultValue ?? "",
      onChange: (e) => {
        element.defaultValue = e.target.value;
        onChange();
        force();
      }
    }
  ))));
}
function XsltEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "\u6E90 XML \u5B57\u7B26\u4E32" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "msg",
      value: element.sourceXml ?? "",
      onChange: (e) => {
        element.sourceXml = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "\u7ED3\u679C\u53D8\u91CF" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.resultVariable ?? "",
      onChange: (e) => {
        element.resultVariable = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement(Field, { label: "XSLT \u6A21\u677F" }, /* @__PURE__ */ React.createElement(
    CodeEditorIsland,
    {
      value: element.template ?? "",
      minHeight: "220px",
      onChange: (value) => {
        element.template = value;
        onChange();
      }
    }
  )));
}
var dsfUid = 0;
function DestinationSetFilterEditor({ element, onChange, destinations }) {
  const force = useRerender();
  const [selValue, setSelValue] = React.useState(-1);
  const uid = React.useMemo(() => ++dsfUid, []);
  const dests = Array.isArray(destinations) ? destinations : [];
  const behavior = element.behavior || "REMOVE";
  const condition = element.condition || "EXISTS";
  const checked = checkedIdSet(element.metaDataIds);
  const values = stringListToLines(element.values);
  const listDisabled = behavior === "REMOVE_ALL";
  const valuesEnabled = CONDITION_USES_VALUES.has(condition);
  const setChecked = (next) => {
    element.metaDataIds = idSetToMetaData(next, dests);
    onChange();
    force();
  };
  const toggleId = (id, on) => {
    const next = new Set(checked);
    if (on) next.add(String(id));
    else next.delete(String(id));
    setChecked(next);
  };
  const selectAll = () => setChecked(new Set(dests.map((d) => String(d.metaDataId))));
  const deselectAll = () => setChecked(/* @__PURE__ */ new Set());
  const setValues = (arr) => {
    element.values = stringArrayToList(arr);
    onChange();
    force();
  };
  const newValue = () => {
    setValues([...values, ""]);
    setSelValue(values.length);
  };
  const editValue = (i, v) => {
    const next = values.slice();
    next[i] = v;
    setValues(next);
  };
  const deleteSelected = () => {
    if (selValue < 0 || selValue >= values.length) return;
    const next = values.slice();
    next.splice(selValue, 1);
    setValues(next);
    setSelValue(next.length ? Math.min(selValue, next.length - 1) : -1);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "\u884C\u4E3A" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: BEHAVIORS,
      value: behavior,
      onChange: (e) => {
        element.behavior = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "\u5B57\u6BB5" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "msg['PID']['PID.3']['PID.3.1'].toString()",
      value: element.field ?? "",
      onChange: (e) => {
        element.field = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u76EE\u7684\u5730" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mb-1.5" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: listDisabled, onClick: selectAll }, "\u5168\u9009"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: listDisabled, onClick: deselectAll }, "\u5168\u4E0D\u9009")), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "dt-wrap border border-line rounded max-h-[162px]",
      style: listDisabled ? { opacity: 0.5, pointerEvents: "none" } : void 0
    },
    /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "w-[38px]" }), /* @__PURE__ */ React.createElement("th", null, "\u540D\u79F0"), /* @__PURE__ */ React.createElement("th", { className: "w-[63px]" }, "ID"))), /* @__PURE__ */ React.createElement("tbody", null, dests.length ? dests.map((d) => {
      const id = String(d.metaDataId);
      return /* @__PURE__ */ React.createElement("tr", { key: id }, /* @__PURE__ */ React.createElement("td", { className: "text-center" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          checked: checked.has(id),
          disabled: listDisabled,
          onChange: (e) => toggleId(id, e.target.checked)
        }
      )), /* @__PURE__ */ React.createElement("td", null, d.name || `\u76EE\u7684\u5730 ${id}`), /* @__PURE__ */ React.createElement("td", { className: "num" }, id));
    }) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 3 }, /* @__PURE__ */ React.createElement("span", { className: "text-text-faint" }, "\u8BE5\u901A\u9053\u6682\u65E0\u76EE\u7684\u5730")))))
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u6761\u4EF6" }, /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row" }, CONDITIONS.map((opt) => /* @__PURE__ */ React.createElement("label", { className: "check", key: opt.value }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "radio",
      name: `dsf-condition-${uid}`,
      checked: condition === opt.value,
      onChange: () => {
        element.condition = opt.value;
        onChange();
        force();
      }
    }
  ), opt.label))))), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u503C" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mb-1.5" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: !valuesEnabled, onClick: newValue }, "\u65B0\u5EFA"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "btn btn-sm btn-danger",
      disabled: !valuesEnabled || selValue < 0 || selValue >= values.length,
      onClick: deleteSelected
    },
    "\u5220\u9664"
  )), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "dt-wrap border border-line rounded max-h-[162px]",
      style: !valuesEnabled ? { opacity: 0.5, pointerEvents: "none" } : void 0
    },
    /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "\u503C"))), /* @__PURE__ */ React.createElement("tbody", null, values.length ? values.map((v, i) => /* @__PURE__ */ React.createElement(
      "tr",
      {
        key: i,
        className: selValue === i ? "selected" : void 0,
        onClick: () => setSelValue(i)
      },
      /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "text",
          value: v,
          disabled: !valuesEnabled,
          onFocus: () => setSelValue(i),
          onChange: (e) => editValue(i, e.target.value)
        }
      ))
    )) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "text-text-faint" }, "\u6682\u65E0\u503C\u2014\u2014\u8BF7\u70B9\u51FB\u65B0\u5EFA")))))
  ))));
}
function RuleBuilderEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "\u5B57\u6BB5" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "msg['MSH']['MSH.9']['MSH.9.1'].toString()",
      value: element.field ?? "",
      onChange: (e) => {
        element.field = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "\u6761\u4EF6" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: CONDITIONS,
      value: element.condition || "EXISTS",
      onChange: (e) => {
        element.condition = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "\u503C" }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: 4,
      placeholder: "\u6BCF\u884C\u4E00\u4E2A\u503C",
      title: "\u4EC5\u5728\u7B49\u4E8E / \u4E0D\u7B49\u4E8E / \u5305\u542B / \u4E0D\u5305\u542B\u65F6\u4F7F\u7528",
      value: stringListToLines(element.values).join("\n"),
      onChange: (e) => {
        element.values = linesToStringList(e.target.value);
        onChange();
        force();
      }
    }
  ))));
}
function register(platform2) {
  platform2.registerStepType("com.mirth.connect.plugins.javascriptstep.JavaScriptStep", {
    label: "JavaScript",
    create: () => ({
      __type: "com.mirth.connect.plugins.javascriptstep.JavaScriptStep",
      name: "",
      enabled: true,
      script: "// Write your JavaScript here\n"
    }),
    component: ScriptEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.mapper.MapperStep", {
    label: "\u6620\u5C04\u5668",
    create: () => ({
      __type: "com.mirth.connect.plugins.mapper.MapperStep",
      name: "",
      enabled: true,
      variable: "",
      mapping: "",
      defaultValue: "",
      replacements: "",
      scope: "CHANNEL"
    }),
    validate: (el) => isBlank(el.variable) ? "\u53D8\u91CF\u540D\u4E0D\u80FD\u4E3A\u7A7A" : "",
    component: MapperEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.messagebuilder.MessageBuilderStep", {
    label: "\u6D88\u606F\u6784\u5EFA\u5668",
    create: () => ({
      __type: "com.mirth.connect.plugins.messagebuilder.MessageBuilderStep",
      name: "",
      enabled: true,
      messageSegment: "",
      mapping: "",
      defaultValue: "",
      replacements: ""
    }),
    validate: (el) => isBlank(el.messageSegment) ? "\u6D88\u606F\u6BB5\u503C\u4E0D\u80FD\u4E3A\u7A7A" : "",
    component: MessageBuilderEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.xsltstep.XsltStep", {
    label: "XSLT \u6B65\u9AA4",
    create: () => ({
      __type: "com.mirth.connect.plugins.xsltstep.XsltStep",
      name: "",
      enabled: true,
      sourceXml: "",
      resultVariable: "",
      template: "",
      useCustomFactory: false,
      customFactory: ""
    }),
    validate: (el) => {
      let m = "";
      if (isBlank(el.sourceXml)) m += "\u6E90 XML \u5B57\u7B26\u4E32\u4E0D\u80FD\u4E3A\u7A7A\n";
      if (isBlank(el.resultVariable)) m += "\u7ED3\u679C\u53D8\u91CF\u4E0D\u80FD\u4E3A\u7A7A\n";
      return m.trim();
    },
    component: XsltEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep", {
    label: "\u76EE\u7684\u5730\u96C6\u8FC7\u6EE4\u5668",
    // Only available on the source transformer (DestinationSetFilterPlugin
    // .onlySourceConnector()); destinations/response transformers exclude it.
    onlySource: true,
    create: () => ({
      __type: "com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep",
      name: "",
      enabled: true,
      behavior: "REMOVE",
      metaDataIds: "",
      field: "",
      condition: "EXISTS",
      values: ""
    }),
    validate: (el) => isBlank(el.field) ? "\u5B57\u6BB5\u4E0D\u80FD\u4E3A\u7A7A" : "",
    component: DestinationSetFilterEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep", {
    label: "\u5916\u90E8\u811A\u672C",
    create: () => ({
      __type: "com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep",
      name: "",
      enabled: true,
      scriptPath: ""
    }),
    validate: (el) => isBlank(el.scriptPath) ? "\u811A\u672C\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A" : "",
    component: ScriptPathEditor
  });
  platform2.registerStepType("com.mirth.connect.model.IteratorStep", makeIteratorEditor(false));
  platform2.registerRuleType("com.mirth.connect.plugins.javascriptrule.JavaScriptRule", {
    label: "JavaScript",
    create: () => ({
      __type: "com.mirth.connect.plugins.javascriptrule.JavaScriptRule",
      name: "",
      enabled: true,
      operator: "AND",
      script: "// Return true to accept the message, false to filter it\nreturn true;"
    }),
    component: ScriptEditor
  });
  platform2.registerRuleType("com.mirth.connect.plugins.rulebuilder.RuleBuilderRule", {
    label: "\u89C4\u5219\u6784\u5EFA\u5668",
    create: () => ({
      __type: "com.mirth.connect.plugins.rulebuilder.RuleBuilderRule",
      name: "",
      enabled: true,
      operator: "AND",
      field: "",
      condition: "EXISTS",
      values: ""
    }),
    validate: (el) => isBlank(el.field) ? "\u5B57\u6BB5\u4E0D\u80FD\u4E3A\u7A7A" : "",
    component: RuleBuilderEditor
  });
  platform2.registerRuleType("com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule", {
    label: "\u5916\u90E8\u811A\u672C",
    create: () => ({
      __type: "com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule",
      name: "",
      enabled: true,
      operator: "AND",
      scriptPath: ""
    }),
    validate: (el) => isBlank(el.scriptPath) ? "\u811A\u672C\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A" : "",
    component: ScriptPathEditor
  });
  platform2.registerRuleType("com.mirth.connect.model.IteratorRule", makeIteratorEditor(true));
}
export {
  register
};
