/*
 * XML data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * Field/default shapes transcribed from the engine plugin
 * (server/.../plugins/datatypes/xml/*Properties.java).
 *
 * Contributes a DATA definition only (schema + defaults()); the shared React
 * properties editor (client/datatypes/props-editor.jsx) renders the groups, so
 * there is no JSX here. Authored as .jsx under the React plugin contract,
 * sharing the host's single React instance via platform.React.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.xml';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const num = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'number', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = '拆分批处理并返回下一条消息的 JavaScript，' +
    "可访问 'reader'（Java BufferedReader），返回 null/空 表示输入结束；" +
    '仅在连接器中启用批处理时使用';

const DEF: any = {
    name: 'XML', label: 'XML', order: 30,
    propertiesClass: `${PKG}.XMLDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: '序列化',
            class: `${PKG}.XMLSerializationProperties`,
            fields: [
                bool('stripNamespaces', '去除命名空间', false, '从转换后的 XML 消息中去除命名空间定义（不会移除前缀）')
            ]
        },
        {
            key: 'batchProperties', label: '批处理', class: `${PKG}.XMLBatchProperties`,
            fields: [
                opt('splitType', '批处理拆分方式', [
                    { value: 'Element_Name', label: '按元素名' },
                    { value: 'Level', label: '按层级' },
                    { value: 'XPath_Query', label: '按 XPath 查询' },
                    { value: 'JavaScript', label: 'JavaScript' }
                ], 'Element_Name', '拆分批处理消息的方式，仅在连接器中启用批处理时使用'),
                text('elementName', '元素名', null, '将每个使用该名称的元素拆分为独立消息'),
                num('level', '层级', 1, '将每个处于该层级的元素拆分为独立消息（根元素为 0 级）'),
                text('query', 'XPath 查询', null, '将 XPath 查询命中的每个元素拆分为独立消息'),
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
