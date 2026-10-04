/*
 * Delimited Text data type — web admin plugin (React, DataTypeClientPlugin equivalent).
 * Transcribed from server/.../plugins/datatypes/delimited/*Properties.java.
 *
 * Contributes a DATA definition only (schema + defaults()); the shared React
 * properties editor (client/datatypes/props-editor.jsx) renders the groups, so
 * there is no JSX here. Authored as .jsx under the React plugin contract,
 * sharing the host's single React instance via platform.React.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const PKG = 'com.mirth.connect.plugins.datatypes.delimited';

const text = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'text', default: def, hint });
const num = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'number', default: def, hint });
const bool = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'checkbox', default: def, hint });
const opt = (key: any, label: any, options: any, def: any, hint?: any) => ({ key, label, type: 'select', options, default: def, hint });
const code = (key: any, label: any, def: any, hint?: any) => ({ key, label, type: 'code', default: def, hint });

const BATCH_SCRIPT_HINT = '拆分批处理并返回下一条消息的 JavaScript，' +
    "可访问 'reader'（Java BufferedReader），返回 null/空 表示输入结束；" +
    '仅在连接器中启用批处理时使用';

const DEF: any = {
    name: 'DELIMITED', label: '分隔文本', order: 60,
    propertiesClass: `${PKG}.DelimitedDataTypeProperties`,
    groups: [
        {
            key: 'serializationProperties', label: '序列化',
            class: `${PKG}.DelimitedSerializationProperties`,
            fields: [
                text('columnDelimiter', '列分隔符', ',', '分隔列的字符（例如 CSV 文件中的逗号）'),
                text('recordDelimiter', '记录分隔符', '\\n', '分隔每条记录的字符（例如 CSV 文件中的换行符）'),
                text('columnWidths', '列宽', null, '逗号分隔的固定列宽列表；分隔式列请留空'),
                text('quoteToken', '引号符', '"', '用于包裹含内嵌特殊字符取值的引号字符'),
                bool('escapeWithDoubleQuote', '双引号转义', true, '连续两个引号符表示内嵌引号；取消勾选则改用转义符'),
                text('quoteEscapeToken', '转义符', '\\', '用于转义内嵌引号的字符（仅在未勾选双引号转义时生效）'),
                text('columnNames', '列名', null, '逗号分隔的列表，覆盖默认列名（column1…columnN）'),
                bool('numberedRows', '行编号', false, '在消息的 XML 表示中为每行编号'),
                bool('ignoreCR', '忽略回车符', true, '跳过回车符（\\r），不作处理')
            ]
        },
        {
            key: 'deserializationProperties', label: '反序列化',
            class: `${PKG}.DelimitedDeserializationProperties`,
            fields: [
                text('columnDelimiter', '列分隔符', ',', '分隔列的字符（例如 CSV 文件中的逗号）'),
                text('recordDelimiter', '记录分隔符', '\\n', '分隔每条记录的字符（例如 CSV 文件中的换行符）'),
                text('columnWidths', '列宽', null, '逗号分隔的固定列宽列表；分隔式列请留空'),
                text('quoteToken', '引号符', '"', '用于包裹含内嵌特殊字符取值的引号字符'),
                bool('escapeWithDoubleQuote', '双引号转义', true, '连续两个引号符表示内嵌引号；取消勾选则改用转义符'),
                text('quoteEscapeToken', '转义符', '\\', '用于转义内嵌引号的字符（仅在未勾选双引号转义时生效）')
            ]
        },
        {
            key: 'batchProperties', label: '批处理', class: `${PKG}.DelimitedBatchProperties`,
            fields: [
                opt('splitType', '批处理拆分方式', [
                    { value: 'Record', label: '按记录' },
                    { value: 'Delimiter', label: '按分隔符' },
                    { value: 'Grouping_Column', label: '按分组列' },
                    { value: 'JavaScript', label: 'JavaScript' }
                ], 'Record', '拆分批处理消息的方式，仅在连接器中启用批处理时使用'),
                num('batchSkipRecords', '头部记录数', 0, '要跳过的头部记录数'),
                text('batchMessageDelimiter', '批处理分隔符', null, '分隔消息的分隔符（字符序列）'),
                bool('batchMessageDelimiterIncluded', '包含批处理分隔符', false, '在批处理器返回的消息中包含批处理分隔符'),
                text('batchGroupingColumn', '分组列', null, '用于分组记录的列；其值变化即标志消息边界'),
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
