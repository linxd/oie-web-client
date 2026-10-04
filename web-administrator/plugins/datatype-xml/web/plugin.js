// plugins/datatype-xml/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.xml";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var num = (key, label, def, hint) => ({ key, label, type: "number", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "\u62C6\u5206\u6279\u5904\u7406\u5E76\u8FD4\u56DE\u4E0B\u4E00\u6761\u6D88\u606F\u7684 JavaScript\uFF0C\u53EF\u8BBF\u95EE 'reader'\uFF08Java BufferedReader\uFF09\uFF0C\u8FD4\u56DE null/\u7A7A \u8868\u793A\u8F93\u5165\u7ED3\u675F\uFF1B\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528";
var DEF = {
  name: "XML",
  label: "XML",
  order: 30,
  propertiesClass: `${PKG}.XMLDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "\u5E8F\u5217\u5316",
      class: `${PKG}.XMLSerializationProperties`,
      fields: [
        bool("stripNamespaces", "\u53BB\u9664\u547D\u540D\u7A7A\u95F4", false, "\u4ECE\u8F6C\u6362\u540E\u7684 XML \u6D88\u606F\u4E2D\u53BB\u9664\u547D\u540D\u7A7A\u95F4\u5B9A\u4E49\uFF08\u4E0D\u4F1A\u79FB\u9664\u524D\u7F00\uFF09")
      ]
    },
    {
      key: "batchProperties",
      label: "\u6279\u5904\u7406",
      class: `${PKG}.XMLBatchProperties`,
      fields: [
        opt("splitType", "\u6279\u5904\u7406\u62C6\u5206\u65B9\u5F0F", [
          { value: "Element_Name", label: "\u6309\u5143\u7D20\u540D" },
          { value: "Level", label: "\u6309\u5C42\u7EA7" },
          { value: "XPath_Query", label: "\u6309 XPath \u67E5\u8BE2" },
          { value: "JavaScript", label: "JavaScript" }
        ], "Element_Name", "\u62C6\u5206\u6279\u5904\u7406\u6D88\u606F\u7684\u65B9\u5F0F\uFF0C\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528"),
        text("elementName", "\u5143\u7D20\u540D", null, "\u5C06\u6BCF\u4E2A\u4F7F\u7528\u8BE5\u540D\u79F0\u7684\u5143\u7D20\u62C6\u5206\u4E3A\u72EC\u7ACB\u6D88\u606F"),
        num("level", "\u5C42\u7EA7", 1, "\u5C06\u6BCF\u4E2A\u5904\u4E8E\u8BE5\u5C42\u7EA7\u7684\u5143\u7D20\u62C6\u5206\u4E3A\u72EC\u7ACB\u6D88\u606F\uFF08\u6839\u5143\u7D20\u4E3A 0 \u7EA7\uFF09"),
        text("query", "XPath \u67E5\u8BE2", null, "\u5C06 XPath \u67E5\u8BE2\u547D\u4E2D\u7684\u6BCF\u4E2A\u5143\u7D20\u62C6\u5206\u4E3A\u72EC\u7ACB\u6D88\u606F"),
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
