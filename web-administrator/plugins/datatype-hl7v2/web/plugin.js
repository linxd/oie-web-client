// plugins/datatype-hl7v2/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PKG = "com.mirth.connect.plugins.datatypes.hl7v2";
var text = (key, label, def, hint) => ({ key, label, type: "text", default: def, hint });
var bool = (key, label, def, hint) => ({ key, label, type: "checkbox", default: def, hint });
var opt = (key, label, options, def, hint) => ({ key, label, type: "select", options, default: def, hint });
var code = (key, label, def, hint) => ({ key, label, type: "code", default: def, hint });
var BATCH_SCRIPT_HINT = "\u62C6\u5206\u6279\u5904\u7406\u5E76\u8FD4\u56DE\u4E0B\u4E00\u6761\u6D88\u606F\u7684 JavaScript\uFF0C\u53EF\u8BBF\u95EE 'reader'\uFF08Java BufferedReader\uFF09\uFF0C\u8FD4\u56DE null/\u7A7A \u8868\u793A\u8F93\u5165\u7ED3\u675F\uFF1B\u4EC5\u5728\u8FDE\u63A5\u5668\u4E2D\u542F\u7528\u6279\u5904\u7406\u65F6\u4F7F\u7528";
var DEF = {
  name: "HL7V2",
  label: "HL7 v2.x",
  order: 10,
  propertiesClass: `${PKG}.HL7v2DataTypeProperties`,
  groups: [
    {
      key: "serializationProperties",
      label: "\u5E8F\u5217\u5316",
      class: `${PKG}.HL7v2SerializationProperties`,
      fields: [
        bool("handleRepetitions", "\u89E3\u6790\u5B57\u6BB5\u91CD\u590D", true, "\u89E3\u6790\u5B57\u6BB5\u91CD\u590D\u9879\uFF08\u4EC5\u975E\u4E25\u683C\u89E3\u6790\u5668\uFF09"),
        bool("handleSubcomponents", "\u89E3\u6790\u5B50\u7EC4\u4EF6", true, "\u89E3\u6790\u5B50\u7EC4\u4EF6\uFF08\u4EC5\u975E\u4E25\u683C\u89E3\u6790\u5668\uFF09"),
        bool("useStrictParser", "\u4F7F\u7528\u4E25\u683C\u89E3\u6790\u5668", false, "\u6309 HL7 \u4E25\u683C\u89C4\u8303\u89E3\u6790\u6D88\u606F"),
        bool("useStrictValidation", "\u4E25\u683C\u89E3\u6790\u5668\u4E2D\u6821\u9A8C", false, "\u6309 HL7 \u89C4\u8303\u6821\u9A8C\u6D88\u606F\uFF08\u4EC5\u4E25\u683C\u89E3\u6790\u5668\uFF09"),
        bool("stripNamespaces", "\u53BB\u9664\u547D\u540D\u7A7A\u95F4", false, "\u4ECE\u8F6C\u6362\u540E\u7684 XML \u6D88\u606F\u4E2D\u53BB\u9664\u547D\u540D\u7A7A\u95F4\u5B9A\u4E49\uFF08\u4EC5\u4E25\u683C\u89E3\u6790\u5668\uFF09"),
        text("segmentDelimiter", "\u6BB5\u5206\u9694\u7B26", "\\r", "\u6BCF\u6BB5\u4E4B\u540E\u671F\u671B\u7684\u8F93\u5165\u5206\u9694\u5B57\u7B26"),
        bool("convertLineBreaks", "\u8F6C\u6362\u6362\u884C\u7B26", true, "\u5C06\u539F\u59CB\u6D88\u606F\u4E2D\u7684\u6240\u6709\u6362\u884C\u98CE\u683C\uFF08CRLF\u3001CR\u3001LF\uFF09\u8F6C\u6362\u4E3A\u6BB5\u5206\u9694\u7B26")
      ]
    },
    {
      key: "deserializationProperties",
      label: "\u53CD\u5E8F\u5217\u5316",
      class: `${PKG}.HL7v2DeserializationProperties`,
      fields: [
        bool("useStrictParser", "\u4F7F\u7528\u4E25\u683C\u89E3\u6790\u5668", false, "\u6309 HL7 \u4E25\u683C\u89C4\u8303\u89E3\u6790\u6D88\u606F"),
        bool("useStrictValidation", "\u4E25\u683C\u89E3\u6790\u5668\u4E2D\u6821\u9A8C", false, "\u6309 HL7 \u89C4\u8303\u6821\u9A8C\u6D88\u606F\uFF08\u4EC5\u4E25\u683C\u89E3\u6790\u5668\uFF09"),
        text("segmentDelimiter", "\u6BB5\u5206\u9694\u7B26", "\\r", "\u6BCF\u6BB5\u4E4B\u540E\u4F7F\u7528\u7684\u5206\u9694\u5B57\u7B26")
      ]
    },
    {
      key: "batchProperties",
      label: "\u6279\u5904\u7406",
      class: `${PKG}.HL7v2BatchProperties`,
      fields: [
        opt("splitType", "\u6279\u5904\u7406\u62C6\u5206\u65B9\u5F0F", [
          { value: "MSH_Segment", label: "MSH \u6BB5" },
          { value: "JavaScript", label: "JavaScript" }
        ], "MSH_Segment", "MSH \u6BB5\uFF1A\u6BCF\u4E2A MSH \u6BB5\u8D77\u59CB\u4E00\u6761\u65B0\u6D88\u606F\uFF1BJavaScript\uFF1A\u4F7F\u7528\u811A\u672C\u62C6\u5206\u6D88\u606F"),
        code("batchScript", "JavaScript", null, BATCH_SCRIPT_HINT)
      ]
    },
    {
      key: "responseGenerationProperties",
      label: "\u54CD\u5E94\u751F\u6210",
      class: `${PKG}.HL7v2ResponseGenerationProperties`,
      fields: [
        text("segmentDelimiter", "\u6BB5\u5206\u9694\u7B26", "\\r", "\u751F\u6210\u7684 ACK \u4E2D\u6BCF\u6BB5\u4E4B\u540E\u4F7F\u7528\u7684\u5206\u9694\u5B57\u7B26"),
        text("successfulACKCode", "\u6210\u529F ACK \u4EE3\u7801", "AA"),
        text("successfulACKMessage", "\u6210\u529F ACK \u6D88\u606F", null),
        text("errorACKCode", "\u9519\u8BEF ACK \u4EE3\u7801", "AE"),
        text("errorACKMessage", "\u9519\u8BEF ACK \u6D88\u606F", "An Error Occurred Processing Message."),
        text("rejectedACKCode", "\u62D2\u7EDD ACK \u4EE3\u7801", "AR"),
        text("rejectedACKMessage", "\u62D2\u7EDD ACK \u6D88\u606F", "Message Rejected."),
        bool("msh15ACKAccept", "MSH-15 ACK \u63A5\u53D7", false, "\u68C0\u67E5\u4F20\u5165\u6D88\u606F\u7684 MSH-15 \u5B57\u6BB5\u4EE5\u63A7\u5236\u786E\u8BA4\u6761\u4EF6"),
        text("dateFormat", "\u65E5\u671F\u683C\u5F0F", "yyyyMMddHHmmss.SSS", "\u751F\u6210\u7684 ACK \u4E2D\u65F6\u95F4\u6233\u4F7F\u7528\u7684\u65E5\u671F\u683C\u5F0F")
      ]
    },
    {
      key: "responseValidationProperties",
      label: "\u54CD\u5E94\u6821\u9A8C",
      class: `${PKG}.HL7v2ResponseValidationProperties`,
      fields: [
        text("successfulACKCode", "\u6210\u529F ACK \u4EE3\u7801", "AA,CA", "\u6D88\u606F\u88AB\u63A5\u53D7\u65F6\u671F\u671B\u7684 ACK \u4EE3\u7801\uFF08\u9017\u53F7\u5206\u9694\uFF09\uFF0C\u6D88\u606F\u72B6\u6001\u7F6E\u4E3A SENT"),
        text("errorACKCode", "\u9519\u8BEF ACK \u4EE3\u7801", "AE,CE", "\u4E0B\u6E38\u53D1\u751F\u9519\u8BEF\u65F6\u671F\u671B\u7684 ACK \u4EE3\u7801\uFF08\u9017\u53F7\u5206\u9694\uFF09\uFF0C\u6D88\u606F\u72B6\u6001\u7F6E\u4E3A ERROR"),
        text("rejectedACKCode", "\u62D2\u7EDD ACK \u4EE3\u7801", "AR,CR", "\u6D88\u606F\u88AB\u62D2\u7EDD\u65F6\u671F\u671B\u7684 ACK \u4EE3\u7801\uFF08\u9017\u53F7\u5206\u9694\uFF09\uFF0C\u6D88\u606F\u72B6\u6001\u7F6E\u4E3A ERROR"),
        bool("validateMessageControlId", "\u6821\u9A8C\u6D88\u606F\u63A7\u5236 ID", true, "\u6821\u9A8C\u54CD\u5E94\u8FD4\u56DE\u7684\u6D88\u606F\u63A7\u5236 ID\uFF08MSA-2\uFF09"),
        opt("originalMessageControlId", "\u539F\u6D88\u606F\u63A7\u5236 ID", [
          { value: "Destination_Encoded", label: "\u76EE\u7684\u5730\u7F16\u7801\u503C" },
          { value: "Map_Variable", label: "\u6620\u5C04\u53D8\u91CF" }
        ], "Destination_Encoded", "\u6821\u9A8C\u54CD\u5E94\u65F6\u7528\u4E8E\u83B7\u53D6\u539F\u6D88\u606F\u63A7\u5236 ID \u7684\u6765\u6E90"),
        text("originalIdMapVariable", "\u539F ID \u6620\u5C04\u53D8\u91CF", null, "\u5F53\u539F\u6D88\u606F\u63A7\u5236 ID \u9009\u62E9\u6620\u5C04\u53D8\u91CF\u65F6\u5FC5\u586B\uFF0CID \u4ECE\u8FDE\u63A5\u5668\u6216\u901A\u9053\u6620\u5C04\u4E2D\u8BFB\u53D6")
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
