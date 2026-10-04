// plugins/datatype-ncpdp/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.ncpdp";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "\u62C6\u5206\u6279\u5904\u7406\u5E76\u8FD4\u56DE\u4E0B\u4E00\u6761\u6D88\u606F\u7684 JavaScript\uFF0C\u53EF\u8BBF\u95EE 'reader'\uFF08Java BufferedReader\uFF09\uFF0C\u8FD4\u56DE null/\u7A7A \u8868\u793A\u8F93\u5165\u7ED3\u675F\uFF1B\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528";
var DEF = {
  name: "NCPDP",
  label: "NCPDP",
  order: 80,
  propertiesClass: `${PKG}.NCPDPDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "\u5E8F\u5217\u5316",
      class: `${PKG}.NCPDPSerializationProperties`,
      fields: [
        text("fieldDelimiter", "\u5B57\u6BB5\u5206\u9694\u7B26", "0x1C", "\u5206\u9694\u6D88\u606F\u4E2D\u5B57\u6BB5\u7684\u5B57\u7B26"),
        text("groupDelimiter", "\u7EC4\u5206\u9694\u7B26", "0x1D", "\u5206\u9694\u6D88\u606F\u4E2D\u7EC4\u7684\u5B57\u7B26"),
        text("segmentDelimiter", "\u6BB5\u5206\u9694\u7B26", "0x1E", "\u5206\u9694\u6D88\u606F\u4E2D\u6BB5\u7684\u5B57\u7B26")
      ]
    },
    {
      key: "deserializationProperties",
      label: "\u53CD\u5E8F\u5217\u5316",
      class: `${PKG}.NCPDPDeserializationProperties`,
      fields: [
        text("fieldDelimiter", "\u5B57\u6BB5\u5206\u9694\u7B26", "0x1C", "\u5206\u9694\u6D88\u606F\u4E2D\u5B57\u6BB5\u7684\u5B57\u7B26"),
        text("groupDelimiter", "\u7EC4\u5206\u9694\u7B26", "0x1D", "\u5206\u9694\u6D88\u606F\u4E2D\u7EC4\u7684\u5B57\u7B26"),
        text("segmentDelimiter", "\u6BB5\u5206\u9694\u7B26", "0x1E", "\u5206\u9694\u6D88\u606F\u4E2D\u6BB5\u7684\u5B57\u7B26"),
        bool("useStrictValidation", "\u4F7F\u7528\u4E25\u683C\u6821\u9A8C", false, "\u6309\u6A21\u5F0F\uFF08schema\uFF09\u6821\u9A8C NCPDP \u6D88\u606F")
      ]
    },
    {
      key: "batchProperties",
      label: "\u6279\u5904\u7406",
      class: `${PKG}.NCPDPBatchProperties`,
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
