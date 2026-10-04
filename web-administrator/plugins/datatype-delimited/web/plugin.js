// plugins/datatype-delimited/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.delimited";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var num = (key, label, def, hint) => ({ key, label, type: "number", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var list = (key, label, item, hint) => ({ key, label, type: "list", item, xmlNames: item === "string", hint });
var BATCH_SCRIPT_HINT = "\u62C6\u5206\u6279\u5904\u7406\u5E76\u8FD4\u56DE\u4E0B\u4E00\u6761\u6D88\u606F\u7684 JavaScript\uFF0C\u53EF\u8BBF\u95EE 'reader'\uFF08Java BufferedReader\uFF09\uFF0C\u8FD4\u56DE null/\u7A7A \u8868\u793A\u8F93\u5165\u7ED3\u675F\uFF1B\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528";
var DEF = {
  name: "DELIMITED",
  label: "\u5206\u9694\u6587\u672C",
  order: 60,
  propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "\u5E8F\u5217\u5316",
      class: `${PKG}.DelimitedSerializationProperties`,
      fields: [
        text("columnDelimiter", "\u5217\u5206\u9694\u7B26", ",", "\u5206\u9694\u5217\u7684\u5B57\u7B26\uFF08\u4F8B\u5982 CSV \u6587\u4EF6\u4E2D\u7684\u9017\u53F7\uFF09"),
        text("recordDelimiter", "\u8BB0\u5F55\u5206\u9694\u7B26", "\\n", "\u5206\u9694\u6BCF\u6761\u8BB0\u5F55\u7684\u5B57\u7B26\uFF08\u4F8B\u5982 CSV \u6587\u4EF6\u4E2D\u7684\u6362\u884C\u7B26\uFF09"),
        list("columnWidths", "\u5217\u5BBD", "int", "\u9017\u53F7\u5206\u9694\u7684\u6B63\u6574\u6570\u56FA\u5B9A\u5217\u5BBD\u5217\u8868\uFF1B\u5206\u9694\u5F0F\u5217\u8BF7\u7559\u7A7A"),
        text("quoteToken", "\u5F15\u53F7\u7B26", '"', "\u7528\u4E8E\u5305\u88F9\u542B\u5185\u5D4C\u7279\u6B8A\u5B57\u7B26\u53D6\u503C\u7684\u5F15\u53F7\u5B57\u7B26"),
        bool("escapeWithDoubleQuote", "\u53CC\u5F15\u53F7\u8F6C\u4E49", true, "\u8FDE\u7EED\u4E24\u4E2A\u5F15\u53F7\u7B26\u8868\u793A\u5185\u5D4C\u5F15\u53F7\uFF1B\u53D6\u6D88\u52FE\u9009\u5219\u6539\u7528\u8F6C\u4E49\u7B26"),
        text("quoteEscapeToken", "\u8F6C\u4E49\u7B26", "\\", "\u7528\u4E8E\u8F6C\u4E49\u5185\u5D4C\u5F15\u53F7\u7684\u5B57\u7B26\uFF08\u4EC5\u5728\u672A\u52FE\u9009\u53CC\u5F15\u53F7\u8F6C\u4E49\u65F6\u751F\u6548\uFF09"),
        list("columnNames", "\u5217\u540D", "string", "\u9017\u53F7\u5206\u9694\u7684 XML \u5217\u540D\u5217\u8868\uFF0C\u8986\u76D6\u9ED8\u8BA4\u5217\u540D\uFF08column1\u2026columnN\uFF09"),
        bool("numberedRows", "\u884C\u7F16\u53F7", false, "\u5728\u6D88\u606F\u7684 XML \u8868\u793A\u4E2D\u4E3A\u6BCF\u884C\u7F16\u53F7"),
        bool("ignoreCR", "\u5FFD\u7565\u56DE\u8F66\u7B26", true, "\u8DF3\u8FC7\u56DE\u8F66\u7B26\uFF08\\r\uFF09\uFF0C\u4E0D\u4F5C\u5904\u7406")
      ]
    },
    {
      key: "deserializationProperties",
      label: "\u53CD\u5E8F\u5217\u5316",
      class: `${PKG}.DelimitedDeserializationProperties`,
      fields: [
        text("columnDelimiter", "\u5217\u5206\u9694\u7B26", ",", "\u5206\u9694\u5217\u7684\u5B57\u7B26\uFF08\u4F8B\u5982 CSV \u6587\u4EF6\u4E2D\u7684\u9017\u53F7\uFF09"),
        text("recordDelimiter", "\u8BB0\u5F55\u5206\u9694\u7B26", "\\n", "\u5206\u9694\u6BCF\u6761\u8BB0\u5F55\u7684\u5B57\u7B26\uFF08\u4F8B\u5982 CSV \u6587\u4EF6\u4E2D\u7684\u6362\u884C\u7B26\uFF09"),
        list("columnWidths", "\u5217\u5BBD", "int", "\u9017\u53F7\u5206\u9694\u7684\u6B63\u6574\u6570\u56FA\u5B9A\u5217\u5BBD\u5217\u8868\uFF1B\u5206\u9694\u5F0F\u5217\u8BF7\u7559\u7A7A"),
        text("quoteToken", "\u5F15\u53F7\u7B26", '"', "\u7528\u4E8E\u5305\u88F9\u542B\u5185\u5D4C\u7279\u6B8A\u5B57\u7B26\u53D6\u503C\u7684\u5F15\u53F7\u5B57\u7B26"),
        bool("escapeWithDoubleQuote", "\u53CC\u5F15\u53F7\u8F6C\u4E49", true, "\u8FDE\u7EED\u4E24\u4E2A\u5F15\u53F7\u7B26\u8868\u793A\u5185\u5D4C\u5F15\u53F7\uFF1B\u53D6\u6D88\u52FE\u9009\u5219\u6539\u7528\u8F6C\u4E49\u7B26"),
        text("quoteEscapeToken", "\u8F6C\u4E49\u7B26", "\\", "\u7528\u4E8E\u8F6C\u4E49\u5185\u5D4C\u5F15\u53F7\u7684\u5B57\u7B26\uFF08\u4EC5\u5728\u672A\u52FE\u9009\u53CC\u5F15\u53F7\u8F6C\u4E49\u65F6\u751F\u6548\uFF09")
      ]
    },
    {
      key: "batchProperties",
      label: "\u6279\u5904\u7406",
      class: `${PKG}.DelimitedBatchProperties`,
      fields: [
        opt("splitType", "\u6279\u5904\u7406\u62C6\u5206\u65B9\u5F0F", [
          { value: "Record", label: "\u6309\u8BB0\u5F55" },
          { value: "Delimiter", label: "\u6309\u5206\u9694\u7B26" },
          { value: "Grouping_Column", label: "\u6309\u5206\u7EC4\u5217" },
          { value: "JavaScript", label: "JavaScript" }
        ], "Record", "\u62C6\u5206\u6279\u5904\u7406\u6D88\u606F\u7684\u65B9\u5F0F\uFF0C\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528"),
        num("batchSkipRecords", "\u5934\u90E8\u8BB0\u5F55\u6570", 0, "\u8981\u8DF3\u8FC7\u7684\u5934\u90E8\u8BB0\u5F55\u6570"),
        text("batchMessageDelimiter", "\u6279\u5904\u7406\u5206\u9694\u7B26", null, "\u5206\u9694\u6D88\u606F\u7684\u5206\u9694\u7B26\uFF08\u5B57\u7B26\u5E8F\u5217\uFF09"),
        bool("batchMessageDelimiterIncluded", "\u5305\u542B\u6279\u5904\u7406\u5206\u9694\u7B26", false, "\u5728\u6279\u5904\u7406\u5668\u8FD4\u56DE\u7684\u6D88\u606F\u4E2D\u5305\u542B\u6279\u5904\u7406\u5206\u9694\u7B26"),
        text("batchGroupingColumn", "\u5206\u7EC4\u5217", null, "\u7528\u4E8E\u5206\u7EC4\u8BB0\u5F55\u7684\u5217\uFF1B\u5176\u503C\u53D8\u5316\u5373\u6807\u5FD7\u6D88\u606F\u8FB9\u754C"),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    }
  ]
};
DEF.defaults = (version) => {
  const props = { "@class": DEF.propertiesClass, "@version": version };
  for (const group of DEF.groups) {
    const obj = { "@class": group.class, "@version": version };
    for (const f of group.fields) {
      if (f.type !== "list") obj[f.key] = f.default ?? null;
    }
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
