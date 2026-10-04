// plugins/datatype-raw/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.raw";
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "\u62C6\u5206\u6279\u5904\u7406\u5E76\u8FD4\u56DE\u4E0B\u4E00\u6761\u6D88\u606F\u7684 JavaScript\uFF0C\u53EF\u8BBF\u95EE 'reader'\uFF08Java BufferedReader\uFF09\uFF0C\u8FD4\u56DE null/\u7A7A \u8868\u793A\u8F93\u5165\u7ED3\u675F\uFF1B\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528";
var DEF = {
  name: "RAW",
  label: "Raw",
  order: 50,
  propertiesClass: `${PKG}.RawDataTypeProperties`,
  groups: [
    {
      key: "batchProperties",
      label: "\u6279\u5904\u7406",
      class: `${PKG}.RawBatchProperties`,
      fields: [
        opt(
          "splitType",
          "\u6279\u5904\u7406\u62C6\u5206\u65B9\u5F0F",
          [{ value: "JavaScript", label: "JavaScript" }],
          "JavaScript",
          "\u62C6\u5206\u6279\u5904\u7406\u6D88\u606F\u7684\u65B9\u5F0F\uFF0C\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528"
        ),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    }
  ]
};
DEF.defaults = (version) => {
  const props = { "@class": DEF.propertiesClass, "@version": version };
  for (const group of DEF.groups) {
    const obj = { "@class": group.class, "@version": version };
    for (const f of group.fields) obj[f.key] = f.default ?? null;
    props[group.key] = obj;
  }
  return props;
};
function register(platform2) {
  platform2.registerDataType(DEF.name, DEF);
}
export {
  register
};
