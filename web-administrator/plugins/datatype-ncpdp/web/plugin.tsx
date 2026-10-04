/*
 * NCPDP data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * Transcribed from server/.../plugins/datatypes/ncpdp/*Properties.java.
 *
 * Contributes a DATA definition only (schema + defaults()); the shared React
 * properties editor (client/datatypes/props-editor.jsx) renders the groups, so
 * there is no JSX here. Authored as .jsx under the React plugin contract,
 * sharing the host's single React instance via platform.React.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.ncpdp';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = '拆分批处理并返回下一条消息的 JavaScript，' +
    "可访问 'reader'（Java BufferedReader），返回 null/空 表示输入结束；" +
    '仅在连接器中启用批处理时使用';

const DEF: any = {
    name: 'NCPDP', label: 'NCPDP', order: 80,
    propertiesClass: `${PKG}.NCPDPDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: '序列化',
            class: `${PKG}.NCPDPSerializationProperties`,
            fields: [
                text('fieldDelimiter', '字段分隔符', '0x1C', '分隔消息中字段的字符'),
                text('groupDelimiter', '组分隔符', '0x1D', '分隔消息中组的字符'),
                text('segmentDelimiter', '段分隔符', '0x1E', '分隔消息中段的字符')
            ]
        },
        {
            key: 'deserializationProperties', label: '反序列化',
            class: `${PKG}.NCPDPDeserializationProperties`,
            fields: [
                text('fieldDelimiter', '字段分隔符', '0x1C', '分隔消息中字段的字符'),
                text('groupDelimiter', '组分隔符', '0x1D', '分隔消息中组的字符'),
                text('segmentDelimiter', '段分隔符', '0x1E', '分隔消息中段的字符'),
                bool('useStrictValidation', '使用严格校验', false, '按模式（schema）校验 NCPDP 消息')
            ]
        },
        {
            key: 'batchProperties', label: '批处理', class: `${PKG}.NCPDPBatchProperties`,
            fields: [
                opt('splitType', '批处理拆分方式', [{ value: 'JavaScript', label: 'JavaScript' }], 'JavaScript',
                    '拆分批处理消息的方式，仅在连接器中启用批处理时使用'),
                code('batchScript', 'JavaScript', null, BATCH_SCRIPT_HINT)
            ]
        }
    ]
};

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
