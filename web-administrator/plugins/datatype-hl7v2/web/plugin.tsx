/*
 * HL7 v2.x data type — web admin plugin (React).
 *
 * Registers the HL7V2 data type definition (serialization, deserialization,
 * batch, response generation/validation property groups) via
 * platform.registerDataType. The web admin's generic data-type properties
 * editor (client/datatypes/props-editor.jsx) renders whatever groups/fields
 * this definition exposes — so a data type is just a plugin, not privileged
 * core code, mirroring the Swing client's DataTypeClientPlugin model. A
 * third-party data type ships the same way: drop a folder with this shape
 * into plugins/.
 *
 * This plugin contributes a DATA definition only (schema + defaults()); it has
 * no per-type render. The shared React properties editor consumes the def, so
 * there is no JSX in this module — but it is authored as .jsx under the React
 * plugin contract, sharing the host's single React instance via platform.React.
 *
 * Field/default shapes are transcribed from the engine plugin
 * (server/src/com/mirth/connect/plugins/datatypes/hl7v2/*Properties.java);
 * empty-string Java defaults are written as null to match the engine's XStream
 * JSON round-trip.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.hl7v2';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = '拆分批处理并返回下一条消息的 JavaScript，' +
    "可访问 'reader'（Java BufferedReader），返回 null/空 表示输入结束；" +
    '仅在连接器中启用批处理时使用';

const DEF: any = {
    name: 'HL7V2', label: 'HL7 v2.x', order: 10,
    propertiesClass: `${PKG}.HL7v2DataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: '序列化',
            class: `${PKG}.HL7v2SerializationProperties`,
            fields: [
                bool('handleRepetitions', '解析字段重复', true, '解析字段重复项（仅非严格解析器）'),
                bool('handleSubcomponents', '解析子组件', true, '解析子组件（仅非严格解析器）'),
                bool('useStrictParser', '使用严格解析器', false, '按 HL7 严格规范解析消息'),
                bool('useStrictValidation', '严格解析器中校验', false, '按 HL7 规范校验消息（仅严格解析器）'),
                bool('stripNamespaces', '去除命名空间', false, '从转换后的 XML 消息中去除命名空间定义（仅严格解析器）'),
                text('segmentDelimiter', '段分隔符', '\\r', '每段之后期望的输入分隔字符'),
                bool('convertLineBreaks', '转换换行符', true, '将原始消息中的所有换行风格（CRLF、CR、LF）转换为段分隔符')
            ]
        },
        {
            key: 'deserializationProperties', label: '反序列化',
            class: `${PKG}.HL7v2DeserializationProperties`,
            fields: [
                bool('useStrictParser', '使用严格解析器', false, '按 HL7 严格规范解析消息'),
                bool('useStrictValidation', '严格解析器中校验', false, '按 HL7 规范校验消息（仅严格解析器）'),
                text('segmentDelimiter', '段分隔符', '\\r', '每段之后使用的分隔字符')
            ]
        },
        {
            key: 'batchProperties', label: '批处理',
            class: `${PKG}.HL7v2BatchProperties`,
            fields: [
                opt('splitType', '批处理拆分方式', [
                    { value: 'MSH_Segment', label: 'MSH 段' },
                    { value: 'JavaScript', label: 'JavaScript' }
                ], 'MSH_Segment', 'MSH 段：每个 MSH 段起始一条新消息；JavaScript：使用脚本拆分消息'),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        },
        {
            key: 'responseGenerationProperties', label: '响应生成',
            class: `${PKG}.HL7v2ResponseGenerationProperties`,
            fields: [
                text('segmentDelimiter', '段分隔符', '\\r', '生成的 ACK 中每段之后使用的分隔字符'),
                text('successfulACKCode', '成功 ACK 代码', 'AA'),
                text('successfulACKMessage', '成功 ACK 消息', null),
                text('errorACKCode', '错误 ACK 代码', 'AE'),
                text('errorACKMessage', '错误 ACK 消息', 'An Error Occurred Processing Message.'),
                text('rejectedACKCode', '拒绝 ACK 代码', 'AR'),
                text('rejectedACKMessage', '拒绝 ACK 消息', 'Message Rejected.'),
                bool('msh15ACKAccept', 'MSH-15 ACK 接受', false, '检查传入消息的 MSH-15 字段以控制确认条件'),
                text('dateFormat', '日期格式', 'yyyyMMddHHmmss.SSS', '生成的 ACK 中时间戳使用的日期格式')
            ]
        },
        {
            key: 'responseValidationProperties', label: '响应校验',
            class: `${PKG}.HL7v2ResponseValidationProperties`,
            fields: [
                text('successfulACKCode', '成功 ACK 代码', 'AA,CA', '消息被接受时期望的 ACK 代码（逗号分隔），消息状态置为 SENT'),
                text('errorACKCode', '错误 ACK 代码', 'AE,CE', '下游发生错误时期望的 ACK 代码（逗号分隔），消息状态置为 ERROR'),
                text('rejectedACKCode', '拒绝 ACK 代码', 'AR,CR', '消息被拒绝时期望的 ACK 代码（逗号分隔），消息状态置为 ERROR'),
                bool('validateMessageControlId', '校验消息控制 ID', true, '校验响应返回的消息控制 ID（MSA-2）'),
                opt('originalMessageControlId', '原消息控制 ID', [
                    { value: 'Destination_Encoded', label: '目的地编码值' },
                    { value: 'Map_Variable', label: '映射变量' }
                ], 'Destination_Encoded', '校验响应时用于获取原消息控制 ID 的来源'),
                text('originalIdMapVariable', '原 ID 映射变量', null, '当原消息控制 ID 选择映射变量时必填，ID 从连接器或通道映射中读取')
            ]
        }
    ]
};

// Same builder the core registry uses: '@class'/'@version' on the root and on
// every group, each field seeded with its default.
DEF.defaults = (version: any) => {
    const props: any = { '@class': DEF.propertiesClass, '@version': version };
    for (const group of DEF.groups) {
        const obj: any = { '@class': group.class, '@version': version };
        for (const f of group.fields) obj[f.key] = f.default ?? null;
        props[group.key] = obj;
    }
    return props;
};

export function register(platform: Platform) {
    platform.registerDataType(DEF.name, DEF);
}
