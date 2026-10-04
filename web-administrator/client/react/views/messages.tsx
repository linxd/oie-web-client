/*
 * Messages — message browser, fully declarative React. The Swing-parity browser
 * is a hierarchical, sortable tree-table (source rows with expand twisties +
 * nested per-connector destination rows + a column-visibility menu), a resizable
 * bottom detail pane with content/error/mapping/attachment tabs, and a
 * lazily-counted pager.
 *
 * The results grid keeps its bespoke <table.msg-table> markup (pinned twisty
 * column with the expand-all header, "--" dash cells, unprocessed-row styling)
 * rendered from React state, with the resize/reorder/column-menu affordances
 * re-implemented in JSX against the same createColumnManager('messages') store
 * (order + widths) and the webadmin-msg-columns visibility store — nothing
 * about the persisted column state or the CSS contract changes.
 *
 * Search is an explicit command (Swing parity: nothing re-runs it implicitly),
 * so the search engine keeps its paging cursor in refs (offsetRef/limitRef/
 * lastParamsRef/totalRef) mutated by runSearch and mirrors the render-relevant
 * results into state. searchRef re-points to the current runSearch each render
 * so dialogs/menus (which outlive the render that opened them) always invoke a
 * fresh closure.
 *
 * The dialogs (Send Message, Advanced Search, Reprocessing Options, Export
 * Results) stay imperative modal() functions invoked from handlers — they are
 * self-contained and shared (openSendMessageDialog is called from the dashboard
 * and cards views). Attachment viewers render as <PluginSlot> children of the
 * React tree; the View Attachment modal mounts the same <AttachmentList> via
 * mountReact with its own teardown.
 *
 * webadmin:set-title fires 'Channel Messages - <name>' once the channel name
 * loads, dispatched inside requestAnimationFrame so it sticks past route:changed
 * (which otherwise resets the banner to the static route title).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Collapsible from '@radix-ui/react-collapsible';
import { h, toast, cornerToast, modal, confirmDialog, promptDialog, checkbox, select, fmtDate, fmtNumber, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { messageStatusTag } from '@oie/web-api';
import { renderHighlighted, detectType } from '../../core/content-highlight.js';
import { formatSentProperties } from '../../core/sent-format.js';
import { mappingEntries, parseResponse, toDisplayString } from '../../core/xstream.js';
import { getPref } from '../../core/prefs.js';
import { serializeTemplate } from '../../core/serialize.js';
import { createZip } from '../../core/zip.js';
import { createCodeEditor, createColumnManager } from '@oie/web-ui';
import { platform } from '../../core/platform.js';
import { ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { RailPane, TaskButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import * as router from '../../core/router.js';
import { DateTimeField } from '../date-time-field.jsx';
import { on } from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import {
    COMPARE_STAGES, cancelPending, confirmCompare, describeRef, getAnchor, getPending,
    proposeCompare, refFromConnectorMessage, sameMessage, selectForCompare, stageLabel, storedContentTypes
} from '../../core/compare.js';
import { CompareChip } from '../compare-chip.jsx';
import { CompareOverlay } from '../compare-overlay.jsx';
import { openRemoveAllMessagesDialog } from '../remove-all-messages.js';
import { withEditorSave } from '../save-lock.js';
import { messageImportDialog } from './message-import-dialog.js';
import { readMessageFiles } from '../../core/message-import-files.js';

/* Criteria-panel width below which the criteria fold into the Filters popover. */
const CRITERIA_INLINE_MIN = 760;


/* ---- XStream JSON normalization helpers -------------------------------------- */

// Render an XStream-encoded value the way Swing does (shared decoder).
const displayValue = (v: any) => toDisplayString(v);

/* XStream maps arrive as {entry:[{string:[k,v]}]} or {entry:[{string:k, <type>:v}]}
   (singleton entries as a bare object), or occasionally as a plain object. */
function mapEntries(map: any) {
    if (!map || typeof map !== 'object') return [];
    if (map.entry === undefined) {
        return Object.entries(map)
            .filter(([k]) => !k.startsWith('@'))
            .map(([k, v]) => [k, displayValue(v)]);
    }
    const out: any[] = [];
    for (const entry of api.asList(map.entry)) {
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry.string) && Object.keys(entry).length === 1) {
            out.push([displayValue(entry.string[0]), displayValue(entry.string[1])]);
            continue;
        }
        const values: any[] = [];
        for (const [k, v] of Object.entries(entry)) {
            if (k.startsWith('@')) continue;
            if (Array.isArray(v)) values.push(...v); else values.push(v);
        }
        if (values.length >= 2) out.push([displayValue(values[0]), displayValue(values[1])]);
        else if (values.length === 1) out.push([displayValue(values[0]), '']);
    }
    return out;
}

/* Map<String,String> of channel id → name from /channels/idsAndNames. */
function idNamePairs(map: any) {
    return mapEntries(map).map(([id, name]) => ({ id, name }));
}

/* Map<Integer,String> of metaDataId → connector name. */
function connectorEntries(map: any) {
    const out: any[] = [];
    const entries = map && typeof map === 'object' && map.entry !== undefined ? map.entry : map;
    for (const entry of api.asList(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        let id: any = null;
        let name: any = null;
        for (const [k, v] of Object.entries(entry)) {
            if (k.startsWith('@')) continue;
            if (typeof v === 'number') id = v;
            else if (typeof v === 'string' && /^-?\d+$/.test(v) && k !== 'string') id = Number(v);
            else if (typeof v === 'string') name = v;
        }
        if (id !== null) out.push({ metaDataId: id, name: name ?? String(id) });
    }
    out.sort((a: any, b: any) => a.metaDataId - b.metaDataId);
    return out;
}

/* Message.connectorMessages is a Map<Integer,ConnectorMessage>:
   {entry:[{int:0, connectorMessage:{...}}, ...]} — singleton as bare object. */
function connectorMessagesOf(message: any) {
    const entries = message?.connectorMessages?.entry ?? message?.connectorMessages;
    const out: any[] = [];
    for (const entry of api.asList(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const cm = entry.connectorMessage ?? (entry.metaDataId !== undefined ? entry : null);
        if (cm && typeof cm === 'object') out.push(cm);
    }
    out.sort((a: any, b: any) => Number(a.metaDataId ?? 0) - Number(b.metaDataId ?? 0));
    return out;
}

function sourceOf(message: any) {
    const cms = connectorMessagesOf(message);
    // No fallback to cms[0]: when a filter (e.g. status=SENT) returns only
    // destination connector messages, the message has no source row — the parent
    // row then renders blank source-derived columns (Swing parity) instead of
    // borrowing a destination's connector name / status / dates / metadata.
    return cms.find(cm => Number(cm.metaDataId) === 0) ?? null;
}

function contentOf(messageContent: any) {
    const c = messageContent?.content;
    if (c === null || c === undefined || c === '') return null;
    return typeof c === 'object' ? displayValue(c) : String(c);
}

function connectorHasError(cm: any) {
    return Number(cm?.errorCode) > 0
        || contentOf(cm?.processingErrorContent) !== null
        || contentOf(cm?.postProcessorErrorContent) !== null
        || contentOf(cm?.responseErrorContent) !== null;
}

function messageHasError(message: any) {
    return connectorMessagesOf(message).some(connectorHasError);
}

/* Status pill (JSX twin of the imperative h('span.tag…') helper). */
function StatusTag({ status }: any) {
    const color = messageStatusTag(status);
    return <span className={'tag' + (color ? ' ' + color : '')}>{status || ''}</span>;
}

/* Calendar query params: yyyy-MM-dd'T'HH:mm:ss.SSSZ (RFC 822 zone, no colon). */
function toCalendarParam(datetimeLocal: any) {
    if (!datetimeLocal) return null;
    const d = new Date(datetimeLocal);
    if (isNaN(d.getTime())) return null;
    const pad = (n: any, w = 2) => String(n).padStart(w, '0');
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

function toCount(value: any) {
    if (value && typeof value === 'object') value = value.long ?? value.int ?? value.integer ?? 0;
    return Number(value) || 0;
}

/* Content searches are separate repeatable query params per content type
   (MessageServletInterface GET /channels/{id}/messages: rawContentSearch,
   transformedContentSearch, ... responseErrorContentSearch). */
const CONTENT_SEARCH_TYPES = [
    { value: 'rawContentSearch', label: '原始' },
    { value: 'processedRawContentSearch', label: '处理后原始' },
    { value: 'transformedContentSearch', label: '转换后' },
    { value: 'encodedContentSearch', label: '编码后' },
    { value: 'sentContentSearch', label: '已发送' },
    { value: 'responseContentSearch', label: '响应' },
    { value: 'responseTransformedContentSearch', label: '响应转换后' },
    { value: 'processedResponseContentSearch', label: '处理后响应' },
    { value: 'connectorMapContentSearch', label: '连接器映射' },
    { value: 'channelMapContentSearch', label: '通道映射' },
    { value: 'sourceMapContentSearch', label: '源映射' },
    { value: 'responseMapContentSearch', label: '响应映射' },
    { value: 'processingErrorContentSearch', label: '处理错误' },
    { value: 'postprocessorErrorContentSearch', label: '后处理错误' },
    { value: 'responseErrorContentSearch', label: '响应错误' }
];

/* metaDataSearch / metaDataCaseInsensitiveSearch param format is
   "COLUMN_NAME <operator> value" (space-separated), parsed by
   MetaDataSearchParamConverterProvider.MetaDataSearch.valueOf. */
const META_SEARCH_OPERATORS = [
    '=', '!=', '<', '<=', '>', '>=', 'CONTAINS', 'DOES NOT CONTAIN',
    'STARTS WITH', 'DOES NOT START WITH', 'ENDS WITH', 'DOES NOT END WITH'
];

/* Advanced search criteria defaults (cleared by the dialog's Reset button). */
function defaultAdvancedCriteria() {
    return {
        minMessageId: '', maxMessageId: '',
        minOriginalId: '', maxOriginalId: '',
        minImportId: '', maxImportId: '',
        serverId: '',
        minSendAttempts: '', maxSendAttempts: '',
        error: false, attachment: false,
        includedMetaDataIds: null,  // null = all connectors; else [ids]
        excludedMetaDataIds: null,  // set instead when "Deleted Connectors" stays included
        contentSearches: [],   // [{type, text}]
        metaDataSearches: []   // [{column, operator, value, ignoreCase}]
    };
}

function advIsActive(adv: any) {
    const ranges = ['minMessageId', 'maxMessageId', 'minOriginalId', 'maxOriginalId',
        'minImportId', 'maxImportId', 'minSendAttempts', 'maxSendAttempts'];
    return !!(adv.includedMetaDataIds || adv.excludedMetaDataIds || adv.error
        || adv.attachment || adv.contentSearches.length || adv.metaDataSearches.length
        || adv.serverId.trim() || ranges.some(k => String(adv[k]).trim() !== ''));
}


/* Pick a file and return its bytes base64-encoded (data: URL prefix stripped),
   chunked into 76-char lines like the Swing client's Base64.encodeBase64Chunked. */
function pickBinaryFile() {
    return new Promise(resolve => {
        const input = h('input', { type: 'file', class: 'hidden' });
        input.addEventListener('change', () => {
            const file = (input as any).files[0];
            input.remove();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = String(reader.result).replace(/^data:[^,]*,/, '');
                resolve({ name: file.name, content: b64.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '') });
            };
            reader.readAsDataURL(file);
        });
        document.body.appendChild(input);
        input.click();
    });
}

function deployedConnectors(xml: string, channelId: string) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const status = doc.documentElement;
    const hasText = (element: Element) => Array.from(element.childNodes)
        .some(node => (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) && !!node.textContent?.trim());
    const field = (parent: Element, name: string) => {
        const matches = Array.from(parent.children).filter(child => child.tagName === name);
        if (matches.length !== 1) throw new Error('引擎返回的目的地信息无效');
        return matches[0];
    };
    const text = (parent: Element, name: string) => {
        const element = field(parent, name);
        if (element.children.length) throw new Error('引擎返回的目的地信息无效');
        return element.textContent ?? '';
    };
    if (doc.querySelector('parsererror') || doc.doctype || status.tagName !== 'dashboardStatus' || hasText(status)
        || text(status, 'channelId') !== channelId || text(status, 'statusType') !== 'CHANNEL') {
        throw new Error('引擎未返回通道状态信息');
    }
    const children = field(status, 'childStatuses');
    if (hasText(children)) throw new Error('引擎返回的目的地信息无效');
    const ids = new Set<number>();
    return Array.from(children.children).map(child => {
        if (child.tagName !== 'dashboardStatus' || hasText(child) || text(child, 'channelId') !== channelId) {
            throw new Error('引擎返回的目的地信息无效');
        }
        const id = text(child, 'metaDataId');
        const metaDataId = Number(id);
        if (!/^\d+$/.test(id) || !Number.isSafeInteger(metaDataId) || ids.has(metaDataId)
            || text(child, 'statusType') !== (metaDataId === 0 ? 'SOURCE_CONNECTOR' : 'DESTINATION_CONNECTOR')) {
            throw new Error('引擎返回的目的地信息无效');
        }
        ids.add(metaDataId);
        return { metaDataId, name: text(child, 'name') };
    });
}

/* Shared Send Message dialog (parity with the Swing EditMessageDialog) — pops
   over whichever view invokes it. onSent() runs after a successful submit
   (e.g. to refresh a results list). */
export async function openSendMessageDialog(platform: any, channelId: any, onSent: any) {
    let assertSession: () => void;
    try { assertSession = captureEngineSession(); }
    catch { return; }
    return discoverSendMessage(platform, channelId, onSent, assertSession);
}

async function discoverSendMessage(platform: any, channelId: any, onSent: any, assertSession: () => void) {
    let closed = false;
    const current = () => {
        if (closed) return false;
        try { assertSession(); return true; }
        catch { return false; }
    };
    if (!current()) return;
    let connectors: any[] = [];
    try {
        // Swing's DashboardPanel.getDestinationConnectorNames uses deployed
        // statuses. Saved connector names can differ until the next deployment,
        // and discovering them also requires the unrelated View Messages task.
        // XML also preserves names such as "1e3" or "null" that XStream JSON
        // coerces to primitives. This is the same existing status endpoint.
        connectors = deployedConnectors(await api.getXml(`/channels/${encodeURIComponent(channelId)}/status`), channelId);
        if (!current()) return;
    } catch (e: any) {
        if (!current()) return;
        modal({
            title: '无法加载目的地',
            onClose: () => { closed = true; },
            body: h('div', `尚未发送消息，请在处理前重试目的地发现：${e.message || e}`),
            buttons: [{ label: '关闭' }, { label: '重试', primary: true,
                onClick: () => { if (current()) void discoverSendMessage(platform, channelId, onSent, assertSession); } }]
        });
        return;
    }

    const editor = createCodeEditor({ value: '', minHeight: '340px', placeholder: '原始消息正文…' });

    /* ---- file open buttons -------------------------------------------------- */

    const fileButtons = h('div', { class: 'flex gap-2 mt-2' },
        h('button.btn', {
            onClick: async () => {
                if (!current()) return;
                try {
                    const file = await pickFile();
                    if (file && current()) editor.setValue(file.content);
                } catch (e: any) { if (current()) toast(`打开文件失败：${e.message || e}`, 'error'); }
            }
        }, '打开文本文件…'),
        h('button.btn', {
            onClick: async () => {
                if (!current()) return;
                const file = await pickBinaryFile();
                if (file && current()) editor.setValue((file as any).content);
            },
            title: '将二进制文件打开到上方编辑器中，文件会以 Base64 编码显示'
        }, '打开二进制文件…'),
        h('span.text-text-faint', { class: 'self-center' },
            '二进制文件会以 Base64 编码写入编辑器'));

    /* ---- destinations table -------------------------------------------------- */

    const destRows = connectors.filter(c => c.metaDataId > 0).map(c => ({
        metaDataId: c.metaDataId,
        // Default all checked = send to all destinations, like the Swing client.
        input: h('input', { type: 'checkbox', checked: true })
    }));
    const destTable = h('div.dt-wrap', { class: 'max-h-[126px] overflow-auto' },
        h('table.dt',
            h('thead', h('tr', h('th', '目的地'), h('th', { class: 'w-[81px]' }, '包含'))),
            h('tbody', destRows.map(d => {
                const c = connectors.find(x => x.metaDataId === d.metaDataId);
                return h('tr',
                    h('td', `${c.name}`),
                    h('td', { class: 'text-center' }, d.input));
            }))));

    /* ---- source map variables table ------------------------------------------ */

    const mapRows: any[] = [];          // [{key: input, value: input, tr}]
    let selectedMapRow: any = null;
    const mapTbody = h('tbody');

    function selectMapRow(row: any) {
        selectedMapRow = row;
        mapTbody.querySelectorAll('tr').forEach(tr => tr.classList.remove('selected'));
        if (row) row.tr.classList.add('selected');
    }

    function newMapKey() {
        let n = 1;
        while (mapRows.some(r => r.key.value === `key${n}`)) n++;
        return `key${n}`;
    }

    function addMapRow(key = '', value = '') {
        const row = {
            key: h('input', { type: 'text', value: key, class: 'w-full' }),
            value: h('input', { type: 'text', value: value, class: 'w-full' })
        };
        (row as any).tr = h('tr', { onMousedown: () => selectMapRow(row) },
            h('td', row.key), h('td', row.value));
        mapRows.push(row);
        mapTbody.appendChild((row as any).tr);
        selectMapRow(row);
        return row;
    }

    const mapTable = h('div.dt-wrap', { class: 'max-h-[126px] overflow-auto' },
        h('table.dt',
            h('thead', h('tr', h('th', { class: 'w-[40%]' }, '变量'), h('th', '值'))),
            mapTbody));
    const mapButtons = h('div', { class: 'flex gap-2 mt-1.5' },
        h('button.btn', { onClick: () => { addMapRow(newMapKey()).key.focus(); } }, '新建'),
        h('button.btn', {
            onClick: () => {
                if (!selectedMapRow) { toast('请先选择变量行', 'warn'); return; }
                const i = mapRows.indexOf(selectedMapRow);
                selectedMapRow.tr.remove();
                mapRows.splice(i, 1);
                selectMapRow(mapRows[Math.min(i, mapRows.length - 1)] ?? null);
            }
        }, '删除'));

    /* ---- dialog -------------------------------------------------------------- */

    let sending = false;
    let outcomeUnknown = false;
    const dialog = modal({
        title: '消息',
        size: 'wide',
        onClose: () => { closed = true; editor.dispose && editor.dispose(); },
        body: h('div',
            editor.el,
            fileButtons,
            destRows.length ? h('div',
                h('div.mt-[13px]', '发送到以下目的地：'),
                h('div', { class: 'mt-1.5' }, destTable)) : null,
            h('div.mt-[13px]', '包含以下源映射变量：'),
            h('div', { class: 'mt-1.5' }, mapTable),
            mapButtons),
        buttons: [
            {
                label: '处理消息', primary: true,
                onClick: async () => {
                    if (sending || !current()) return false;
                    const rawData = editor.getValue();
                    if (!rawData) { toast('请输入消息内容', 'warn'); return false; }
                    const selected = destRows.filter(d => (d.input as any).checked).map(d => d.metaDataId);
                    // Match Swing: all selected means all destinations deployed
                    // when processing starts, including any added while open.
                    const metaDataIds = selected.length === destRows.length ? null : selected;
                    const sourceMapEntries = mapRows
                        .filter(r => r.key.value.trim() !== '')
                        .map(r => `${r.key.value.trim()}=${r.value.value}`);
                    sending = true;
                    const submit = dialog.el.querySelector<HTMLButtonElement>('.modal-foot .btn-primary');
                    if (submit) { submit.disabled = true; submit.textContent = '正在处理…'; }
                    let attempted = false;
                    try {
                        if (outcomeUnknown && !await confirmDialog('重试消息',
                            '上次发送未能确认，可能已在处理中，重试前请在引擎中核实结果，重复发送可能产生重复消息',
                            { danger: true, okLabel: '重新发送消息' })) return false;
                        if (!current()) return false;
                        attempted = true;
                        await api.messages.processNew(channelId, rawData, metaDataIds, sourceMapEntries);
                        if (!current()) return false;
                        toast('消息已提交处理');
                        onSent && onSent();
                    } catch (e: any) {
                        if (!current()) return false;
                        if (attempted) outcomeUnknown = ![400, 401, 403, 404, 405, 415].includes(e.status);
                        toast(outcomeUnknown
                            ? `无法确认发送结果：${e.message}，重试前请核实引擎中的结果`
                            : `消息已被拒绝：${e.message}`, 'error');
                        return false;
                    } finally {
                        sending = false;
                        if (submit) { submit.disabled = false; submit.textContent = '处理消息'; }
                    }
                }
            },
            { label: '关闭' }
        ]
    });
    setTimeout(() => { if (current()) editor.focus(); }, 30);
}

/* ---- results table (bespoke declarative tree-grid) -------------------------------- */

/* Custom metadata column values live in each connectorMessage.metaDataMap. */
function metaDataValue(m: any, name: any) {
    for (const cm of connectorMessagesOf(m)) {
        for (const [key, value] of mapEntries(cm.metaDataMap)) {
            if (String(key).toUpperCase() === String(name).toUpperCase() && value !== '') return value;
        }
    }
    return '';
}

const maxAttempts = (m: any) => Math.max(0, ...connectorMessagesOf(m).map(cm => Number(cm.sendAttempts) || 0));
const metaOfCm = (cm: any, name: any) => {
    for (const [k, v] of mapEntries(cm && cm.metaDataMap)) {
        if (String(k).toUpperCase() === String(name).toUpperCase() && v !== '') return v;
    }
    return '';
};
function errorLabel(cm: any) {
    const proc = contentOf(cm && cm.processingErrorContent) !== null;
    const resp = contentOf(cm && cm.responseErrorContent) !== null;
    const post = contentOf(cm && cm.postProcessorErrorContent) !== null;
    const n = (proc ? 1 : 0) + (resp ? 1 : 0) + (post ? 1 : 0);
    if (n > 1) return '多个';
    if (proc) return '处理';
    if (resp) return '响应';
    if (post) return '后处理';
    if (String(cm && cm.status) === 'ERROR') return '是';
    return '';
}
// null (not an empty element) when there's no error, so the cell renders "--".
const errBadge = (label: any) => label ? <span className="text-err">{label}</span> : null;

/* Full built-in column set (mirrors the Swing MessageBrowser); `def` marks
   default-visible. parent() renders the source row, child() a destination.
   channelName is per-view state, so the set is built per render (memoized). */
function buildColumns(channelName: any, metaDataColumns: any) {
    const COLUMNS = [
        { key: 'id', label: 'ID', def: true, w: '90px', cls: 'num', sort: (m: any) => Number(m.messageId), parent: (m: any) => String(m.messageId), child: () => '' },
        { key: 'connector', label: '连接器', def: true, sort: (m: any) => sourceOf(m)?.connectorName || '', parent: (m: any, s: any) => s ? (s.connectorName || '源连接器') : '', child: (cm: any) => cm.connectorName || `目的地 ${cm.metaDataId}` },
        { key: 'status', label: '状态', def: true, w: '110px', sort: (m: any) => sourceOf(m)?.status || '', parent: (m: any, s: any) => s ? <StatusTag status={s.status} /> : '', child: (cm: any) => <StatusTag status={cm.status} /> },
        { key: 'origReceived', label: '原始接收日期', cls: 'mono', sort: (m: any) => fmtDate(m.receivedDate), parent: (m: any) => fmtDate(m.receivedDate), child: () => '' },
        { key: 'received', label: '接收日期', def: true, cls: 'mono', sort: (m: any) => fmtDate(sourceOf(m)?.receivedDate ?? m.receivedDate), parent: (m: any, s: any) => s ? fmtDate(s.receivedDate ?? m.receivedDate) : '', child: (cm: any) => fmtDate(cm.receivedDate) },
        { key: 'sendAttempts', label: '发送次数', w: '100px', cls: 'num', sort: (m: any) => maxAttempts(m), parent: (m: any) => String(maxAttempts(m)), child: (cm: any) => String(Number(cm.sendAttempts) || 0) },
        { key: 'sendDate', label: '发送日期', cls: 'mono', sort: (m: any) => fmtDate(sourceOf(m)?.sendDate), parent: (m: any, s: any) => s ? fmtDate(s.sendDate) : '', child: (cm: any) => fmtDate(cm.sendDate) },
        { key: 'responseDate', label: '响应日期', def: true, cls: 'mono', sort: (m: any) => fmtDate(sourceOf(m)?.responseDate), parent: (m: any, s: any) => s ? fmtDate(s.responseDate) : '', child: (cm: any) => fmtDate(cm.responseDate) },
        { key: 'errors', label: '错误', def: true, w: '90px', sort: (m: any) => messageHasError(m) ? 0 : 1, parent: (m: any, s: any) => errBadge(errorLabel(s)), child: (cm: any) => errBadge(errorLabel(cm)) },
        { key: 'serverId', label: '服务器 ID', cls: 'mono', sort: (m: any) => m.serverId || '', parent: (m: any) => m.serverId || '', child: (cm: any) => cm.serverId || '' },
        { key: 'origServerId', label: '原始服务器 ID', cls: 'mono', sort: (m: any) => m.originalServerId || '', parent: (m: any) => m.originalServerId || '', child: () => '' },
        { key: 'originalId', label: '原始 ID', cls: 'num', sort: (m: any) => Number(m.originalId) || 0, parent: (m: any) => m.originalId != null ? String(m.originalId) : '', child: () => '' },
        { key: 'importId', label: '导入 ID', cls: 'num', sort: (m: any) => Number(m.importId) || 0, parent: (m: any) => m.importId != null ? String(m.importId) : '', child: () => '' },
        { key: 'importChannelId', label: '导入通道 ID', cls: 'mono', sort: (m: any) => m.importChannelId || '', parent: (m: any) => m.importChannelId || '', child: () => '' },
        { key: 'channelName', label: '通道名称', sort: () => channelName, parent: () => channelName, child: () => '' }
    ];
    return [...COLUMNS, ...metaDataColumns.map((col: any) => ({
        key: `meta:${col.name}`, label: col.name, def: true,
        sort: (m: any) => metaDataValue(m, col.name),
        // Parent = the source connector message's metadata only (Swing parity):
        // blank when the source row isn't in the result, even if a destination
        // carries the value (that still shows on the destination's own row).
        parent: (m: any, s: any) => s ? metaOfCm(s, col.name) : '',
        child: (cm: any) => metaOfCm(cm, col.name)
    }))];
}

/* Default widths for the column manager (the `w`-carrying built-in columns). */
const MSG_COL_WIDTHS = { id: 90, status: 110, sendAttempts: 100, errors: 90 };

/* A null/empty model value renders as a centered, faint "--" (Swing parity):
   e.g. connector-derived columns on a source-less parent row, or message-level
   columns on a destination child row. String/JSX values pass through as-is. */
function Cell({ value, cls, indent }: any) {
    const empty = value === '' || value === null || value === undefined;
    const className = [empty ? 'cell-dash' : (cls || ''), indent ? 'indent' : '']
        .filter(Boolean).join(' ') || undefined;
    return <td className={className}>{empty ? '--' : value}</td>;
}

/*
 * The hierarchical results grid: source rows with expand twisties + nested
 * per-connector destination rows, a pinned expand-all twisty column, and the
 * resize / drag-to-reorder / auto-fit header affordances of decorateColumns
 * re-implemented in JSX against the same createColumnManager store — persisted
 * order and widths carry over unchanged.
 *
 * `cols` arrives visible-and-display-ordered from the view (which owns the
 * separate visibility store); `rows` arrives pre-sorted. All interaction flows
 * out through callbacks — the table renders pure state.
 */
function ResultsTable({
    cols, mgr, rows, expandedIds, allExpanded, selKey, anchorKey,
    sortKey, sortDir, onSort, onToggleAll, onToggleRow, onSelect, onRowMenu,
    onColumnMenu, onColumnsChange
}: any) {
    const tableRef = useRef<any>(null);
    const colRefs = useRef<any>({});       // key -> <col> element (live resize)

    const lastKey = cols.length ? cols[cols.length - 1].key : null;
    // Min width so the table scrolls (rather than crushing columns) when the fixed
    // widths exceed the viewport; the auto last column keeps an 80px floor.
    const minWidth = 26 + cols.reduce((sum: any, c: any) => sum + (c.key === lastKey ? 80 : mgr.width(c.key)), 0);

    /* ---- resize drag (live width via the <col> ref; commit on mouseup) ---- */
    const startResize = (e: any, key: any) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const col = colRefs.current[key];
        const startW = col ? parseFloat(col.style.width) || mgr.width(key) : mgr.width(key);
        document.body.style.cursor = 'col-resize';
        const move = (ev: any) => { const w = Math.max(40, startW + (ev.clientX - startX)); if (col) col.style.width = w + 'px'; };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            mgr.setWidth(key, col ? parseFloat(col.style.width) : startW);
            onColumnsChange();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    };

    // Double-click the edge → auto-fit the column to its widest content
    // (decorateColumns parity; measures the rendered cells directly).
    const autoFit = (e: any, key: any, displayIndex: any) => {
        e.preventDefault();
        e.stopPropagation();
        const table = tableRef.current;
        if (!table) return;
        const cellIndex = 1 + displayIndex;   // after the pinned twisty column
        const headTh = table.querySelectorAll('thead th')[cellIndex];
        let max = headTh ? headTh.scrollWidth : 0;
        for (const tr of table.querySelectorAll('tbody > tr')) {
            const c = tr.children[cellIndex];
            if (!c || c.colSpan > 1) continue;
            max = Math.max(max, c.scrollWidth);
        }
        mgr.setWidth(key, Math.max(40, max + 10));
        onColumnsChange();
    };

    /* ---- drag-to-reorder data columns (the twisty column stays pinned) ---- */
    const onColDrop = (e: any, toKey: any) => {
        e.preventDefault();
        e.currentTarget.classList.remove('col-drop');
        const from = e.dataTransfer.getData('text/plain');
        if (!from || from === toKey) return;
        const next = cols.map((c: any) => c.key).filter((k: any) => k !== from);
        next.splice(next.indexOf(toKey), 0, from);   // drop before the target column
        mgr.setOrder(next);
        onColumnsChange();
    };

    const thead = (
        <thead>
            <tr>
                <th className="w-6" onContextMenu={onColumnMenu}>
                    <span className="msg-twisty" title={allExpanded ? '全部收起' : '全部展开'}
                        onClick={onToggleAll}>{allExpanded ? '▾' : '▸'}</span>
                </th>
                {cols.map((c: any, i: any) => (
                    <th key={c.key} data-col-key={c.key} draggable
                        onContextMenu={onColumnMenu}
                        onClick={() => onSort(c.key)}
                        onDragStart={(e: any) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key); e.currentTarget.classList.add('col-dragging'); }}
                        onDragEnd={(e: any) => e.currentTarget.classList.remove('col-dragging')}
                        onDragOver={(e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('col-drop'); }}
                        onDragLeave={(e: any) => e.currentTarget.classList.remove('col-drop')}
                        onDrop={(e: any) => onColDrop(e, c.key)}>
                        {c.label}{sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                        {c.key !== lastKey
                            ? <div className="col-resize"
                                onClick={(e: any) => e.stopPropagation()}
                                onDragStart={(e: any) => { e.preventDefault(); e.stopPropagation(); }}
                                onDoubleClick={(e: any) => autoFit(e, c.key, i)}
                                onMouseDown={(e: any) => startResize(e, c.key)} />
                            : null}
                    </th>
                ))}
            </tr>
        </thead>
    );

    const colgroup = (
        <colgroup>
            <col style={{ width: '26px' }} />
            {cols.map((c: any) => (
                <col key={c.key}
                    ref={(el: any) => { colRefs.current[c.key] = el; }}
                    style={c.key === lastKey ? undefined : { width: mgr.width(c.key) + 'px' }} />
            ))}
        </colgroup>
    );

    if (!rows.length) {
        // Same scroll wrapper as the populated branch (flex-none: the header
        // strip keeps its natural height) so the fixed-layout header scrolls
        // horizontally instead of clipping inside the overflow-hidden card.
        return (
            <>
                <div className="dt-wrap flex-none overflow-x-auto">
                    <table className="msg-table dt-resizable" ref={tableRef}
                        style={{ tableLayout: 'fixed', width: '100%', minWidth: minWidth + 'px' }}>
                        {colgroup}{thead}
                    </table>
                </div>
                <div className="dt-empty">未找到消息</div>
            </>
        );
    }

    const bodyRows: any[] = [];
    // The row the compare anchor points at, marked with an inset accent bar and a
    // ⇄ in the twisty column — a marker, never any of the content it refers to.
    const anchorMark = (key: any) => key === anchorKey
        ? <span className="compare-mark" title="已选作对比" aria-label="已选作对比">⇄</span>
        : null;
    for (const m of rows) {
        const source = sourceOf(m);
        // Not-yet-processed messages render gray italic across all columns,
        // on the parent and its children (Swing's italic cell renderer).
        const unprocessed = m.processed === false || m.processed === 'false';
        const rowCls = (key: any, anchored: any) => [key, unprocessed ? 'unprocessed' : '', anchored ? 'compare-anchor' : '']
            .filter(Boolean).join(' ') || undefined;
        const dests = connectorMessagesOf(m).filter(cm => Number(cm.metaDataId) > 0);
        const expanded = expandedIds.has(String(m.messageId));
        bodyRows.push(
            <tr key={`m:${m.messageId}`}
                className={rowCls(selKey === `${m.messageId}:0` ? 'selected' : '', anchorKey === `${m.messageId}:0`)}
                onClick={() => onSelect(m, 0)}
                onContextMenu={(e: any) => onRowMenu(m, 0, e)}>
                <td>
                    <span className="msg-twisty"
                        onClick={dests.length ? (e: any) => { e.stopPropagation(); onToggleRow(String(m.messageId)); } : undefined}>
                        {dests.length ? (expanded ? '▾' : '▸') : ''}
                    </span>
                    {anchorMark(`${m.messageId}:0`)}
                </td>
                {cols.map((c: any) => <Cell key={c.key} value={c.parent(m, source)} cls={c.cls} />)}
            </tr>
        );
        if (expanded) for (const cm of dests) {
            const key = `${m.messageId}:${cm.metaDataId}`;
            bodyRows.push(
                <tr key={`m:${key}`}
                    className={'child ' + (rowCls(selKey === key ? 'selected' : '', anchorKey === key) || '')}
                    onClick={() => onSelect(m, Number(cm.metaDataId))}
                    onContextMenu={(e: any) => onRowMenu(m, Number(cm.metaDataId), e)}>
                    <td>{anchorMark(key)}</td>
                    {cols.map((c: any) => <Cell key={c.key} value={c.child(cm)} cls={c.cls} indent={c.key === 'connector'} />)}
                </tr>
            );
        }
    }

    return (
        <div className="dt-wrap flex-1 min-h-0 overflow-auto">
            <table className="msg-table dt-resizable" ref={tableRef}
                style={{ tableLayout: 'fixed', width: '100%', minWidth: minWidth + 'px' }}>
                {colgroup}{thead}
                <tbody>{bodyRows}</tbody>
            </table>
        </div>
    );
}

/* ---- detail pane ------------------------------------------------------------------ */

function copyText(text: any) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text == null ? '' : text)).then(
            () => toast('已复制到剪贴板'),
            () => toast('复制失败', 'warn'));
    } else { toast('剪贴板不可用', 'warn'); }
}

function Loading({ text = '正在加载…' }: any) {
    return <div className="loading-block"><div className="spinner" />{text}</div>;
}

/* Do two compare references point at the same stage? The four fields below are
   what identifies one (the rest — names, data types — are decoration derived
   from them). Used to keep the active-stage state stable across the freshly
   built refs the detail tabs hand up on every render. */
function sameStageRef(a: any, b: any) {
    if (a === b) return true;
    if (!a || !b) return false;
    return String(a.channelId) === String(b.channelId)
        && String(a.messageId) === String(b.messageId)
        && Number(a.metaDataId ?? 0) === Number(b.metaDataId ?? 0)
        && a.contentType === b.contentType;
}

/* The Response (and destination Processed Response) stage stores a serialized
   Response object, not raw content. Like the Swing browser, we surface the
   status + statusMessage in a banner and show the inner <message> payload as
   the body — never the XML envelope itself. (parseResponse lives in
   core/xstream.js with the rest of the engine-value decoding.) */

/* Highlighted content viewer: syntax colors, optional pretty-print, copy,
   and (for HL7) field-name tooltips enriched from the serializer sidecar.
   renderHighlighted paints imperatively into the <pre> behind a ref — the
   same escape hatch as Monaco hosts; everything around it is state. */
function ContentView({ content, dataType, responseEnvelope, popoutTitle }: any) {
    // Response stages: unwrap the Response envelope — banner shows the status,
    // body shows only the inner message payload (often empty).
    const env = useMemo(() => responseEnvelope ? parseResponse(content) : null, [content, responseEnvelope]);
    const body = env ? (env.message || '') : content;
    const kind = detectType(body, dataType);

    // Pretty-print known structured types (XML/JSON) by default — gated on the
    // "Format text in message browser" user preference (Administrator settings).
    const [formatted, setFormatted] = useState(
        () => (kind === 'xml' || kind === 'json') && getPref('formatMessages') !== false);
    const [descriptions, setDescriptions] = useState<any>(null);
    const preRef = useRef<any>(null);

    useEffect(() => {
        if (preRef.current) renderHighlighted(preRef.current, body, { dataType, format: formatted, descriptions });
    }, [body, dataType, formatted, descriptions]);

    // HL7: pull exact field names from the engine and re-render tooltips
    // (enhances the built-in static dictionary; no-op if the engine can't serialize).
    useEffect(() => {
        if (kind !== 'hl7v2') return;
        let stale = false;
        serializeTemplate('HL7V2', {}, body).then(res => {
            const d = res && res.meta && res.meta.descriptions;
            if (!stale && d && Object.keys(d).length) setDescriptions(d);
        }).catch(() => { /* leave the static dictionary tooltips */ });
        return () => { stale = true; };
    }, [kind, body]);

    return (
        <div className="flex flex-col min-h-0 h-full">
            <div className="content-toolbar">
                {(kind === 'xml' || kind === 'json') && (
                    <label className="check">
                        <input type="checkbox" checked={formatted} onChange={(e: any) => setFormatted(e.target.checked)} />
                        格式化
                    </label>
                )}
                <span className="flex-1" />
                {popoutTitle && (
                    <button className="btn btn-sm" title="全屏打开"
                        onClick={() => openContentPopout(popoutTitle, { content, dataType, responseEnvelope })}>
                        <Icon name="popout" />全屏
                    </button>
                )}
                <button className="btn btn-sm" onClick={() => copyText(body)}><Icon name="copy" />复制</button>
            </div>
            {env && (
                <div className="content-banner">
                    <StatusTag status={env.status} />
                    {env.statusMessage ? <span className="text-text-faint">{env.statusMessage}</span> : null}
                </div>
            )}
            {/* flex:1 so the box always fills the pane — a stable text area even
                when the body is empty (e.g. a Response with no payload). */}
            <pre className="content-pre flex-1 min-h-[108px] max-h-none m-2.5" ref={preRef} />
        </div>
    );
}

/* Full Screen: ONE content stage in a content-sized modal (grows to the
   viewport caps, like the dashboard's log-entry dialog) — the same
   highlighted viewer with its Format toggle and Copy, nothing else. No
   popoutTitle inside, so the modal's own toolbar offers no second popout.
   The modal owns the React root and tears it down on close (the View
   Attachment idiom). */
function openContentPopout(title: any, props: any) {
    const host = h('div', { class: 'flex-1 min-h-0 flex flex-col' });
    const teardown = mountReact(host, <ContentView {...props} />);
    modal({
        title, size: 'fit', body: host,
        buttons: [{ label: '关闭', primary: true }],
        onClose: () => { try { teardown(); } catch { /* ignore */ } }
    });
}

/* Classic mappings table: Scope | Variable | Value rows aggregated across the
   connector message's maps. The header is a sortable, sticky banner — it
   stays put (table.dt th is position:sticky) while the rows scroll in the tab
   body, and clicking a column sorts by it (toggling asc/desc). */
const MAPPING_COLS = [
    { key: 'scope', label: '作用域' }, { key: 'variable', label: '变量' }, { key: 'value', label: '值' }];

function MappingsTable({ cm }: any) {
    // Scope, deserialized map content. Matches the Swing browser exactly:
    // Source / Connector / Channel / Response only — no Custom Metadata.
    const rows = useMemo(() => {
        const groups = [
            ['源', cm.sourceMapContent],
            ['连接器', cm.connectorMapContent],
            ['通道', cm.channelMapContent],
            ['响应', cm.responseMapContent]
        ];
        const out: any[] = [];
        for (const [scope, mc] of groups) {
            for (const [variable, value] of mappingEntries(mc)) {
                out.push({ scope, variable: String(variable), value: String(value ?? '') });
            }
        }
        return out;
    }, [cm]);

    // null sort key = original Source→Response order.
    const [sort, setSort] = useState<any>({ key: null, dir: 1 });

    if (!rows.length) {
        return <div className="p-3.5"><div className="text-text-faint">该消息没有映射</div></div>;
    }

    const view = sort.key
        ? [...rows].sort((a: any, b: any) => String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true }) * sort.dir)
        : rows;

    // No inner overflow wrapper: the table scrolls in the tab body
    // (flex-1 min-h-0 overflow-auto), so the sticky header sticks to the pane
    // top and reads as a static banner instead of scrolling away with a nested
    // scroll container.
    return (
        <table className="dt">
            <thead>
                <tr>
                    {MAPPING_COLS.map(col => (
                        <th key={col.key} className="sortable"
                            onClick={() => setSort((s: any) => s.key === col.key ? { key: col.key, dir: -s.dir } : { key: col.key, dir: 1 })}>
                            {col.label}
                            {sort.key === col.key ? <span className="sort-arrow">{sort.dir > 0 ? '▲' : '▼'}</span> : null}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {view.map((r: any, i: any) => (
                    <tr key={i} className="cursor-pointer" title="双击查看完整值"
                        onDoubleClick={() => openMappingValue(r.value)}>
                        <td className="w-[108px]">{r.scope}</td>
                        <td className="mono w-[30%]">{r.variable}</td>
                        <td className="mono whitespace-pre-wrap break-all">{r.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/* Plain-text popout (mapping values, error blocks): the same content-sized
   modal as the stage popout, with Copy — for text that needs no highlighting
   or Format toggle. */
function openTextPopout(title: any, text: any, display = text) {
    modal({
        title,
        size: 'fit',
        body: h('pre', { class: 'content-pre flex-1 min-h-[108px] max-h-none m-2.5' }, display),
        buttons: [
            { label: '复制', onClick: () => { copyText(text); return false; } },
            { label: '关闭', primary: true }
        ]
    });
}

/* Double-clicking a mappings row opens just that value, read-only — the Swing
   ViewContentDialog ("Mapping Value"), which also renders tabs as newlines.
   Copy takes the value itself — the tab→newline swap is display-only. */
function openMappingValue(value: any) {
    const text = String(value ?? '');
    openTextPopout('映射值', text, text.replace(/\t/g, '\n'));
}

/* ---- attachments ------------------------------------------------------------------ */

function isTextualAttachment(type: any) {
    return /^text\/|json|xml|x-www-form-urlencoded/i.test(String(type || ''));
}

function attachmentExtension(type: any) {
    const subtype = String(type || '').split(';')[0].split('/')[1] || '';
    if (subtype === 'plain') return '.txt';
    const cleaned = subtype.replace(/[^\w]+/g, '').slice(0, 8);
    return cleaned ? `.${cleaned}` : '.bin';
}

async function exportAttachment(channelId: any, message: any, attachment: any, session?: () => void) {
    let assertSession: () => void;
    try { assertSession = session || captureEngineSession(); assertSession(); }
    catch { return; }
    const listType = displayValue(attachment.type) || 'application/octet-stream';
    let contentLoaded = false;
    try {
        await saveFile(`attachment-${displayValue(attachment.id)}${attachmentExtension(listType)}`, listType, async () => {
            const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
            assertSession();
            const type = displayValue(full?.type ?? attachment.type) || 'application/octet-stream';
            let content: any = full?.content ?? full;
            if (typeof content !== 'string') content = displayValue(content);
            contentLoaded = true;
            try {
                // Attachment content arrives Base64-encoded; decode to bytes,
                // then to text for textual types or a binary blob otherwise.
                const binary = atob((content as any).replace(/\s+/g, ''));
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return isTextualAttachment(type) ? new TextDecoder().decode(bytes) : new Blob([bytes], { type });
            } catch { return content; /* not Base64 — save as-is */ }
        }, assertSession);
        assertSession();
        if (contentLoaded) toast('附件已导出');
    } catch (e: any) {
        try { assertSession(); } catch { return; }
        toast(`导出附件失败：${e.message}`, 'error');
    }
}

/* Fallback block for attachments no viewer claims: Id/Type plus the classic
   Fetch Content + Export controls. */
function AttachmentFallback({ channelId, message, attachment }: any) {
    const [content, setContent] = useState<any>(null);
    const fetchContent = async () => {
        try {
            const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
            let c: any = full?.content ?? full;
            if (typeof c === 'string') {
                try { c = atob(c); } catch { /* keep base64 */ }
            }
            setContent(displayValue(c));
        } catch (e: any) {
            toast(`获取附件内容失败：${e.message}`, 'error');
        }
    };
    return (
        <div className="mt-[13px]">
            <dl className="kv">
                <dt>ID</dt><dd>{displayValue(attachment.id)}</dd>
                <dt>类型</dt><dd>{displayValue(attachment.type)}</dd>
            </dl>
            <div className="mt-[13px] flex gap-2">
                <button className="btn" onClick={fetchContent}><Icon name="eye" />获取内容</button>
                <TaskButton label="导出" icon="export" task="doExportAttachment" group="message"
                    onClick={() => exportAttachment(channelId, message, attachment)} />
            </div>
            {content != null && <pre className="content-pre mt-[13px]">{content}</pre>}
        </div>
    );
}

/* The message's attachments: fetch (reusing the message's cached list), then one
   block per attachment. A whole-message viewer (handleMultiple, e.g. DICOM — it
   reassembles the full object from the message) renders ONCE for all its
   attachments, not once per pixel-data attachment. Used by both the detail
   pane's Attachments tab and the View Attachment modal — React owns the viewer
   lifecycles in both. */
function AttachmentList({ platform, channelId, message }: any) {
    const [state, setState] = useState<any>(() => message.__attachmentsError
        ? { status: 'error', error: message.__attachmentsError }
        : message.__attachments
            ? { status: 'ready', attachments: message.__attachments }
            : { status: 'loading' });
    useEffect(() => {
        if (message.__attachmentsError || message.__attachments) return undefined;
        let stale = false;
        (async () => {
            try {
                const attachments = message.__attachments ?? await api.messages.attachments(channelId, message.messageId);
                message.__attachments = attachments;   // cache for Export Attachment et al.
                if (!stale) setState({ status: 'ready', attachments });
            } catch (e: any) {
                if (!stale) setState({ status: 'error', error: e.message });
            }
        })();
        return () => { stale = true; };
    }, [channelId, message]);

    if (state.status === 'loading') return <Loading text="正在加载附件…" />;
    if (state.status === 'error') return <div className="text-text-faint">{`加载附件失败：${(state as any).error}`}</div>;
    if (!(state as any).attachments.length) return <div className="text-text-faint">无附件</div>;

    const shownOnce = new Set();
    const blocks: any[] = [];
    for (const attachment of (state as any).attachments) {
        const viewer = platform.attachmentViewers().find((x: any) => { try { return x.canHandle(attachment); } catch { return false; } });
        if (viewer && viewer.handleMultiple) {
            if (shownOnce.has(viewer.id)) continue;
            shownOnce.add(viewer.id);
        }
        if (viewer && viewer.component) {
            blocks.push(
                <div className="mt-[13px]" key={`v:${displayValue(attachment.id)}`}>
                    <PluginSlot def={viewer} ctx={{ attachment, channelId, messageId: message.messageId, platform }} />
                </div>);
        } else {
            blocks.push(<AttachmentFallback key={`a:${displayValue(attachment.id)}`}
                channelId={channelId} message={message} attachment={attachment} />);
        }
    }
    return <>{blocks}</>;
}

// View Attachment (Swing MESSAGE_VIEW_IMAGE) — modal listing the message's
// attachments via the same <AttachmentList>; the modal owns the React root and
// tears it down on close, independent of the detail pane.
function viewAttachmentsModal(platform: any, channelId: any, m: any) {
    const host = h('div', { class: 'w-full min-w-0 max-h-[60vh] overflow-auto' });
    const teardown = mountReact(host, <AttachmentList platform={platform} channelId={channelId} message={m} />);
    modal({
        title: `附件 — 消息 ${m.messageId}`, size: 'wide', body: host, buttons: [{ label: '关闭' }],
        onClose: () => { try { teardown(); } catch { /* ignore */ } }
    });
}

// Export Attachment (Swing MESSAGE_EXPORT_ATTACHMENT) — export directly when
// there's exactly one, otherwise open the viewer to pick.
async function exportAttachmentTask(platform: any, channelId: any, m: any) {
    let assertSession: () => void;
    try { assertSession = captureEngineSession(); }
    catch { return; }
    try {
        const attachments = m.__attachments ?? await api.messages.attachments(channelId, m.messageId);
        assertSession();
        m.__attachments = attachments;
        if (!attachments.length) { toast('该消息没有附件', 'warn'); return; }
        if (attachments.length === 1) { await exportAttachment(channelId, m, attachments[0], assertSession); return; }
        viewAttachmentsModal(platform, channelId, m);
    } catch (e: any) {
        try { assertSession(); } catch { return; }
        toast(`加载附件失败：${e.message || e}`, 'error');
    }
}

/* Detail tab strip sized to the pane: fixed bar, scrolling body. Only the
   active tab's content is mounted (leaving a tab unmounts its viewers, matching
   the legacy teardown-on-switch). The body is KEYED by the active tab so
   switching between two same-type tabs (Raw → Transformed, both <ContentView>)
   remounts instead of reusing the instance — each tab re-derives its Format
   default and HL7 descriptions, and the scroll position resets (legacy parity).
   The parent keys this component by connector so switching rows resets to the
   first tab. */
function DetailTabs({ defs, anchorType, onActiveStage, onStageMenu }: any) {
    const [active, setActive] = useState(0);
    const current = defs.length ? defs[Math.min(active, defs.length - 1)] : null;
    /* Tell the view which stage is on screen, so the task rail's "Select for
       Compare" captures what the user is actually looking at rather than guessing
       a stage. onActiveStage is stable (useCallback up the tree), so this only
       runs when the tab itself changes. */
    useEffect(() => { if (onActiveStage) onActiveStage(current); }, [current, onActiveStage]);
    if (!current) return null;
    const stageMenu = onStageMenu ? (def: any) => (e: any) => onStageMenu(def, e) : () => undefined;
    return (
        <TabsPrimitive.Root value={String(active)} onValueChange={(v: any) => setActive(Number(v))}
            className="flex-1 min-h-0 flex flex-col">
            <TabsPrimitive.List className="tabs flex-none" aria-label="消息内容分区">
                {defs.map((def: any, i: any) => (
                    <TabsPrimitive.Trigger key={def.label} value={String(i)}
                        onContextMenu={stageMenu(def)}
                        className={'tab' + (i === active ? ' active' : '')
                            + (anchorType && def.contentType === anchorType ? ' compare-anchor' : '')}>
                        {def.label}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            {/* The content pane carries the same menu as its tab: right-clicking
                what you are reading is the shortest path to comparing it. */}
            <TabsPrimitive.Content key={current.label} value={String(active)}
                onContextMenu={stageMenu(current)}
                className="flex-1 min-h-0 overflow-auto">{current.node}</TabsPrimitive.Content>
        </TabsPrimitive.Root>
    );
}

/* Tab set for one connector message (content stages, errors, mappings,
   attachments) — mirrors the Swing browser's per-connector tabs. */
function ConnectorTabs({ message, cm, channelId, channelName, platform, anchor, onActiveStage, onStageMenu }: any) {
    const contentDefs = [
        ['原始', 'raw'], ['处理后原始', 'processedRaw'], ['转换后', 'transformed'],
        ['编码后', 'encoded'], ['已发送', 'sent'], ['响应', 'response'],
        ['响应转换后', 'responseTransformed'], ['处理后响应', 'processedResponse']
    ];
    // Which of these tabs Compare understands (the six pipeline stages).
    const comparable = new Map(COMPARE_STAGES.map(s => [s.key, s.type]));

    /* The tabs speak in labels; compare speaks in references. Both conversions
       happen here, where the loaded connector message is in hand — so the stage
       list and the data-type hints are the message's own truth, not a guess from
       the channel's storage mode. */
    const refForDef = useCallback((def: any) => (def && def.contentType
        ? refFromConnectorMessage({ id: channelId, name: channelName }, message.messageId, cm, def.contentType)
        : null), [channelId, channelName, message, cm]);
    const activeStage = useCallback((def: any) => { if (onActiveStage) onActiveStage(refForDef(def)); },
        [onActiveStage, refForDef]);
    const stageMenu = useCallback((def: any, e: any) => {
        const ref = refForDef(def);
        if (ref && onStageMenu) onStageMenu(ref, e);
    }, [onStageMenu, refForDef]);

    // The anchor's stage, when the anchor is this very connector message.
    const anchorType = anchor
        && String(anchor.channelId) === String(channelId)
        && Number(anchor.messageId) === Number(message.messageId)
        && Number(anchor.metaDataId) === Number(cm.metaDataId ?? 0)
        ? anchor.contentType : null;

    const defs: any[] = [];
    // Full-screen titles carry the connector: the results tree, which normally
    // says whose content this is, sits behind the modal overlay.
    const connectorLabel = cm.connectorName
        || (Number(cm.metaDataId) === 0 ? '源连接器' : `目的地 ${cm.metaDataId}`);
    for (const [label, key] of contentDefs) {
        let content = contentOf(cm[key]);
        if (content === null) continue;
        let dataType = cm[key] && cm[key].dataType;
        // Response is always a Response envelope; Processed Response is one only
        // on destinations (on the source it's plain content). Mirrors the Swing browser.
        const responseEnvelope = key === 'response' || (key === 'processedResponse' && Number(cm.metaDataId) > 0);
        // On a destination, "Sent" is a serialized ConnectorProperties object —
        // render it the way the Swing browser does (toFormattedString), as text.
        if (key === 'sent' && Number(cm.metaDataId) > 0) {
            const formatted = formatSentProperties(content);
            if (formatted != null) { content = formatted; dataType = 'TEXT'; }
        }
        defs.push({
            label, contentType: comparable.get(key) ?? null,
            node: <ContentView content={content} dataType={dataType} responseEnvelope={responseEnvelope}
                popoutTitle={`消息 ${message.messageId} — ${connectorLabel} — ${label}`} />
        });
    }

    const errorDefs = [
        ['处理错误', contentOf(cm.processingErrorContent)],
        ['后处理错误', contentOf(cm.postProcessorErrorContent)],
        ['响应错误', contentOf(cm.responseErrorContent)]
    ].filter(([, content]) => content !== null);
    if (errorDefs.length) {
        defs.push({
            label: '错误',
            node: (
                <div className="p-2.5 overflow-auto">
                    {errorDefs.map(([label, content]) => (
                        <div key={label}>
                            {/* Per-block button: an error pops out alone, like a
                                stage — never the whole tab. */}
                            <div className="mt-[13px] flex items-center">
                                <span className="text-text-faint">{label}</span>
                                <button className="btn btn-sm ml-auto" title="全屏打开"
                                    onClick={() => openTextPopout(`消息 ${message.messageId} — ${connectorLabel} — ${label}`, content)}>
                                    <Icon name="popout" />全屏
                                </button>
                            </div>
                            <pre className="content-pre">{content}</pre>
                        </div>
                    ))}
                </div>
            )
        });
    }

    defs.push({ label: '映射', node: <MappingsTable cm={cm} /> });
    // Keep the tab visible on a failed attachment request so the failure cannot
    // masquerade as a message with no attachments.
    if (message.__attachmentsError || (message.__attachments && message.__attachments.length)) {
        defs.push({
            label: '附件',
            node: (
                <div className="p-2.5 overflow-auto">
                    <AttachmentList platform={platform} channelId={channelId} message={message} />
                </div>
            )
        });
    }

    return <DetailTabs defs={defs} anchorType={anchorType}
        onActiveStage={activeStage} onStageMenu={stageMenu} />;
}

/* Detail pane content: empty strip / loading / the selected message's header +
   connector tabs. The connector shown is chosen by selecting the source or
   destination row in the tree above, so the header is just the message label —
   no status pill or connector dropdown. */
function DetailBody({ detail, channelId, channelName, platform, anchor, onActiveStage, onStageMenu }: any) {
    if (detail.status === 'empty') {
        return <div className="text-text-faint flex-none py-[8px] px-3.5">请选择消息以查看其内容</div>;
    }
    if (detail.status === 'loading') {
        return <div className="py-3 px-3.5"><Loading text="正在加载消息…" /></div>;
    }
    if (detail.status === 'error') {
        return <div className="text-danger py-3 px-3.5" role="alert">{detail.error}</div>;
    }
    const { message, metaDataId } = detail;
    const cms = connectorMessagesOf(message);
    if (!cms.length) {
        return (
            <>
                <div className="panel-header flex-none">{`消息 ${message.messageId}`}</div>
                <div className="text-text-faint py-3 px-3.5">无连接器消息</div>
            </>
        );
    }
    const cm = cms.find(c => Number(c.metaDataId) === Number(metaDataId)) || cms[0];
    return (
        <>
            <div className="panel-header flex-none">{`消息 ${message.messageId}`}</div>
            <ConnectorTabs key={`${message.messageId}:${cm.metaDataId}`}
                message={message} cm={cm} channelId={channelId} channelName={channelName} platform={platform}
                anchor={anchor} onActiveStage={onActiveStage} onStageMenu={onStageMenu} />
        </>
    );
}

/* ---- advanced search dialog ------------------------------------------------------- */

/* Imperative modal (like the other dialogs): self-contained, reads the staged
   criteria passed in and hands the resolved criteria back through onApply. */
function openAdvancedSearch({ connectors, metaDataColumns, adv, onApply }: any) {
    /* ---- connector inclusion table (Id | Current Connector Name | Included) --
       Mirrors the Swing MessageBrowserAdvancedFilter: all checked = no filter;
       if "Deleted Connectors" (null) stays checked, exclude the unchecked real
       connectors; otherwise include only the checked real connectors. */
    const isConnChecked = (key: any) => {
        if (adv.includedMetaDataIds) return adv.includedMetaDataIds.includes(key);
        if (adv.excludedMetaDataIds) return key === null ? true : !adv.excludedMetaDataIds.includes(key);
        return true;
    };
    const connRows: any[] = [];
    const connTbody = h('tbody');
    for (const c of [...connectors, { metaDataId: null, name: '已删除的连接器' }]) {
        const input = h('input', { type: 'checkbox', checked: isConnChecked(c.metaDataId) });
        connRows.push({ key: c.metaDataId, input });
        connTbody.appendChild(h('tr',
            h('td', { class: 'w-[45px]' }, c.metaDataId === null ? '--' : String(c.metaDataId)),
            h('td', c.name),
            h('td', { class: 'text-center w-[81px]' }, input)));
    }
    const setAllConn = (v: any) => connRows.forEach(r => { r.input.checked = v; });
    const connBlock = h('div',
        h('div', { class: 'flex justify-end gap-2.5 mb-1.5' },
            h('a', { class: 'link-btn', onClick: () => setAllConn(true) }, '全选'),
            h('span.text-text-faint', '|'),
            h('a', { class: 'link-btn', onClick: () => setAllConn(false) }, '全不选')),
        h('div.dt-wrap', { class: 'max-h-[135px] overflow-auto' },
            h('table.dt',
                h('thead', h('tr', h('th', 'ID'), h('th', '当前连接器名称'), h('th', '包含'))),
                connTbody)));

    /* ---- id / numeric ranges (stacked "label: min – max" rows) ---- */
    const num = (value: any) => h('input', { type: 'number', value, class: 'flex-1 min-w-0 max-w-[135px]' });
    const inputs = {
        minMessageId: num(adv.minMessageId), maxMessageId: num(adv.maxMessageId),
        minOriginalId: num(adv.minOriginalId), maxOriginalId: num(adv.maxOriginalId),
        minImportId: num(adv.minImportId), maxImportId: num(adv.maxImportId),
        minSendAttempts: num(adv.minSendAttempts), maxSendAttempts: num(adv.maxSendAttempts),
        serverId: h('input', { type: 'text', value: adv.serverId, class: 'flex-1' })
    };
    const lbl = (text: any) => h('label', { class: 'w-[99px] flex-none text-right text-text-dim' }, text);
    const rangeRow = (label: any, a: any, b: any) => h('div', { class: 'flex items-center gap-2 mb-2' },
        lbl(label), a, h('span.text-text-faint', '–'), b);
    const singleRow = (label: any, el: any) => h('div', { class: 'flex items-center gap-2 mb-2' },
        lbl(label), el);

    const attachmentCheck = checkbox('含附件', adv.attachment);
    const errorCheck = checkbox('含错误', adv.error);

    /* ---- selectable search tables with right-side New/Delete ---- */
    function makeSelectableTable(head: any) {
        const tbody = h('tbody');
        const rows: any[] = [];
        let selected: any = null;
        const delBtn = h('button.btn', { disabled: true });
        const sel = (row: any) => {
            selected = row;
            tbody.querySelectorAll('tr').forEach(tr => tr.classList.remove('selected'));
            if (row) row.tr.classList.add('selected');
            (delBtn as any).disabled = !row;
        };
        delBtn.addEventListener('click', () => {
            if (!selected) return;
            const i = rows.indexOf(selected);
            selected.tr.remove();
            rows.splice(i, 1);
            sel(rows[Math.min(i, rows.length - 1)] ?? null);
        });
        const el = (onNew: any) => h('div', { class: 'flex gap-2 items-start' },
            h('div.dt-wrap', { class: 'flex-1 max-h-[135px] overflow-auto' },
                h('table.dt', h('thead', h('tr', head.map((l: any) => h('th', l)))), tbody)),
            h('div', { class: 'flex flex-col gap-1.5' },
                h('button.btn', { onClick: onNew }, '新建'), delBtn));
        delBtn.textContent = '删除';
        return { tbody, rows, sel, el };
    }

    /* Content Searches — one repeatable query param per content type. */
    const cs = makeSelectableTable(['内容类型', '包含']);
    function addContentSearchRow(type = 'rawContentSearch', text = '') {
        const row = {
            type: select(CONTENT_SEARCH_TYPES, type),
            text: h('input', { type: 'text', value: text, class: 'w-full' })
        };
        (row as any).tr = h('tr', { onMousedown: () => cs.sel(row) }, h('td', row.type), h('td', row.text));
        cs.rows.push(row);
        cs.tbody.appendChild((row as any).tr);
        cs.sel(row);
        return row;
    }
    adv.contentSearches.forEach((c: any) => addContentSearchRow(c.type, c.text));

    /* Custom Metadata searches — "COLUMN OPERATOR value" strings. */
    const ms = makeSelectableTable(['元数据', '运算符', '值', '忽略大小写']);
    function addMetaSearchRow(column?: any, operator = 'CONTAINS', value = '', ignoreCase = false) {
        const row = {
            column: metaDataColumns.length
                ? select(metaDataColumns.map((c: any) => c.name), column ?? metaDataColumns[0].name)
                : h('input', { type: 'text', value: column ?? '', placeholder: 'COLUMN_NAME' }),
            operator: select(META_SEARCH_OPERATORS, operator),
            value: h('input', { type: 'text', value, class: 'w-full' }),
            ignoreCase: h('input', { type: 'checkbox', checked: ignoreCase, title: '忽略大小写' })
        };
        (row as any).tr = h('tr', { onMousedown: () => ms.sel(row) },
            h('td', row.column), h('td', row.operator), h('td', row.value),
            h('td', { class: 'text-center w-[81px]' }, row.ignoreCase));
        ms.rows.push(row);
        ms.tbody.appendChild((row as any).tr);
        ms.sel(row);
        return row;
    }
    adv.metaDataSearches.forEach((m: any) => addMetaSearchRow(m.column, m.operator, m.value, m.ignoreCase));

    const sectionLabel = (text: any) => h('div', { class: 'font-semibold mt-3.5 mx-0 mb-1.5' }, text);

    modal({
        title: '高级搜索筛选',
        size: 'wide',
        body: h('div',
            connBlock,
            h('div', { class: 'mt-3.5' },
                rangeRow('消息 ID：', inputs.minMessageId, inputs.maxMessageId),
                rangeRow('原始 ID：', inputs.minOriginalId, inputs.maxOriginalId),
                rangeRow('导入 ID：', inputs.minImportId, inputs.maxImportId),
                singleRow('服务器 ID：', inputs.serverId),
                rangeRow('发送次数：', inputs.minSendAttempts, inputs.maxSendAttempts)),
            h('div', { class: 'flex gap-6 mt-1' },
                attachmentCheck.el, errorCheck.el),
            sectionLabel('内容搜索'),
            cs.el(() => addContentSearchRow().text.focus()),
            sectionLabel('自定义元数据搜索'),
            ms.el(() => addMetaSearchRow().value.focus())),
        buttons: [
            {
                label: '重置',
                onClick: () => { onApply(defaultAdvancedCriteria()); }
            },
            { label: '取消' },
            {
                label: '确定', primary: true,
                onClick: () => {
                    // Resolve the connector table into included/excluded ids.
                    let included = null, excluded = null;
                    const checked = connRows.filter(r => r.input.checked);
                    if (checked.length !== connRows.length) {
                        if (connRows.some(r => r.key === null && r.input.checked)) {
                            excluded = connRows.filter(r => !r.input.checked && r.key !== null).map(r => r.key);
                        } else {
                            included = checked.map(r => r.key).filter(k => k !== null);
                        }
                    }
                    // Stage the criteria + flag the button; the user runs the
                    // search with Search (no auto-search on apply).
                    onApply({
                        minMessageId: (inputs.minMessageId as any).value, maxMessageId: (inputs.maxMessageId as any).value,
                        minOriginalId: (inputs.minOriginalId as any).value, maxOriginalId: (inputs.maxOriginalId as any).value,
                        minImportId: (inputs.minImportId as any).value, maxImportId: (inputs.maxImportId as any).value,
                        serverId: (inputs.serverId as any).value,
                        minSendAttempts: (inputs.minSendAttempts as any).value, maxSendAttempts: (inputs.maxSendAttempts as any).value,
                        error: errorCheck.input.checked,
                        attachment: attachmentCheck.input.checked,
                        includedMetaDataIds: included,
                        excludedMetaDataIds: excluded,
                        contentSearches: cs.rows
                            .map(r => ({ type: r.type.value, text: r.text.value.trim() }))
                            .filter(r => r.text),
                        metaDataSearches: ms.rows
                            .map(r => ({ column: String(r.column.value).trim(), operator: r.operator.value, value: r.value.value, ignoreCase: r.ignoreCase.checked }))
                            .filter(r => r.column)
                    });
                }
            }
        ]
    });
}

/* ---- reprocess dialog ------------------------------------------------------------- */

/* Shared "Reprocessing Options" dialog (Swing ReprocessMessagesDialog) — used
   for both a single message and the whole result set. Overwrite checkbox +
   a "reprocess through the following destinations" table with Select All /
   Deselect All. All checked = reprocess through all (filterDestinations off);
   a subset turns on filterDestinations with those metaDataIds. The results
   variant adds the red warning and the REPROCESSALL confirmation. */
function reprocessDialog({ channelId, connectors, total, lastParams, messageId, isResults, onDone, assertCurrent = () => {}, assertSession }: any) {
    const destRows = connectors.filter((c: any) => Number(c.metaDataId) > 0).map((c: any) => ({
        metaDataId: c.metaDataId, name: c.name,
        input: h('input', { type: 'checkbox', checked: true })
    }));
    const overwrite = checkbox('覆盖现有消息并更新统计', false);
    const setAll = (v: any) => destRows.forEach((r: any) => { r.input.checked = v; });

    const destTable = destRows.length ? h('div',
        h('div', { class: 'flex justify-end gap-2.5 my-1 mx-0' },
            h('a', { class: 'link-btn', onClick: () => setAll(true) }, '全选'),
            h('span.text-text-faint', '|'),
            h('a', { class: 'link-btn', onClick: () => setAll(false) }, '全不选')),
        h('div.dt-wrap', { class: 'max-h-[144px] overflow-auto' },
            h('table.dt',
                h('thead', h('tr', h('th', '目的地'), h('th', { class: 'w-[81px]' }, '包含'))),
                h('tbody', destRows.map((d: any) => h('tr',
                    h('td', d.name || `目的地 ${d.metaDataId}`),
                    h('td', { class: 'text-center' }, d.input))))))) : null;

    modal({
        title: '重新处理选项',
        size: 'wide',
        body: h('div',
            isResults ? h('div', {
                class: 'text-err mb-2.5 text-[11px]'
            }, h('b', '警告：'), `这将重新处理当前搜索条件的全部 ${fmtNumber(total)} 条结果，包括未列在当前页的结果`) : null,
            overwrite.el,
            destRows.length ? h('div.mt-[13px]', '通过以下目的地重新处理：') : null,
            destTable),
        buttons: [
            { label: '取消' },
            {
                label: '确定', primary: true,
                onClick: async () => {
                    try { assertSession(); } catch { return false; }
                    const checked = destRows.filter((r: any) => r.input.checked).map((r: any) => r.metaDataId);
                    // No destinations, or all checked → reprocess through all (no filter).
                    const metaDataIds = (!destRows.length || checked.length === destRows.length) ? null : checked;
                    const filterDestinations = metaDataIds != null;
                    // The REPROCESSALL confirmation is gated on the
                    // "Reprocess/remove messages confirmation" preference.
                    if (isResults && getPref('confirmReprocessRemove') !== false) {
                        const answer = await promptDialog('重新处理结果',
                            '这将重新处理所有匹配当前搜索条件的消息，输入 REPROCESSALL 以继续');
                        try { assertSession(); } catch { return false; }
                        if (answer === null) return false;
                        if (String(answer).trim() !== 'REPROCESSALL') {
                            toast('必须输入 REPROCESSALL 才能重新处理结果', 'warn');
                            return false;
                        }
                    }
                    try {
                        assertSession();
                        assertCurrent();
                        if (isResults) {
                            // Reprocessing a whole result set runs as long as the
                            // engine needs — no client ceiling (timeoutMs: null).
                            await api.post(`/channels/${channelId}/messages/_reprocess`, null, {
                                params: { ...lastParams, replace: overwrite.input.checked, filterDestinations, metaDataId: metaDataIds || [] },
                                timeoutMs: null
                            });
                            assertSession();
                            toast('重新处理任务已提交');
                        } else {
                            await api.messages.reprocess(channelId, messageId, overwrite.input.checked, filterDestinations, metaDataIds || []);
                            assertSession();
                            toast('重新处理任务已发送');
                        }
                        onDone();
                    } catch (e: any) {
                        try { assertSession(); } catch { return false; }
                        toast(`重新处理失败：${e.message}`, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

/* ---- export results dialog -------------------------------------------------------- */

/* Content selectable for export, mirroring the Swing MessageExportPanel
   dropdown. 'xml' is the full serialized (re-importable) message; the rest
   extract one connector content type from the source or destination
   connector message(s). `ct` is the engine ContentType enum name used for
   the server-side _export endpoint. */
const EXPORT_CONTENT_OPTIONS = [
    { value: 'xml', label: 'XML 序列化消息', xml: true },
    { value: 'src:raw', label: '源连接器 - 原始', key: 'raw', ct: 'RAW', dest: false },
    { value: 'src:processedRaw', label: '源连接器 - 处理后原始', key: 'processedRaw', ct: 'PROCESSED_RAW', dest: false },
    { value: 'src:transformed', label: '源连接器 - 转换后', key: 'transformed', ct: 'TRANSFORMED', dest: false },
    { value: 'src:encoded', label: '源连接器 - 编码后', key: 'encoded', ct: 'ENCODED', dest: false },
    { value: 'src:response', label: '源连接器 - 响应', key: 'response', ct: 'RESPONSE', dest: false },
    { value: 'dst:raw', label: '目的地 - 原始', key: 'raw', ct: 'RAW', dest: true },
    { value: 'dst:transformed', label: '目的地 - 转换后', key: 'transformed', ct: 'TRANSFORMED', dest: true },
    { value: 'dst:encoded', label: '目的地 - 编码后', key: 'encoded', ct: 'ENCODED', dest: true },
    { value: 'dst:sent', label: '目的地 - 已发送', key: 'sent', ct: 'SENT', dest: true },
    { value: 'dst:response', label: '目的地 - 响应', key: 'response', ct: 'RESPONSE', dest: true },
    { value: 'dst:processedResponse', label: '目的地 - 处理后响应', key: 'processedResponse', ct: 'PROCESSED_RESPONSE', dest: true }
];

/* File Pattern variables (Swing MessageExportPanel variable list). */
const FILE_PATTERN_VARS = [
    ['消息 ID', '${message.messageId}'],
    ['服务器 ID', '${message.serverId}'],
    ['通道 ID', '${message.channelId}'],
    ['原始文件名', '${message.originalFileName}'],
    ['格式化消息日期', '${message.formattedMessageDate}'],
    ['格式化当前日期', '${message.formattedCurrentDate}'],
    ['时间戳', '${message.timestamp}'],
    ['唯一 ID', '${message.uniqueId}'],
    ['序号', '${message.count}']
];
const DEFAULT_FILE_PATTERN = '${message.channelId}_message_${message.messageId}.xml';

/* Password-protect algorithms — display name -> { server (EncryptionType),
   strength (core/zip.js generate option) }. */
const ENCRYPTION_ALGORITHMS = [
    { value: 'AES128', label: 'AES-128', strength: 128 },
    { value: 'AES256', label: 'AES-256', strength: 256 },
    { value: 'STANDARD', label: '标准', strength: 'standard' }
];

const dateStamp = (millis: any) => (fmtDate(millis) || '').replace(/[:\s]/g, '-');

/* Resolve a Swing-style file pattern for one message (My Computer mode).
   `count` is the 1-based running export index. Illegal filename characters
   are sanitized; '/' is kept so patterns may define sub-folders. */
function applyFilePattern(pattern: any, m: any, count: any, channelId: any) {
    const now = Date.now();
    const vals = {
        'message.messageId': String(m.messageId ?? ''),
        'message.serverId': String(displayValue(m.serverId) ?? ''),
        'message.channelId': String(channelId),
        'message.originalFileName': String(displayValue(m.importId) || m.messageId || ''),
        'message.formattedMessageDate': dateStamp(m.receivedDate),
        'message.formattedCurrentDate': dateStamp(now),
        'message.timestamp': String(now),
        'message.uniqueId': (crypto.randomUUID ? crypto.randomUUID() : `${now}-${count}`),
        'message.count': String(count)
    };
    return (pattern || DEFAULT_FILE_PATTERN)
        .replace(/\$\{([^}]+)\}/g, (_: any, name: any) => {
            const k = String(name).trim();
            return Object.prototype.hasOwnProperty.call(vals, k) ? (vals as any)[k] : '';
        })
        .replace(/[\\:*?"<>|]+/g, '_');
}

/* Insert a value before the last dot of a filename (to disambiguate
   multiple destination files that share one pattern). */
function suffixName(name: any, suffix: any) {
    const dot = name.lastIndexOf('.');
    return dot > name.lastIndexOf('/') ? `${name.slice(0, dot)}_${suffix}${name.slice(dot)}` : `${name}_${suffix}`;
}

/* Swing's XML MessageWriter serializes fetched attachments inside the Message
   object. Keep that exact importer-compatible shape for browser exports. */
function xmlWithAttachments(xml: string, attachments: any[]) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'message') {
        throw new Error('引擎返回的消息 XML 无效');
    }
    const message = doc.documentElement;
    const old = [...message.children].find(child => child.tagName === 'attachments');
    old?.remove();
    if (attachments.length) {
        const container = doc.createElement('attachments');
        for (const attachment of attachments) {
            const element = doc.createElement('attachment');
            const add = (tag: string, value: any) => {
                if (value === null || value === undefined) return;
                const child = doc.createElement(tag);
                child.textContent = typeof value === 'string' ? value : displayValue(value);
                element.appendChild(child);
            };
            add('id', attachment?.id);
            add('content', attachment?.content);
            add('type', attachment?.type);
            add('encrypt', attachment?.encrypt ?? false);
            add('encryptionHeader', attachment?.encryptionHeader);
            container.appendChild(element);
        }
        message.appendChild(container);
    }
    return new XMLSerializer().serializeToString(message);
}

/* Full Swing-style "Export Results" dialog (MessageExportDialog /
   MessageExportPanel). Operates on the whole result set for the current
   search filter. My Computer exports run in the browser (ZIP via the Save
   dialog, or one file per message into a chosen folder); Server export
   defers the whole job to POST /messages/_export (which holds the
   encryption key, so content Encrypt is fully supported there). */
function exportResultsDialog({ channelId, total, lastParams, assertCurrent = () => {}, assertSession }: any) {
    let aborted = false, running = false;
    const currentSession = () => {
        try { assertSession(); return true; }
        catch { return false; }
    };
    const assertActive = () => {
        assertSession();
        if (aborted) throw new Error('cancelled');
        assertCurrent();
    };

    const contentSel = select(EXPORT_CONTENT_OPTIONS, 'xml', { onChange: updateEnabled });
    const encryptCheck = checkbox('加密', false);
    const attachCheck = checkbox('包含附件', false);
    const compressionSel = select([{ value: 'none', label: '无' }, { value: 'zip', label: 'Zip' }], 'none', { onChange: updateEnabled });

    const radio = (name: any, checked?: any) => h('input', { type: 'radio', name, checked: checked || null, onChange: updateEnabled });
    const radioLabel = (input: any, text: any) => h('label', { class: 'inline-flex items-center gap-1 cursor-pointer' }, input, text);
    const pwYes = radio('exp-pw'); const pwNo = radio('exp-pw', true);
    const algoSel = select(ENCRYPTION_ALGORITHMS, 'AES128');
    const pwInput = h('input', { type: 'password', placeholder: '密码', class: 'w-full' });
    const toServer = radio('exp-to'); const toComputer = radio('exp-to', true);

    const rootInput = h('input', { type: 'text', placeholder: '/path/accessible/by/server', class: 'flex-1' });
    const patternInput = h('textarea', { rows: '3', class: 'w-full font-[family-name:var(--mono)] resize-y' });
    (patternInput as any).value = DEFAULT_FILE_PATTERN;

    const insertToken = (token: any) => {
        const s = (patternInput as any).selectionStart ?? (patternInput as any).value.length;
        const e = (patternInput as any).selectionEnd ?? s;
        (patternInput as any).value = (patternInput as any).value.slice(0, s) + token + (patternInput as any).value.slice(e);
        const p = s + token.length;
        patternInput.focus(); (patternInput as any).setSelectionRange(p, p);
    };
    const varList = h('div.tree', { class: 'max-h-[135px] overflow-auto border border-[var(--border)] rounded-[4px] p-1' },
        FILE_PATTERN_VARS.map(([label, token]) => h('div.tree-node', {
            title: `插入 ${token}`, draggable: 'true', class: 'cursor-grab',
            onClick: () => insertToken(token),
            onDragstart: (e: any) => { e.dataTransfer.setData('text/plain', token); e.dataTransfer.effectAllowed = 'copy'; }
        }, label)));

    const status = h('div.text-text-faint', `当前搜索匹配 ${fmtNumber(total)} 条消息`);
    const fill = h('div.progress-fill', { class: 'w-[0%]' });
    // A progressbar, not an anonymous div: an export of tens of thousands of
    // messages is the one long operation in the app, and its state was visual only.
    const barWrap = h('div.progress', {
        style: { display: 'none' },
        role: 'progressbar', 'aria-label': '导出进度',
        'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0'
    }, fill);

    function updateEnabled() {
        const opt = EXPORT_CONTENT_OPTIONS.find(o => o.value === contentSel.value) || EXPORT_CONTENT_OPTIONS[0];
        const server = (toServer as any).checked;
        // My Computer always downloads a single ZIP (the browser's Save dialog
        // chooses the location); Compression only applies to Server export.
        if (!server) compressionSel.value = 'zip';
        compressionSel.disabled = !server;
        const zip = compressionSel.value === 'zip';
        attachCheck.input.disabled = !opt.xml;
        if (!opt.xml) attachCheck.input.checked = false;
        (pwYes as any).disabled = (pwNo as any).disabled = !zip;
        if (!zip) { (pwYes as any).checked = false; (pwNo as any).checked = true; }
        algoSel.disabled = (pwInput as any).disabled = !(zip && (pwYes as any).checked);
        (rootInput as any).disabled = !server;
    }

    // Swing MessageExportPanel layout: a right-aligned label column with its
    // controls, and the file-pattern variable list in a side panel.
    const lbl = (t: any) => h('div', { class: 'text-right whitespace-nowrap self-center' }, t);
    const cell = (...c: any[]) => h('div', { class: 'flex items-center gap-2 flex-wrap' }, ...c);
    const grid = h('div', { class: 'grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-2 items-center' },
        lbl('内容：'), cell(contentSel, encryptCheck.el, attachCheck.el),
        lbl('压缩：'), cell(compressionSel),
        lbl('密码保护：'), cell(radioLabel(pwYes, '是'), radioLabel(pwNo, '否'), algoSel),
        lbl('密码：'), cell(pwInput),
        lbl('导出到：'), cell(radioLabel(toServer, '服务器'), radioLabel(toComputer, '我的电脑')),
        lbl('根路径：'), cell(rootInput, h('span.text-text-faint', { class: 'whitespace-nowrap' }, '/[timestamp].zip')),
        lbl('文件命名模式：'), cell(patternInput));

    const dlg = modal({
        title: '导出结果',
        size: 'wide',
        onClose: () => { aborted = true; },
        body: h('div', { class: 'flex flex-wrap gap-[16px]' },
            h('div', { class: 'flex-1 min-w-[234px] flex flex-col gap-2' }, grid, status, barWrap),
            h('div', { class: 'w-full sm:w-[180px] min-w-0 flex flex-col' },
                h('label', { class: 'block mb-0.5' }, '变量：'),
                varList)),
        buttons: [
            { label: '取消', onClick: () => { aborted = true; } },
            { label: '导出', primary: true, onClick: () => { if (!running) runExport(); return false; } }
        ]
    });
    updateEnabled();

    function setDisabled(v: any) {
        for (const c of [contentSel, encryptCheck.input, attachCheck.input, compressionSel, pwYes, pwNo, algoSel, pwInput, toServer, toComputer, rootInput, patternInput]) (c as any).disabled = v;
        const submit = dlg.el.querySelector<HTMLButtonElement>('.modal-foot .btn-primary');
        if (submit) submit.disabled = v;
        if (!v) updateEnabled();
    }
    function progress(done: any) {
        fill.style.width = total ? Math.round((done / total) * 100) + '%' : '0%';
        barWrap.setAttribute('aria-valuenow', String(done));
        status.textContent = `正在导出… ${fmtNumber(done)} / ${fmtNumber(total)}`;
    }

    async function auditExportSuccess(o: any, exportCount: number, rootPath: string) {
        if (exportCount <= 0) return;
        // Completion is still audited if the dialog closed after the export
        // was submitted, but never through a replacement browser session.
        assertSession();
        await api.messages.auditExportSuccess({
            rootPath,
            filePattern: o.pattern,
            exportCount: String(exportCount),
            contentType: o.opt.ct || '',
            encrypted: String(!!o.encryptContent),
            includeAttachments: String(!!o.includeAttachments),
            compressionFormat: o.compression === 'zip' ? 'zip' : '',
            passwordProtected: String(!!o.pwProtect)
        });
    }

    // Stream every export file to `sink(name, content)`; returns counts.
    async function eachFile(sink: any, opt: any, pattern: any, includeAttachments: any) {
        const BATCH = 100;
        let done = 0, files = 0, count = 0;
        for (let off = 0; off < total; off += BATCH) {
            assertActive();
            const rows = await api.messages.search(channelId, { ...lastParams, offset: off, limit: BATCH, includeContent: !opt.xml });
            assertActive();
            for (const m of rows) {
                assertActive();
                count++;
                const base = applyFilePattern(pattern, m, count, channelId);
                if (opt.xml) {
                    const messageId = String(m.messageId);
                    const xml = await api.getXml(`/channels/${channelId}/messages/${messageId}`);
                    assertActive();
                    const attachments = includeAttachments
                        ? await api.messages.attachments(channelId, messageId, true)
                        : [];
                    assertActive();
                    await sink(base, includeAttachments ? xmlWithAttachments(xml, attachments) : xml);
                    files++;
                } else {
                    const cms = connectorMessagesOf(m).filter(cm => opt.dest ? Number(cm.metaDataId) > 0 : Number(cm.metaDataId) === 0);
                    for (const cm of cms) {
                        assertActive();
                        const c = contentOf(cm[opt.key]);
                        if (c == null) continue;
                        await sink(cms.length > 1 ? suffixName(base, cm.metaDataId) : base, c);
                        files++;
                    }
                }
                assertActive();
                done++;
                progress(done);
            }
        }
        return { done, files };
    }

    async function runServerExport(o: any) {
        status.textContent = '正在提交服务器导出…';
        try {
            const params = { ...lastParams };
            delete params.offset; delete params.limit; delete params.includeContent;
            params.pageSize = 100;
            params.rootFolder = o.rootFolder;
            params.filePattern = o.pattern;
            params.encrypt = o.encryptContent;
            params.includeAttachments = o.includeAttachments;
            if (!o.opt.xml) { params.contentType = o.opt.ct; params.destinationContent = o.opt.dest; }
            if (o.compression === 'zip') {
                params.archiveFormat = 'zip';
                if (o.pwProtect && o.password) { params.password = o.password; params.encryptionType = o.algo.value; }
            }
            // The engine writes every matching message to its filesystem before
            // answering — minutes for a big filter — so no client ceiling.
            const count = toCount(await api.post(`/channels/${channelId}/messages/_export`, null, { params, timeoutMs: null }));
            try {
                await auditExportSuccess(o, count, o.rootFolder);
            } catch (e: any) {
                if (!aborted && currentSession()) {
                    dlg.close();
                    toast(`消息已导出，但成功审计记录失败：${e.message || e}`, 'error');
                }
                return;
            }
            if (aborted || !currentSession()) return;
            dlg.close();
            toast(`服务器已导出 ${fmtNumber(count)} 条消息到 ${o.rootFolder}`);
        } catch (e: any) {
            if (aborted || !currentSession()) return;
            toast(`服务器导出失败：${e.message}`, 'error');
            running = false; setDisabled(false);
        }
    }

    async function runExport() {
        if (running || aborted || !currentSession()) return;
        try { assertActive(); }
        catch (e: any) { if (!aborted && currentSession()) toast(e.message, 'error'); return; }
        const opt = EXPORT_CONTENT_OPTIONS.find(o => o.value === contentSel.value) || EXPORT_CONTENT_OPTIONS[0];
        const compression = compressionSel.value;
        const pattern = (patternInput as any).value.trim() || DEFAULT_FILE_PATTERN;
        const encryptContent = encryptCheck.input.checked;
        const includeAttachments = attachCheck.input.checked && opt.xml;
        const pwProtect = (pwYes as any).checked && compression === 'zip';
        const algo = ENCRYPTION_ALGORITHMS.find(a => a.value === algoSel.value) || ENCRYPTION_ALGORITHMS[0];
        const password = (pwInput as any).value;
        const server = (toServer as any).checked;
        const rootFolder = (rootInput as any).value.trim();

        if (server && !rootFolder) { toast('服务器导出需要填写根路径', 'warn'); return; }

        // My Computer (browser) export.
        if (!server && encryptContent) {
            toast('加密内容仅支持“服务器”导出，加密密钥保存在服务器端，请改用“服务器”或取消勾选“加密”', 'warn');
            return;
        }
        if (pwProtect && !password) { toast('请输入密码，或关闭“密码保护”', 'warn'); return; }

        // Claim the operation before auditing. Cancel/close is permanent for
        // this dialog, including while the audit or native picker is pending.
        running = true; setDisabled(true); barWrap.style.display = '';
        try { await api.messages.auditExport({}); assertActive(); }
        catch (e: any) {
            if (aborted || !currentSession()) return;
            toast(`导出审计记录失败：${e.message || e}`, 'error');
            running = false; setDisabled(false); barWrap.style.display = 'none';
            return;
        }
        if (server) return runServerExport({ opt, compression, pattern, encryptContent, includeAttachments, pwProtect, algo, password, rootFolder });

        const now = new Date();
        const pad = (n: any) => String(n).padStart(2, '0');
        const archiveName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.zip`;
        const buildZip = async () => {
            assertActive();
            const zip = createZip();
            const result = await eachFile((n: any, c: any) => { zip.add(n, c); }, opt, pattern, includeAttachments);
            assertActive();
            if (!result.files) throw new Error('结果中未找到该类型的内容');
            const blob = await zip.generate((pwProtect ? { password, strength: algo.strength } : {}) as any);
            assertActive();
            (buildZip as any).result = result;
            return blob;
        };

        try {
            // My Computer always downloads a single ZIP; the browser's Save
            // dialog (where supported) lets the user choose the location,
            // otherwise it goes to the default download folder.
            await saveFile(archiveName, 'application/zip', buildZip, assertActive);
            // buildZip.result is unset if the user cancelled the Save dialog.
            if ((buildZip as any).result) {
                const r = (buildZip as any).result;
                try {
                    await auditExportSuccess({ opt, compression: 'zip', pattern, encryptContent, includeAttachments, pwProtect }, r.done, 'My Computer');
                } catch (e: any) {
                    if (!aborted && currentSession()) {
                        dlg.close();
                        toast(`消息已导出，但成功审计记录失败：${e.message || e}`, 'error');
                    }
                    return;
                }
                if (aborted || !currentSession()) return;
                dlg.close();
                toast(`已导出 ${fmtNumber(r.files)} 个文件，来自 ${fmtNumber(r.done)} 条消息`);
            } else {
                if (aborted || !currentSession()) return;
                running = false; setDisabled(false); barWrap.style.display = 'none';
            }
        } catch (e: any) {
            if (aborted || !currentSession()) return;
            if (e && e.message === 'cancelled') { toast('导出已取消', 'warn'); dlg.close(); }
            else { toast(`导出失败：${e.message}`, 'error'); running = false; setDisabled(false); barWrap.style.display = 'none'; }
        }
    }
}

/* ---- the view --------------------------------------------------------------------- */

/* Multi-select status filter — the Swing browser's status checkboxes (any
   combination). A compact dropdown trigger opens a checklist; buildParams()
   emits one `status=` query param per selected status. */
const STATUS_FILTER_ORDER = ['RECEIVED', 'TRANSFORMED', 'FILTERED', 'QUEUED', 'SENT', 'ERROR', 'PENDING'];

function Field({ label, children }: any) {
    return <div className="field"><label>{label}</label>{children}</div>;
}

export function MessagesView({ params, query }: any) {
    const channelId = params.channelId;

    /* ---- search-engine state ------------------------------------------------
       Search is an explicit command, so its cursor lives in refs the commands
       mutate synchronously; the render-relevant results mirror into state.
       searchRef re-points to this render's runSearch so dialogs and context
       menus (which outlive the render that opened them) always call a fresh
       closure. */
    const offsetRef = useRef(0);
    const limitRef = useRef(Number(getPref('messagePageSize')) || 20);
    const totalRef = useRef<any>(null);   // full match count — null until counted (lazy) or auto-resolved on the last page
    const lastParamsRef = useRef<any>({});
    // The displayed rows and every result operation share one successful search.
    const resultRef = useRef<any>(null);
    const searchPendingRef = useRef(false);
    const searchRef = useRef<any>(null);
    // Latest selection mirror: async detail loads guard against a stale row, and
    // task-pane buttons resolve their target at execution time.
    const selectedRef = useRef<any>(null);
    const phiEnabledRef = useRef(false);
    const metaDataReadyRef = useRef(!channelId);
    const channelNameRef = useRef(channelId);

    // Staged advanced criteria (the dialog stages; Search runs). Deep-link from
    // the dashboard (double-click a connector row): pre-filter the search to
    // that single connector by its metaDataId.
    const advRef = useRef<any>(null);
    if (!advRef.current) {
        advRef.current = defaultAdvancedCriteria();
        if (query.metaDataId != null && query.metaDataId !== '') {
            advRef.current.includedMetaDataIds = [Number(query.metaDataId)];
        }
    }

    /* ---- criteria state ---- */
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [statusSel, setStatusSel] = useState(() => new Set());
    const [textSearch, setTextSearch] = useState('');
    const [textRegex, setTextRegex] = useState(false);
    const [connectorVal, setConnectorVal] = useState('');
    const [pageSize, setPageSize] = useState(() => String(Number(getPref('messagePageSize')) || 20));
    const [advOn, setAdvOn] = useState(() => advIsActive(advRef.current));
    const [searchSummary, setSearchSummary] = useState('当前搜索：（无，请点击搜索）');
    const [criteriaCollapsed, setCriteriaCollapsed] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);

    /* ---- results + table state ---- */
    const [connectors, setConnectors] = useState([] as any[]);
    const [channelName, setChannelName] = useState(channelId);
    /* Every channel, for the picker. The browser is reachable without one — the
       bare /messages route — and the picker is how you choose. */
    const [channelList, setChannelList] = useState([] as any[]);
    const [metaDataColumns, setMetaDataColumns] = useState([] as any[]);
    const [metaDataError, setMetaDataError] = useState<string | null>(null);
    const [messages, setMessages] = useState([] as any[]);
    // shown: null = no search has completed yet (blank counts label, legacy
    // parity) — distinct from a completed search with zero rows ('No results').
    const [pager, setPager] = useState<any>({ offset: 0, shown: null, total: null, hasNext: false });
    const [countBusy, setCountBusy] = useState(false);
    const [sort, setSort] = useState<any>({ key: 'id', dir: -1 });   // newest first by default
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [allExpanded, setAllExpanded] = useState(false);
    const [selected, setSelected] = useState<any>(null);             // {m, metaDataId}
    const [detail, setDetail] = useState<any>({ status: 'empty' });

    /* ---- compare state ------------------------------------------------------
       The anchor lives in core/compare.js (it has to survive this view and be
       resettable by non-React code — the api layer clears it when the session
       dies), so this is a mirror kept in step with its event. The open pair is
       local: the overlay is a component, not a route, so navigating away
       unmounts it and releases the content it holds. */
    const [anchor, setAnchor] = useState<any>(() => getAnchor());
    const [comparePair, setComparePair] = useState<any>(null);
    useEffect(() => on('compare:changed', () => setAnchor(getAnchor())), []);
    // The stage currently on screen in the detail pane, as a reference — what the
    // task-rail buttons act on. Mirrored into a ref for handlers that outlive the
    // render that created them.
    const activeStageRef = useRef<any>(null);
    const [activeStage, setActiveStage] = useState<any>(null);
    /* Compare BY VALUE, not identity. refFromConnectorMessage mints a fresh
       object on every call and <DetailTabs>'s effect calls it on every render
       (its `current` def is rebuilt each time), so storing the new object would
       re-render, which re-runs that effect, which stores another new object —
       React caps the runaway at 50 nested updates and logs "Maximum update
       depth exceeded" on every message selection. Bailing out when the
       reference means the same stage stops the cycle at the source. */
    const onActiveStage = useCallback((ref: any) => {
        activeStageRef.current = ref;
        setActiveStage((prev: any) => (sameStageRef(prev, ref) ? prev : ref));
    }, []);

    /* Column visibility (persisted separately from the manager, matching the
       legacy webadmin-msg-columns store — `def` flags are the fallback). */
    const [columnVis, setColumnVis] = useState(() => {
        try { return JSON.parse(localStorage.getItem('webadmin-msg-columns') || '{}'); } catch { return {}; }
    });
    const saveColumnVis = (v: any) => { try { localStorage.setItem('webadmin-msg-columns', JSON.stringify(v)); } catch { /* private mode */ } };
    const isVisible = (c: any, vis: any) => (c.key in vis) ? !!vis[c.key] : !!c.def;

    // Column order + widths (resizable / reorderable, persisted), like the
    // dashboard. Visibility stays with columnVis above; the manager owns only
    // order + widths. columnsRev bumps after manager mutations to re-render.
    const mgrRef = useRef<any>(null);
    if (!mgrRef.current) mgrRef.current = createColumnManager('messages', MSG_COL_WIDTHS);
    const mgr = mgrRef.current;
    const [columnsRev, setColumnsRev] = useState(0);

    const allCols = useMemo(() => buildColumns(channelName, metaDataColumns), [channelName, metaDataColumns]);
    const visibleCols = useMemo(() => {
        const present = allCols.filter(c => isVisible(c, columnVis));
        return mgr.order(present.map(c => c.key)).map((k: any) => present.find(c => c.key === k));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCols, columnVis, columnsRev]);

    const sortedMessages = useMemo(() => {
        const col = allCols.find(c => c.key === sort.key);
        if (!col) return messages;
        return [...messages].sort((a: any, b: any) => {
            const va = col.sort(a), vb = col.sort(b);
            return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        });
    }, [messages, sort, allCols]);

    /* ---- params + summary (built from the live criteria at search time) ---- */

    function buildParams() {
        const adv = advRef.current;
        const params: any = {};
        const start = toCalendarParam(startDate);
        const end = toCalendarParam(endDate);
        if (start) params.startDate = start;
        if (end) params.endDate = end;
        if (statusSel.size) params.status = [...statusSel];
        const text = textSearch.trim();
        if (text) {
            params.textSearch = text;
            if (textRegex) params.textSearchRegex = true;
        }
        // Connector inclusion: the advanced filter's table wins; otherwise the
        // quick Connector dropdown narrows to a single connector.
        if (adv.includedMetaDataIds) params.includedMetaDataId = adv.includedMetaDataIds;
        else if (adv.excludedMetaDataIds) params.excludedMetaDataId = adv.excludedMetaDataIds;
        else if (connectorVal !== '') params.includedMetaDataId = connectorVal;

        /* ---- advanced criteria (same query params on GET /messages, GET
           /messages/count, DELETE /messages and POST /messages/_reprocess) ---- */
        for (const key of ['minMessageId', 'maxMessageId', 'minOriginalId', 'maxOriginalId',
            'minImportId', 'maxImportId', 'minSendAttempts', 'maxSendAttempts']) {
            const value = String(adv[key]).trim();
            if (value !== '') params[key] = value;
        }
        if (adv.serverId.trim()) params.serverId = adv.serverId.trim();
        if (adv.error) params.error = true;
        if (adv.attachment) params.attachment = true;
        for (const cs of adv.contentSearches) {
            if (!cs.text) continue;
            (params[cs.type] = params[cs.type] || []).push(cs.text);
        }
        for (const ms of adv.metaDataSearches) {
            if (!ms.column) continue;
            // "COLUMN OPERATOR value" — MetaDataSearchParamConverterProvider format.
            const key = ms.ignoreCase ? 'metaDataCaseInsensitiveSearch' : 'metaDataSearch';
            (params[key] = params[key] || []).push(`${ms.column} ${ms.operator} ${ms.value}`);
        }
        return params;
    }

    /* Connectors clause for the search summary: included names, "all except …"
       for an excluded set, the quick dropdown's single connector, or "(any)". */
    function describeConnectors() {
        const adv = advRef.current;
        const nameOf = (id: any) => {
            const c = connectors.find(x => String(x.metaDataId) === String(id));
            return c ? c.name : `ID ${id}`;
        };
        if (adv.includedMetaDataIds) return adv.includedMetaDataIds.length ? adv.includedMetaDataIds.map(nameOf).join(', ') : '（无）';
        if (adv.excludedMetaDataIds) return `除 ${adv.excludedMetaDataIds.map(nameOf).join(', ')} 以外的全部`;
        if (connectorVal !== '') return nameOf(connectorVal);
        return '（任意）';
    }

    /* Human-readable "Current Search" summary (Swing's labeled box) rather than a
       raw key=value dump. Statuses / Date Range / Connectors always show (with
       "(any)"); the rest appear only when set. */
    function describeSearch() {
        const adv = advRef.current;
        const range = (lo: any, hi: any) => {
            lo = String(lo ?? '').trim(); hi = String(hi ?? '').trim();
            if (lo && hi) return `${lo}–${hi}`;
            if (lo) return `≥ ${lo}`;
            if (hi) return `≤ ${hi}`;
            return null;
        };
        const dt = (v: any) => v ? v.replace('T', ' ') : '（任意）';
        const parts: any[] = [];
        parts.push(`状态：${statusSel.size ? [...statusSel].join(', ') : '（任意）'}`);
        parts.push(`日期范围：${dt(startDate)} 至 ${dt(endDate)}`);
        const text = textSearch.trim();
        if (text) parts.push(`文本搜索：“${text}”${textRegex ? '（正则表达式）' : ''}`);
        parts.push(`连接器：${describeConnectors()}`);
        let r: any;
        if ((r = range(adv.minMessageId, adv.maxMessageId))) parts.push(`消息 ID：${r}`);
        if ((r = range(adv.minOriginalId, adv.maxOriginalId))) parts.push(`原始 ID：${r}`);
        if ((r = range(adv.minImportId, adv.maxImportId))) parts.push(`导入 ID：${r}`);
        if (adv.serverId.trim()) parts.push(`服务器 ID：${adv.serverId.trim()}`);
        if ((r = range(adv.minSendAttempts, adv.maxSendAttempts))) parts.push(`发送次数：${r}`);
        for (const cs of adv.contentSearches) {
            if (!cs.text) continue;
            const label = (CONTENT_SEARCH_TYPES.find(t => t.value === cs.type) || {}).label || cs.type;
            parts.push(`${label} 包含“${cs.text}”`);
        }
        for (const ms of adv.metaDataSearches) {
            if (!ms.column) continue;
            parts.push(`${ms.column} ${ms.operator} ${ms.value}${ms.ignoreCase ? '（忽略大小写）' : ''}`);
        }
        if (adv.attachment) parts.push('含附件');
        if (adv.error) parts.push('含错误');
        return parts.join(' · ');
    }

    /* ---- search (explicit command) ---- */

    async function loadMetaDataColumns() {
        if (!channelId) return true;
        try {
            const cols = (await api.channels.metaDataColumns(channelId)).filter(c => c && c.name);
            setMetaDataColumns(cols);
            phiEnabledRef.current = cols.some(col => String(col.name).toLowerCase() === 'patient_id');
            metaDataReadyRef.current = true;
            setMetaDataError(null);
            return true;
        } catch (e: any) {
            const error = String(e.message || e);
            metaDataReadyRef.current = false;
            setMetaDataError(error);
            toast(`加载通道元数据失败：${error}`, 'error');
            return false;
        }
    }

    // Search responses can resolve out of order (a slow page-1 landing after a
    // fast page-2); only the newest issued search may write results.
    const searchGenRef = useRef(0);

    async function runSearch(resetOffset: any, { automatic = false, offset = offsetRef.current }: any = {}) {
        const gen = ++searchGenRef.current;
        searchPendingRef.current = true;
        const candidate = {
            params: structuredClone(resetOffset ? buildParams() : lastParamsRef.current),
            offset: resetOffset ? 0 : offset,
            limit: resetOffset ? Number(pageSize) || 20 : limitRef.current,
            summary: resetOffset ? `当前搜索：${describeSearch()}` : resultRef.current?.summary,
            total: resetOffset ? null : totalRef.current
        };
        try {
            if (!metaDataReadyRef.current && !await loadMetaDataColumns()) return;
            if (gen !== searchGenRef.current) return;
            // Swing suppresses only the search it runs automatically while opening the
            // channel browser. A user-submitted search is audited even when it first has
            // to recover from a failed metadata-column load.
            const auditQuery = !!resetOffset && phiEnabledRef.current && !automatic;
            // Swing bounds an unbounded search at the engine's current message ID.
            // Keep that bound for every result operation, excluding later arrivals.
            if (candidate.params.maxMessageId == null) {
                const maximum = await api.messages.maxMessageId(channelId);
                if (maximum == null || !/^\d+$/.test(String(maximum)) || (typeof maximum === 'number' && !Number.isSafeInteger(maximum))) {
                    throw new Error('无法确定当前消息 ID 边界');
                }
                candidate.params.maxMessageId = String(maximum);
            }
            if (gen !== searchGenRef.current) return;
            // Fetch one extra row to learn whether a next page exists, instead of
            // paying for a COUNT on every search (Swing's lazy-count model).
            const search = api.messages.search(channelId, { ...candidate.params, offset: candidate.offset, limit: candidate.limit + 1 });
            // Swing starts loading the page and immediately audits the submitted
            // filter. Do not wait for the result: failed and superseded searches
            // are still PHI queries initiated by the user.
            if (auditQuery) {
                const attributes: Record<string, string> = {
                    channel: `Channel[id=${channelId},name=${channelNameRef.current}]`,
                    filter: JSON.stringify(candidate.params)
                };
                for (const key of ['metaDataSearch', 'metaDataCaseInsensitiveSearch']) {
                    for (const criterion of api.asList(candidate.params[key])) {
                        const match = String(criterion).match(/^PATIENT_ID\s*=\s*(.*)$/i);
                        if (match) attributes.patientId = match[1];
                    }
                }
                api.messages.auditQueriedPHI(attributes).catch((e: any) =>
                    toast(`无法记录 PHI 查询审计：${e.message || e}`, 'error'));
            }
            const rows = await search;
            if (gen !== searchGenRef.current) return;   // superseded by a newer search
            const list = rows.filter(m => m && typeof m === 'object');
            const hasNext = list.length > candidate.limit;
            if (hasNext) list.pop();   // drop the probe row
            // Last (or empty) page → the total is known for free; no COUNT needed.
            if (!hasNext) candidate.total = candidate.offset + list.length;
            // Commit only after a successful response; a failed replacement
            // leaves rows, filter, cursor, summary, and count together.
            resultRef.current = candidate;
            offsetRef.current = candidate.offset;
            limitRef.current = candidate.limit;
            totalRef.current = candidate.total;
            lastParamsRef.current = candidate.params;
            setSearchSummary(candidate.summary);
            selectedRef.current = null;
            setSelected(null);
            setDetail({ status: 'empty' });
            onActiveStage(null);
            // Destinations expanded by default, matching the Swing browser.
            const exp = new Set();
            for (const m of list) {
                if (connectorMessagesOf(m).some(cm => Number(cm.metaDataId) > 0)) exp.add(String(m.messageId));
            }
            setExpandedIds(exp);
            setAllExpanded(true);
            setMessages(list);
            setPager({ offset: offsetRef.current, shown: list.length, total: totalRef.current, hasNext });
        } catch (e: any) {
            if (gen !== searchGenRef.current) return;   // superseded — its results are on screen
            toast(`搜索失败：${e.message}`, 'error');
        } finally {
            if (gen === searchGenRef.current) searchPendingRef.current = false;
        }
    }
    searchRef.current = runSearch;

    /* The total match count is resolved lazily (Swing's Count button): a COUNT is
       expensive on large tables, so we don't run one on every search. */
    function captureResult() {
        const result = resultRef.current;
        const gen = searchGenRef.current;
        const assertCurrent = () => {
            if (!result || result !== resultRef.current || gen !== searchGenRef.current || searchPendingRef.current) {
                throw new Error('搜索条件已变更或仍在加载，请等待结果返回后再重试此操作');
            }
        };
        assertCurrent();
        return { result, assertCurrent };
    }

    async function ensureTotal(snapshot = captureResult()) {
        const { result, assertCurrent } = snapshot;
        assertCurrent();
        if (result.total != null) return result.total;
        const n = toCount(await api.messages.count(channelId, result.params));
        assertCurrent();
        result.total = totalRef.current = n;
        return n;
    }
    async function doCount() {
        const gen = searchGenRef.current;
        setCountBusy(true);
        let n;
        try { n = await ensureTotal(); }
        catch (e: any) {
            if (gen === searchGenRef.current) toast(`统计数量失败：${e.message}`, 'error');
            return;
        }
        finally { setCountBusy(false); }
        if (gen !== searchGenRef.current) return;   // superseded — the newer search owns the pager
        setPager((p: any) => ({ ...p, total: n }));
    }

    /* ---- selection + detail ---- */

    function selectMessage(m: any, metaDataId: any) {
        selectedRef.current = { m, metaDataId };
        setSelected({ m, metaDataId });
        // The detail pane is about to change what it's showing; the compare tasks
        // must not keep acting on the stage that is on its way out.
        onActiveStage(null);
        // The parent (source) row is a placeholder when the source connector
        // message isn't in the result (e.g. a destination-only status filter):
        // there's no connector in context, so show nothing rather than fetching
        // the full message and rendering its source — matching the Swing browser.
        if (Number(metaDataId) === 0 && !sourceOf(m)) setDetail({ status: 'empty' });
        else showDetail(m, metaDataId);
    }

    async function showDetail(row: any, metaDataId: any) {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        // The selection object is unique per click: A -> B -> A must not let
        // the first A request replace the last, even when both use the same row.
        const selection = selectedRef.current;
        setDetail({ status: 'loading' });
        const isCurrentSelection = () => {
            try { assertSession(); } catch { return false; }
            return selectedRef.current === selection;
        };
        let message: any;
        try {
            message = await api.messages.get(channelId, row.messageId);
            if (!message || typeof message !== 'object') throw new Error('引擎返回的消息无效');
        } catch (e: any) {
            if (!isCurrentSelection()) return;
            const error = `加载消息内容失败：${e.message || e}`;
            toast(error, 'error');
            setDetail({ status: 'error', error });
            return;
        }
        if (!isCurrentSelection()) return; // row or connector changed while loading
        try {
            const attachments = await api.messages.attachments(channelId, row.messageId);
            message.__attachments = Array.isArray(attachments) ? attachments : [];
        } catch (e: any) {
            if (!isCurrentSelection()) return;
            message.__attachments = [];
            message.__attachmentsError = String(e.message || e);
            toast(`加载附件失败：${e.message || e}`, 'error');
        }
        if (!isCurrentSelection()) return;
        setDetail({ status: 'ready', message, metaDataId });
        if (phiEnabledRef.current) {
            const connector = connectorMessagesOf(message)
                .find(cm => Number(cm.metaDataId) === Number(metaDataId));
            if (connector) {
                api.messages.auditAccessedPHI({
                    patientId: String(metaOfCm(connector, 'PATIENT_ID') || ''),
                    channel: `Channel[id=${channelId},name=${channelNameRef.current}]`,
                    messageId: String(connector.messageId ?? message.messageId)
                }).catch((e: any) => toast(`无法记录 PHI 访问审计：${e.message || e}`, 'error'));
            }
        }
    }

    /* Detail pane height: the global .split-handle mutates style.height directly
       during drags, so React never renders the height — a layout effect applies
       the 36px collapsed strip / restored expanded height only on transitions,
       preserving the user-dragged height across selections (legacy parity). */
    // Latest detail mirror, for menus built outside the render that loaded it
    // (the compare stage submenu asks what the open message actually stored).
    const detailRef = useRef<any>(detail);
    detailRef.current = detail;

    const detailPaneRef = useRef<any>(null);
    const detailHeightRef = useRef('38%');   // last expanded height
    const prevExpandedRef = useRef(false);
    const detailExpanded = detail.status !== 'empty';
    useLayoutEffect(() => {
        const el = detailPaneRef.current;
        if (!el) return;
        if (detailExpanded && !prevExpandedRef.current) {
            el.style.height = detailHeightRef.current;
        } else if (!detailExpanded) {
            if (prevExpandedRef.current) detailHeightRef.current = el.style.height || detailHeightRef.current;
            el.style.height = '36px';
        }
        prevExpandedRef.current = detailExpanded;
    }, [detailExpanded]);

    /* ---- table interactions ---- */

    function toggleAll() {
        const next = !allExpanded;
        setAllExpanded(next);
        const exp = new Set();
        if (next) for (const m of messages) {
            if (connectorMessagesOf(m).some(cm => Number(cm.metaDataId) > 0)) exp.add(String(m.messageId));
        }
        setExpandedIds(exp);
    }

    function openColumnMenu(e: any) {
        e.preventDefault();
        const items = allCols.map(c => ({
            label: (isVisible(c, columnVis) ? '✓  ' : '    ') + c.label,
            onClick: () => setColumnVis((vis: any) => {
                const next = { ...vis, [c.key]: !isVisible(c, vis) };
                saveColumnVis(next);
                return next;
            })
        }));
        (items as any).push('-', { label: '恢复默认', onClick: () => { saveColumnVis({}); setColumnVis({}); } });
        contextMenu(e.clientX, e.clientY, items as any);
    }

    /* ---- compare ------------------------------------------------------------
       Two entry points. From a content tab we already hold the loaded connector
       message, so the reference is exact. From a row we may not — the search
       results carry no content — so the stage submenu offers what the loaded
       detail knows and the choice is validated against a FRESH fetch, which is
       also what tells us whether the content is still there. */

    // The connector message currently loaded in the detail pane, when it is the
    // one being asked about. The only stored-stage knowledge available without
    // going back to the engine.
    function loadedConnectorMessage(row: any, metaDataId: any) {
        const d = detailRef.current;
        if (!d || d.status !== 'ready') return null;
        if (String(d.message?.messageId) !== String(row.messageId)) return null;
        return connectorMessagesOf(d.message).find(cm => Number(cm.metaDataId) === Number(metaDataId)) || null;
    }

    function takeAnchor(ref: any) {
        selectForCompare(ref);
    }

    /* These guards use cornerToast rather than toast(msg,'warn'): they answer a
       mis-click ("you picked the same content twice"), and the app's warn
       notification is an acknowledge-to-dismiss dialog, which would land on top
       of the row the user was aiming at and have to be dismissed before they
       could correct themselves. Engine failures below still use toast(). */
    function offerCandidate(ref: any) {
        const result = proposeCompare(ref);
        if (result === 'none') { cornerToast('请先选择要对比的内容', 'warn'); return; }
        // Diffing content against itself is never the question being asked, so
        // this stops before the modal rather than after it.
        if (result === 'same') { cornerToast('所选内容已作为对比项', 'warn'); return; }
        openCompareConfirm();
    }

    /* The confirm step. Titled for content, not messages: two stages of ONE
       message is a first-class case (what did the transformer change?), and
       "compare these two messages" would read as a mistake there. */
    function openCompareConfirm() {
        const left = getAnchor();
        const right = getPending();
        if (!left || !right) return;
        let confirmed = false;
        const sideRow = (side: any, ref: any, tone: any) => h('div.compare-confirm-row',
            h('span', { class: 'tag ' + tone }, side),
            h('span.mono', describeRef(ref)));
        modal({
            title: '对比所选内容？',
            body: h('div',
                sideRow('左侧', left, 'accent'),
                sideRow('右侧', right, 'amber'),
                /* Same CHANNEL and message: ids are a per-channel sequence, so
                   comparing message 5 of two channels is not one message's pipeline. */
                sameMessage(left, right)
                    ? h('div.compare-confirm-note', '这是同一条消息的两个阶段，用于查看管道处理改变了什么')
                    : null),
            /* Cancel, Esc and a click on the scrim all land here, and all mean the
               same thing: drop the SECOND selection, keep the anchor — the usual
               reason to back out is having picked the wrong second side. */
            onClose: () => {
                if (confirmed) return;
                cancelPending();
                toast('已取消——第二次选择已丢弃');
            },
            buttons: [
                { label: '取消' },
                {
                    label: '对比', primary: true, onClick: () => {
                        confirmed = true;
                        const pair = confirmCompare();
                        if (pair) setComparePair(pair);
                    }
                }
            ]
        });
    }

    /* Row-menu path: resolve the stage against a fresh fetch. Deliberately not
       cached — the message may have been reprocessed or pruned since it was
       listed, and the engine re-checks authorization on every read. */
    async function pickRowStage(row: any, metaDataId: any, contentType: any, mode: any) {
        let message;
        try {
            message = await api.messages.get(channelId, row.messageId);
        } catch (e: any) {
            toast(`加载消息内容失败：${e.message}`, 'error');
            return;
        }
        const cm = connectorMessagesOf(message).find(c => Number(c.metaDataId) === Number(metaDataId));
        if (!cm) { cornerToast(`连接器 ${metaDataId} 已不属于消息 ${row.messageId}`, 'warn'); return; }
        if (!storedContentTypes(cm).includes(contentType)) {
            cornerToast(`消息 ${row.messageId} 未存储 ${stageLabel(contentType)} 内容`, 'warn');
            return;
        }
        const ref = refFromConnectorMessage({ id: channelId, name: channelName }, row.messageId, cm, contentType);
        mode === 'select' ? takeAnchor(ref) : offerCandidate(ref);
    }

    /* The stage submenu. Stages the engine did not store are greyed with the
       reason, when the detail pane has told us which those are; before it has,
       every stage is offered and pickRowStage answers with the truth. */
    function compareStageItems(row: any, metaDataId: any, mode: any) {
        const cm = loadedConnectorMessage(row, metaDataId);
        const stored = cm ? storedContentTypes(cm) : null;
        return COMPARE_STAGES
            // The source connector has no Sent stage — it is not "not stored", it
            // does not exist, so it is not offered at all.
            .filter(s => !(s.type === 'SENT' && Number(metaDataId) === 0))
            .map(s => ({
                label: s.label + (stored && !stored.includes(s.type) ? '（未存储）' : ''),
                disabled: !!stored && !stored.includes(s.type),
                onClick: () => pickRowStage(row, metaDataId, s.type, mode)
            }));
    }

    /* Tab-context capture: the reference is for exactly what is on screen. */
    function stageContextMenu(ref: any, e: any) {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
            { header: true, label: '对比', sub: `${ref.connectorName} · ${stageLabel(ref.contentType)}` },
            {
                label: '选择以对比', icon: 'compare', task: 'doSelectForCompare', group: 'message',
                onClick: () => takeAnchor(ref)
            },
            {
                label: '与所选内容对比', icon: 'compare', task: 'doCompareWithSelection', group: 'message',
                disabled: !getAnchor(), onClick: () => offerCandidate(ref)
            }
        ]);
    }

    function selectForCompareTask() {
        const ref = activeStageRef.current;
        if (!ref) { cornerToast('请打开一条消息并选择内容标签，或右键单击某一行，以选择要对比的内容', 'warn'); return; }
        takeAnchor(ref);
    }

    function compareWithSelectionTask() {
        const ref = activeStageRef.current;
        if (!ref) { cornerToast('请打开一条消息并选择内容标签，或右键单击某一行，以选择要对比的内容', 'warn'); return; }
        offerCandidate(ref);
    }

    // Plugin-contributed per-message actions (platform.registerMessageAction) —
    // the message browser's twin of the Channels view's channelActions merge.
    // One registration feeds both the row menu and the Message Tasks pane; the
    // row is passed explicitly for the same reason the built-in items take it.
    function messageActionItems(m: any, metaDataId: any): any[] {
        const id = Number(metaDataId);
        const ctx = {
            platform, channelId, message: m, metaDataId: id,
            connectorMessage: connectorMessagesOf(m).find((cm: any) => Number(cm.metaDataId) === id) ?? null
        };
        return platform.messageActions()
            .filter((a: any) => (a.isEnabled ? a.isEnabled(ctx) : true))
            .map((a: any): any => ({
                id: a.id || a.label, label: a.label, icon: a.icon, task: a.task, group: a.group || 'message',
                onClick: () => a.onInvoke(m, ctx)
            }));
    }

    // Right-click parity with the Swing Message Browser (Frame.messagePopupMenu —
    // the full Message Tasks list). Per-message items take this row explicitly —
    // the menu outlives the render that opened it, so it never reads selection
    // state that may have moved on.
    function messageRowMenu(m: any, metaDataId: any, e: any) {
        e.preventDefault();
        selectMessage(m, metaDataId);
        const pluginItems = messageActionItems(m, metaDataId);
        contextMenu(e.clientX, e.clientY, [
            { label: '刷新', icon: 'refresh', task: 'doRefreshMessages', group: 'message', onClick: () => searchRef.current(true) },
            { label: '发送消息', icon: 'send', task: 'doSendMessage', group: 'message', onClick: () => sendMessageTask() },
            '-',
            { label: '导入消息', icon: 'import', task: 'doImportMessages', group: 'message', onClick: () => importMessagesTask() },
            { label: '导出结果', icon: 'export', task: 'doExportMessages', group: 'message', onClick: () => exportResultsTask() },
            '-',
            { label: '重新处理结果', icon: 'transform', task: 'doReprocessFilteredMessages', group: 'message', onClick: () => reprocessResultsTask() },
            { label: '重新处理消息', icon: 'transform', task: 'doReprocessMessage', group: 'message', onClick: () => reprocessTask(m) },
            '-',
            { label: '查看附件', icon: 'eye', task: 'viewImage', group: 'message', onClick: () => viewAttachmentsModal(platform, channelId, m) },
            { label: '导出附件', icon: 'export', task: 'doExportAttachment', group: 'message', onClick: () => exportAttachmentTask(platform, channelId, m) },
            '-',
            {
                label: '选择以对比', icon: 'compare', task: 'doSelectForCompare', group: 'message',
                items: compareStageItems(m, metaDataId, 'select')
            },
            {
                label: '与所选内容对比', icon: 'compare', task: 'doCompareWithSelection', group: 'message',
                disabled: !getAnchor(), items: compareStageItems(m, metaDataId, 'compare')
            },
            ...(pluginItems.length ? ['-', ...pluginItems] : []),
            '-',
            { label: '移除消息', icon: 'trash', danger: true, task: 'doRemoveMessage', group: 'message', onClick: () => removeMessageTask(m) },
            { label: '移除结果', icon: 'trash', danger: true, task: 'doRemoveFilteredMessages', group: 'message', onClick: () => removeResultsTask() },
            { label: '移除全部消息', icon: 'trash', danger: true, task: 'doRemoveAllMessages', group: 'message', onClick: () => removeAllTask() }
        ]);
    }

    /* ---- tasks ---- */

    function requireSelection() {
        const sel = selectedRef.current;
        if (!sel) { toast('请先选择消息', 'warn'); return null; }
        return sel.m;
    }

    function sendMessageTask() {
        openSendMessageDialog(platform, channelId, () => searchRef.current(false));
    }

    function reprocessTask(row = requireSelection()) {
        if (!row) return;
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); }
        catch { return; }
        reprocessDialog({
            channelId, connectors, total: totalRef.current, lastParams: lastParamsRef.current,
            messageId: row.messageId, isResults: false, onDone: () => searchRef.current(false), assertSession
        });
    }

    async function removeMessageTask(row = requireSelection()) {
        if (!row) return;
        if (getPref('confirmReprocessRemove') !== false &&
            !await confirmDialog('移除消息', `确定永久移除消息 ${row.messageId}？此操作无法撤销`, { danger: true, okLabel: '移除' })) return;
        try {
            await api.messages.remove(channelId, row.messageId);
            toast('消息已移除');
            searchRef.current(false);
        } catch (e: any) {
            toast(`移除失败：${e.message}`, 'error');
        }
    }

    async function removeAllTask() {
        // An undeployed channel has no dashboard status (404) and is safe to
        // treat like a stopped channel for message removal.
        let state: string | null = null;
        try {
            const status: any = await api.status.one(channelId);
            state = status?.state ? String(status.state).toUpperCase() : null;
        } catch (e: any) {
            if (e?.status !== 404) {
                toast(`无法确定通道状态：${e.message}`, 'error');
                return;
            }
        }
        openRemoveAllMessagesDialog({
            channels: [{ channelId, name: channelName, state }],
            onDone: () => searchRef.current(true)
        });
    }

    /* ---- results operations (operate on the current search filter) ---- */

    async function removeResultsTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); }
        catch { return; }
        let total, snapshot;
        try { snapshot = captureResult(); total = await ensureTotal(snapshot); assertSession(); }
        catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`统计数量失败：${e.message}`, 'error'); return;
        }
        if (getPref('confirmReprocessRemove') !== false) {
            const text = await promptDialog('移除结果',
                `确定从 ${channelName} 永久移除匹配当前搜索的全部 ${fmtNumber(total)} 条消息？` +
                '此操作无法撤销，请输入 REMOVE 以确认');
            try { assertSession(); } catch { return; }
            if (text === null) return;
            if (text.trim() !== 'REMOVE') {
                toast('确认文本不匹配，未移除任何内容', 'warn');
                return;
            }
        }
        try {
            assertSession();
            snapshot.assertCurrent();
            // DELETE /channels/{id}/messages is the query-param twin of POST
            // _remove (which takes a MessageFilter body); it accepts the exact
            // search params already built for GET /messages. Removing a whole
            // result set can outlast the default ceiling — no client timeout.
            await api.del(`/channels/${channelId}/messages`, snapshot.result.params, { timeoutMs: null });
            assertSession();
            toast('消息已移除');
            searchRef.current(true);
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`移除结果失败：${e.message}`, 'error');
        }
    }

    async function reprocessResultsTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); }
        catch { return; }
        let total, snapshot;
        try { snapshot = captureResult(); total = await ensureTotal(snapshot); assertSession(); }
        catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`统计数量失败：${e.message}`, 'error'); return;
        }
        reprocessDialog({
            channelId, connectors, total, lastParams: snapshot.result.params, assertCurrent: snapshot.assertCurrent, assertSession,
            isResults: true, onDone: () => searchRef.current(false)
        });
    }

    function importMessagesTask() {
        return withEditorSave(importMessagesUnlocked, '正在导入消息…');
    }

    async function importMessagesUnlocked() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        let imported = 0;
        let failed = 0;
        let lastError: any = null;
        let writeAttempted = false;
        try {
            const source = await messageImportDialog(assertSession);
            assertSession();
            if (!source) return;
            if ('path' in source) {
                writeAttempted = true;
                const response = await api.post(`/channels/${channelId}/messages/_importFromPath`, source.path, {
                    contentType: 'text/plain', params: { includeSubfolders: source.recursive }, timeoutMs: null
                });
                assertSession();
                const result = response?.messageImportResult || response;
                imported = Number(result?.successCount);
                const total = Number(result?.totalCount);
                if (!Number.isInteger(imported) || !Number.isInteger(total) || imported < 0 || total < imported) {
                    throw new Error('服务器返回的导入结果无效，请刷新以检查已导入的消息');
                }
                failed = total - imported;
                toast(`已从 ${source.path} 成功导入 ${total} 条中的 ${imported} 条消息`, failed ? 'warn' : undefined);
            } else {
                for await (const file of readMessageFiles(source.files, source.recursive, assertSession)) {
                    assertSession();
                    // Preserve the serialized engine message and its original
                    // importId; the engine assigns the newly imported message ID.
                    const blocks = file.content.match(/<message>[\s\S]*?<\/message>/g) || [];
                    for (const xml of blocks) {
                        try {
                            assertSession();
                            writeAttempted = true;
                            await api.post(`/channels/${channelId}/messages/_import`, xml, { contentType: 'application/xml' });
                            assertSession();
                            imported++;
                        } catch (error: any) {
                            assertSession();
                            failed++;
                            lastError = error;
                        }
                    }
                }
                if (!imported && !failed) toast('未找到可导入的消息', 'warn');
                else if (failed) toast(`已导入 ${imported} 条消息，${failed} 条失败：${lastError.message}`, 'error');
                else toast(`已导入 ${imported} 条消息`);
            }
        } catch (error: any) {
            try { assertSession(); } catch { return; }
            toast(`导入失败${imported || failed ? `（已导入 ${imported} 条，失败 ${failed} 条）` : ''}：${error.message || error}`, 'error');
        } finally {
            try {
                assertSession();
                if (writeAttempted) searchRef.current(true);
            } catch { /* an expired session must not trigger another request */ }
        }
    }

    async function exportResultsTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); }
        catch { return; }
        let total, snapshot;
        try { snapshot = captureResult(); total = await ensureTotal(snapshot); assertSession(); }
        catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`统计数量失败：${e.message}`, 'error'); return;
        }
        if (!total) { toast('没有可导出的结果', 'warn'); return; }
        exportResultsDialog({ channelId, total, lastParams: snapshot.result.params, assertCurrent: snapshot.assertCurrent, assertSession });
    }

    /* ---- status filter dropdown (imperative checklist over the trigger) ---- */

    const [statusMenuOpen, setStatusMenuOpen] = useState(false);

    /* The status filter is a checklist, not a list of commands, so its items are
       Radix menuitemcheckboxes — announced with their checked state, and operable
       with the arrows/type-ahead/Escape the hand-built version never had. */
    function closeStatusMenu() { setStatusMenuOpen(false); }

    /* Reset clears every criterion (main bar + advanced) without running a search
       — matching Swing's resetSearchCriteria. The Current Search box keeps showing
       the last executed search until the next Search. */
    function resetSearch() {
        setStartDate('');
        setEndDate('');
        setStatusSel(new Set());
        closeStatusMenu();
        setTextSearch('');
        setTextRegex(false);
        setConnectorVal('');
        setPageSize(String(Number(getPref('messagePageSize')) || 20));
        advRef.current = defaultAdvancedCriteria();
        setAdvOn(false);
    }

    function openAdvanced() {
        // Close the narrow Filters popover first, so it doesn't float over the modal.
        setFiltersOpen(false);
        openAdvancedSearch({
            connectors, metaDataColumns, adv: advRef.current,
            onApply: (next: any) => { advRef.current = next; setAdvOn(advIsActive(next)); }
        });
    }

    /* ---- filters popover (narrow layout) ---- */

    /* Wide, the criteria are an inline block the "Search Criteria" heading
       collapses; narrow, they move behind the Filters button as a popover. Radix
       positions and portals a popover, so it cannot also be the inline block —
       hence the threshold the container query used to apply is measured here. */
    const criteriaPanelRef = useRef<any>(null);
    const [narrowCriteria, setNarrowCriteria] = useState(false);
    useLayoutEffect(() => {
        const el = criteriaPanelRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setNarrowCriteria(entry.contentRect.width <= CRITERIA_INLINE_MIN));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /* ---- bootstrap ---- */

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (channelId) {
                try {
                    const names = await api.channels.connectorNames(channelId);
                    if (!cancelled) setConnectors(connectorEntries(names));
                } catch (e: any) {
                    toast(`加载连接器失败：${e.message}`, 'error');
                }
                if (!cancelled) await loadMetaDataColumns();
            }
            try {
                const map = await api.channels.idsAndNames();
                const pairs = idNamePairs(map);
                if (!cancelled) setChannelList(pairs.slice().sort((a: any, b: any) => a.name.localeCompare(b.name)));
                const found = pairs.find(c => c.id === channelId);
                if (found && !cancelled) {
                    setChannelName(found.name);
                    channelNameRef.current = found.name;
                    // route:changed resets the banner to the static route title after
                    // this async handler returns; defer past it (rAF runs after that
                    // microtask, before paint) so the channel name sticks without a flash.
                    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
                        detail: { title: `通道消息 - ${found.name}` }
                    })));
                }
            } catch (e: any) { toast(`加载通道失败：${e.message || e}`, 'error'); }
            // Nothing to search until a channel is chosen.
            if (!cancelled && channelId && metaDataReadyRef.current) searchRef.current(true, { automatic: true });
        })();
        if (channelId && query.send === '1') setTimeout(() => { if (!cancelled) sendMessageTask(); }, 200);
        // Invalidate the latest request counter, including searches started since mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return () => { cancelled = true; ++searchGenRef.current; selectedRef.current = null; resultRef.current = null; closeStatusMenu(); };
        // Build once; channelId is stable for the view's lifetime (route remount on change).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- render ---- */

    const statusLabel = statusSel.size === 0 ? '任意'
        : statusSel.size === 1 ? [...statusSel][0]
            : `已选 ${statusSel.size} 项`;
    const totalStr = pager.total == null ? '?' : fmtNumber(pager.total);
    const hasSel = !!selected;

    /* Defined once and mounted inline or in the popover — two homes, not two copies. */
    /* WHICH channel, as opposed to what to search for — so it belongs beside the
       panel heading rather than in the criteria grid, and stays reachable while
       the criteria are collapsed. Changing it navigates, keeping the URL the
       thing that identifies a search and re-bootstrapping the view against the
       new channel's connectors and metadata columns. */
    const channelPicker = (
        <label className="msg-channel">
            <span>通道</span>
            <select value={channelId || ''} aria-label="通道"
                onChange={(e: any) => {
                    const id = e.target.value;
                    router.navigate(id ? `/messages/${id}` : '/messages');
                }}>
                <option value="">请选择通道…</option>
                {channelList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        </label>
    );

    const criteria = (
        <>
                        <div className="form-row">
                            <Field label="开始日期">
                                <DateTimeField value={startDate} onChange={setStartDate} label="开始日期" />
                            </Field>
                            <Field label="结束日期">
                                <DateTimeField value={endDate} onChange={setEndDate} label="结束日期" />
                            </Field>
                            <Field label="状态">
                                <DropdownMenu.Root open={statusMenuOpen} onOpenChange={setStatusMenuOpen}>
                                    <DropdownMenu.Trigger asChild>
                                        <button type="button" className="btn justify-between min-w-[119px] font-normal">
                                            <span className="truncate">{statusLabel as any}</span>
                                            <span className="text-text-faint ml-2" aria-hidden="true">▾</span>
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                        <DropdownMenu.Content className="ctx-surface min-w-[144px]"
                                            align="start" sideOffset={4} collisionPadding={8}>
                                            {STATUS_FILTER_ORDER.map((st: any) => (
                                                <DropdownMenu.CheckboxItem key={st} className="ctx-item"
                                                    checked={statusSel.has(st)}
                                                    /* Ticking one status shouldn't shut the list — you
                                                       nearly always pick more than one. */
                                                    onSelect={(e: any) => e.preventDefault()}
                                                    onCheckedChange={(on: any) => setStatusSel((prev: any) => {
                                                        const next = new Set(prev);
                                                        on ? next.add(st) : next.delete(st);
                                                        return next;
                                                    })}>
                                                    {/* The slot is always there — ItemIndicator itself
                                                        unmounts when unchecked, which would shuffle the labels. */}
                                                    <span className="ctx-check" aria-hidden="true">
                                                        <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
                                                    </span>
                                                    {st}
                                                </DropdownMenu.CheckboxItem>
                                            ))}
                                            <DropdownMenu.Separator className="ctx-sep" />
                                            <DropdownMenu.Item className="ctx-item"
                                                onSelect={() => setStatusSel(new Set())}>清除（任意）</DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                </DropdownMenu.Root>
                            </Field>
                            {/* The Regex checkbox rides on the label line (top-right of the
                                field) so it costs no slot in the criteria row. */}
                            <div className="field relative">
                                <label>文本搜索</label>
                                <label className="check msg-regex"
                                    title="将文本搜索按正则表达式处理">
                                    <input type="checkbox" checked={textRegex} onChange={(e: any) => setTextRegex(e.target.checked)} />
                                    正则表达式
                                </label>
                                <input type="text" placeholder="搜索消息内容…" className="w-[198px]"
                                    value={textSearch} onChange={(e: any) => setTextSearch(e.target.value)}
                                    onKeyDown={(e: any) => { if (e.key === 'Enter') runSearch(true); }} />
                            </div>
                            <Field label="连接器">
                                <select value={connectorVal} onChange={(e: any) => setConnectorVal(e.target.value)}>
                                    <option value="">任意</option>
                                    {connectors.map(c => (
                                        <option key={c.metaDataId} value={String(c.metaDataId)}>{`${c.name} (${c.metaDataId})`}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="每页条数">
                                <select value={pageSize} onChange={(e: any) => setPageSize(e.target.value)}>
                                    {[20, 50, 100].map(n => <option key={n} value={String(n)}>{n}</option>)}
                                </select>
                            </Field>
                            <button className="btn btn-primary" onClick={() => runSearch(true)}><Icon name="search" />搜索</button>
                            <button className="btn" onClick={resetSearch}>重置</button>
                            {/* The Advanced… button carries a dot whenever any advanced
                                criterion is staged. Applying advanced criteria does NOT
                                auto-search — the user runs it with Search (Swing parity). */}
                            <button className="btn" onClick={openAdvanced}
                                title={advOn ? '已应用高级筛选条件，请点击搜索执行' : undefined}>
                                <Icon name="filter" />高级…
                                {advOn && <span className="inline-block w-[6px] h-[6px] ml-[6px] rounded-full bg-accent" />}
                            </button>
                        </div>
                        <div className="text-text-faint mt-1.5">{searchSummary}</div>
        </>
    );

    return (
        <div className="view">
            {/* Every task here acts on a channel (or a selection within one), so the
                pane stays empty until one is chosen rather than offering actions
                that cannot run. */}
            {channelId && <ViewTasks>
                <RailPane title="消息任务" paneKey="tasks:Message Tasks" group="message">
                    <div className="taskbar" data-pane-title="Message Tasks">
                        <TaskButton label="刷新" icon="refresh" task="doRefreshMessages" onClick={() => runSearch(true)} />
                        <TaskButton label="发送消息" icon="send" primary task="doSendMessage" onClick={sendMessageTask} />
                        <TaskButton label="导入消息" icon="import" task="doImportMessages" onClick={importMessagesTask} />
                        <TaskButton label="导出结果" icon="export" task="doExportMessages" onClick={exportResultsTask} />
                        <TaskButton label="移除全部消息" icon="trash" danger task="doRemoveAllMessages" onClick={removeAllTask} />
                        <TaskButton label="移除结果" icon="trash" danger task="doRemoveFilteredMessages" onClick={removeResultsTask} />
                        {hasSel && <TaskButton label="移除消息" icon="trash" danger task="doRemoveMessage" onClick={() => removeMessageTask()} />}
                        <TaskButton label="重新处理结果" icon="transform" task="doReprocessFilteredMessages" onClick={reprocessResultsTask} />
                        {hasSel && <TaskButton label="重新处理消息" icon="transform" task="doReprocessMessage" onClick={() => reprocessTask()} />}
                        <TaskButton label="选择以对比" icon="compare" task="doSelectForCompare"
                            onClick={selectForCompareTask}
                            title={activeStage ? `选择 ${describeRef(activeStage)} 进行对比` : undefined} />
                        {/* Greyed rather than hidden: the task exists, it just has
                            nothing to compare against yet (Swing's task-rail idiom). */}
                        <TaskButton label="与所选内容对比" icon="compare" task="doCompareWithSelection"
                            disabled={!anchor} onClick={compareWithSelectionTask}
                            title={anchor ? `与 ${describeRef(anchor)} 对比` : '请先选择要对比的内容'} />
                        {/* Plugin message actions for the selected row — selection-gated
                            like Remove/Reprocess Message, and the row menu's twins. */}
                        {hasSel && messageActionItems(selected.m, selected.metaDataId).map((a: any) => (
                            <TaskButton key={a.id} label={a.label} icon={a.icon} task={a.task} onClick={a.onClick} />
                        ))}
                    </div>
                </RailPane>
            </ViewTasks>}
            <div className="view-body flush flex flex-col h-full min-h-0">
                {metaDataError && <div className="panel border-danger text-danger mx-[13px] mt-3" role="alert">
                    加载通道元数据失败：{metaDataError}，搜索时会重试该请求
                </div>}
                {/* Wide: click the "Search Criteria" heading to collapse the criteria
                    in place. Narrow: they collapse into a "Filters" popover. */}
                {/* Wide: the "Search Criteria" heading is a real disclosure over the
                    inline criteria. Narrow: the same criteria move behind the Filters
                    button, where Radix owns Escape, outside-click and focus return. */}
                <div ref={criteriaPanelRef} className="panel filter-collapse flex-none mx-[13px] mt-3 mb-3">
                    {narrowCriteria ? (
                        <div className="panel-header flex items-center gap-2">
                            <span className="criteria-heading inline-flex items-center gap-1.5">搜索条件</span>
                            {channelPicker}
                            <Popover.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
                                <Popover.Trigger asChild>
                                    <button className="btn filter-toggle" type="button">
                                        <Icon name="filter" /><span>筛选</span><Icon name="chevD" />
                                    </button>
                                </Popover.Trigger>
                                <Popover.Portal>
                                    <Popover.Content className="panel-body filter-popover filter-popover-pop"
                                        align="start" sideOffset={6} collisionPadding={12}>
                                        {criteria}
                                    </Popover.Content>
                                </Popover.Portal>
                            </Popover.Root>
                        </div>
                    ) : (
                        <Collapsible.Root open={!criteriaCollapsed}
                            onOpenChange={(open: any) => setCriteriaCollapsed(!open)}>
                            <div className="panel-header flex items-center gap-2">
                                <Collapsible.Trigger asChild>
                                    <button type="button" className="criteria-heading inline-flex items-center gap-1.5">
                                        <span aria-hidden="true">{criteriaCollapsed ? '▸' : '▾'}</span>
                                        搜索条件
                                    </button>
                                </Collapsible.Trigger>
                                {channelPicker}
                            </div>
                            <Collapsible.Content className="panel-body filter-popover">
                                {criteria}
                            </Collapsible.Content>
                        </Collapsible.Root>
                    )}
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden oie-tablecard px-[13px] pt-3 pb-3">
                    {!channelId ? (
                        <div className="dt-empty">
                            <div className="empty-icon"><Icon name="messages" size={30} /></div>
                            请选择一个通道以搜索其消息
                        </div>
                    ) : (
                    <ResultsTable
                        cols={visibleCols} mgr={mgr} rows={sortedMessages}
                        expandedIds={expandedIds} allExpanded={allExpanded}
                        selKey={selected ? `${selected.m.messageId}:${selected.metaDataId}` : null}
                        anchorKey={anchor && String(anchor.channelId) === String(channelId)
                            ? `${anchor.messageId}:${anchor.metaDataId}` : null}
                        sortKey={sort.key} sortDir={sort.dir}
                        onSort={(key: any) => setSort((s: any) => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 })}
                        onToggleAll={toggleAll}
                        onToggleRow={(id: any) => setExpandedIds(prev => {
                            const next = new Set(prev);
                            next.has(id) ? next.delete(id) : next.add(id);
                            return next;
                        })}
                        onSelect={selectMessage}
                        onRowMenu={messageRowMenu}
                        onColumnMenu={openColumnMenu}
                        onColumnsChange={() => setColumnsRev(r => r + 1)} />
                    )}
                </div>

                <div className="filterbar flex-none panel overflow-visible mx-[13px]">
                    <button className="btn" disabled={pager.offset <= 0}
                        onClick={() => runSearch(false, { offset: 0 })}>« 首页</button>
                    <button className="btn" disabled={pager.offset <= 0}
                        onClick={() => runSearch(false, { offset: Math.max(0, offsetRef.current - limitRef.current) })}>‹ 上一页</button>
                    <button className="btn" disabled={!pager.hasNext}
                        onClick={() => runSearch(false, { offset: offsetRef.current + limitRef.current })}>下一页 ›</button>
                    {/* Can't jump to the last page without a total. */}
                    <button className="btn" disabled={pager.total == null}
                        onClick={() => {
                            runSearch(false, { offset: Math.max(0, Math.floor(Math.max(0, totalRef.current - 1) / limitRef.current) * limitRef.current) });
                        }}>末页 »</button>
                    <span className="counts">
                        {pager.shown == null ? ''
                            : pager.shown === 0 ? '无结果'
                                : `${fmtNumber(pager.offset + 1)}–${fmtNumber(pager.offset + pager.shown)} 共 ${totalStr}`}
                    </span>
                    {/* Nothing left to count once the total is known. */}
                    <button className="btn" disabled={pager.total != null || countBusy} onClick={doCount}>统计数量</button>
                </div>

                <div className="split-handle mx-[13px]" data-orient="v" data-resize="next" />
                <div ref={detailPaneRef} className="flex-none h-[32px] overflow-hidden flex flex-col panel mx-[13px] mb-3">
                    <DetailBody detail={detail} channelId={channelId} channelName={channelName} platform={platform}
                        anchor={anchor} onActiveStage={onActiveStage} onStageMenu={stageContextMenu} />
                </div>
            </div>
            <CompareChip />
            {/* Mounted INSIDE the view: navigating away unmounts it, which is the
                teardown path that releases the fetched content. */}
            {comparePair && (
                <CompareOverlay pair={comparePair}
                    onClose={(info: any) => {
                        setComparePair(null);
                        // A session that ended is already telling the user what
                        // happened on the login screen; don't stack a toast on it.
                        if (info?.sessionEnded) return;
                        /* Closing keeps the anchor so the next comparison can reuse
                           it, which is easy to miss once a full-viewport overlay
                           disappears — so the toast names what is still live rather
                           than what went away. */
                        const kept = info?.cleared ? null : getAnchor();
                        toast(kept
                            ? `对比已关闭——${describeRef(kept)} 仍被选为对比基准`
                            : '对比已关闭');
                    }} />
            )}
        </div>
    );
}
