/*
 * Shared variable-reference lists shown beside code editors: the classic
 * Administrator's "Destination Mappings" (connector templates) and the Rhino
 * scope cheat-sheet for channel scripts (filter/transformer steps, auth
 * scripts). Each entry is [label, insertText].
 *
 * The classic Administrator keeps ONE list of labels and renders two insert
 * forms (VariableListHandler.TransferMode): Velocity tokens for template
 * connectors (HTTP/File/Database SQL…) and Rhino expressions for JavaScript
 * connectors. A Velocity token pasted into a JavaScript editor is a syntax
 * error — the engine swallows the compile failure at deploy time and then
 * reports "Script not found in cache" at run time — so the web lists carry both
 * forms here and the callers pick by the editor's language.
 */

export type Mapping = [string, string];

type MappingForms = { label: string; velocity: string; javascript?: string };

/* Label parity with the classic Administrator; the JavaScript column mirrors
   VariableListHandler.staticJsReferences (entries with no Rhino equivalent —
   ${COUNT}, CDATA — are Velocity-only and drop out of the JavaScript list). */
const MAPPING_FORMS: MappingForms[] = [
    { label: '通道 ID', velocity: '${channelId}', javascript: 'channelId' },
    { label: '通道名称', velocity: '${channelName}', javascript: 'channelName' },
    { label: '消息 ID', velocity: '${message.messageId}', javascript: 'connectorMessage.getMessageId()' },
    { label: '原始数据', velocity: '${message.rawData}', javascript: 'connectorMessage.getRawData()' },
    { label: '转换后数据', velocity: '${message.transformedData}', javascript: 'connectorMessage.getTransformedData()' },
    { label: '编码后数据', velocity: '${message.encodedData}', javascript: 'connectorMessage.getEncodedData()' },
    { label: '消息来源', velocity: '${message.source}', javascript: "$('mirth_source')" },
    { label: '消息类型', velocity: '${message.type}', javascript: "$('mirth_type')" },
    { label: '消息版本', velocity: '${message.version}', javascript: "$('mirth_version')" },
    { label: '日期', velocity: '${date}', javascript: "var date = DateUtil.getDate('pattern','date');" },
    { label: '格式化日期', velocity: "${date.get('yyyy-M-d H.m.s')}", javascript: "var dateString = DateUtil.getCurrentDate('yyyy-M-d H.m.s');" },
    { label: '时间戳', velocity: '${SYSTIME}', javascript: "var dateString = DateUtil.getCurrentDate('yyyyMMddHHmmss');" },
    { label: '唯一 ID', velocity: '${UUID}', javascript: 'var uuid = UUIDGenerator.getUUID();' },
    { label: '原始文件名', velocity: '${originalFilename}', javascript: "$('originalFilename')" },
    { label: '计数', velocity: '${COUNT}' },
    { label: 'XML 实体编码器', velocity: '${XmlUtil.encode()}', javascript: "var encodedMessage = XmlUtil.encode('message');" },
    { label: 'XML 美化打印', velocity: '${XmlUtil.prettyPrint()}', javascript: "var prettyPrintedMessage = XmlUtil.prettyPrint('message');" },
    { label: '转义 JSON 字符串', velocity: '${JsonUtil.escape()}', javascript: "var escapedJSONString = JsonUtil.escape('message');" },
    { label: 'JSON 美化打印', velocity: '${JsonUtil.prettyPrint()}', javascript: "var prettyPrintedMessage = JsonUtil.prettyPrint('message');" },
    { label: 'CDATA 标签', velocity: '<![CDATA[]]>' },
    { label: 'DICOM 消息原始数据', velocity: '${DICOMMESSAGE}', javascript: 'var rawData = DICOMUtil.getDICOMRawData(connectorMessage);' }
];

/** The Velocity column — what template connectors (and any plain text field) take. */
export const DESTINATION_MAPPINGS: Mapping[] = MAPPING_FORMS
    .filter(m => m.velocity)
    .map(m => [m.label, m.velocity] as Mapping);

/** The JavaScript column — what a Rhino editor (JavaScript Writer/Reader, database
 *  "Use JavaScript", response/postprocessor scripts) takes. */
export const DESTINATION_MAPPINGS_JS: Mapping[] = MAPPING_FORMS
    .filter(m => m.javascript)
    .map(m => [m.label, m.javascript] as Mapping);

const BY_VELOCITY = new Map(MAPPING_FORMS.map(m => [m.velocity, m]));
const BY_JAVASCRIPT = new Map(MAPPING_FORMS
    .filter(m => m.javascript)
    .map(m => [m.javascript as string, m]));

/** True for the editor languages that run Rhino (same set the script editors use). */
export function isJsLanguage(language?: string | null): boolean {
    return String(language || '').toLowerCase() === 'javascript';
}

/**
 * The insert language of a resolved mapping target — `{ monaco }` for an editor,
 * `{ el }` for a text field. A Monaco editor answers with its model language
 * (javascript / sql / xml / text); the same field as a plain textarea cannot, so
 * a code editor stamps its language on the `.ce` root (`data-lang`); anything
 * outside a code editor is a connector template field, which takes Velocity.
 */
export function mappingLanguageOf(target?: any): string {
    const inst = target && target.monaco;
    if (inst) {
        try {
            const model = inst.getModel();
            const id = model && model.getLanguageId();
            if (id) return id;
        } catch { /* model already disposed */ }
    }
    const el = target && target.el;
    if (el && el.closest) {
        const ce = el.closest('.ce');
        const lang = ce && ce.getAttribute('data-lang');
        if (lang) return lang;
    }
    return 'velocity';
}

/**
 * The list to show beside an editor: the JavaScript column for a Rhino editor,
 * the Velocity column everywhere else (templates, SQL, plain text fields).
 */
export function mappingsFor(language?: string | null): Mapping[] {
    return isJsLanguage(language) ? DESTINATION_MAPPINGS_JS : DESTINATION_MAPPINGS;
}

/**
 * Translate a rail token for the target editor's language — in both directions,
 * because a drag can start while the rail shows one column and land in an editor
 * of the other kind. Returns the token unchanged when it is not a known
 * destination mapping (the script cheat-sheet, hand-typed text, a drop from
 * another window), and null when the mapping has no form for that language —
 * callers must not insert those.
 */
export function mappingTextFor(token: string, language?: string | null): string | null {
    const js = isJsLanguage(language);
    const form = (js ? BY_VELOCITY : BY_JAVASCRIPT).get(token);
    if (!form) return token;                       // foreign or already-correct text
    return (js ? form.javascript : form.velocity) ?? null;
}

/* Rhino script scope — the identifiers available inside filter/transformer steps
   and channel scripts (JavaScript context). */
export const SCRIPT_REFERENCE: Mapping[] = [
    ['入站消息', 'msg'],
    ['转换后消息', 'tmp'],
    ['连接器消息', 'connectorMessage'],
    ['通道 ID', 'channelId'],
    ['通道名称', 'channelName'],
    ['通道映射', "$c('key')"],
    ['通道映射（写入）', "$c('key', value)"],
    ['源映射', "$s('key')"],
    ['全局映射', "$g('key')"],
    ['全局通道映射', "$gc('key')"],
    ['响应映射', "$r('key')"],
    ['配置映射', "$cfg('key')"],
    ['附件', 'getAttachments()'],
    ['日志记录器', "logger.info('')"],
    ['唯一 ID', 'UUIDGenerator.getUUID()'],
    ['日期工具', "DateUtil.getCurrentDate('yyyyMMddHHmmss')"]
];
