/*
 * Raw data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * Transcribed from server/.../plugins/datatypes/raw/*Properties.java.
 *
 * Contributes a DATA definition only (schema + defaults()); the shared React
 * properties editor (client/datatypes/props-editor.jsx) renders the groups, so
 * there is no JSX here. Authored as .jsx under the React plugin contract,
 * sharing the host's single React instance via platform.React.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.raw';

const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = '拆分批处理并返回下一条消息的 JavaScript，' +
    "可访问 'reader'（Java BufferedReader），返回 null/空 表示输入结束；" +
    '仅在连接器中启用批处理时使用';

const DEF: any = {
    name: 'RAW', label: 'Raw', order: 50,
    propertiesClass: `${PKG}.RawDataTypeProperties`,
    groups: [
        {
            key: 'batchProperties', label: '批处理', class: `${PKG}.RawBatchProperties`,
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
