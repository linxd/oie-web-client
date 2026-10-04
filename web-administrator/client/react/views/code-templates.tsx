/*
 * Code Templates view — fully declarative React. The library/template tree is
 * the controlled <TreeTable>; the editor pane branches on the selection into
 * the <LibraryEditor> (name/include-new + description + channel checkbox list)
 * or the template editor (<TemplateForm> + <CodeEditor> island + the
 * <ContextPanel> checkbox tree).
 *
 * The libraries/templates are an EDIT-SESSION MODEL: the objects are mutated in
 * place (their identity is what saveAll PUTs, with the engine's round-trip
 * fields preserved) and markDirty() bumps the container identity so React
 * repaints. Two documented refs bridge mount-captured contracts: dirtyRef (the
 * navGuard/tab-close guards registered once) and entriesNowRef (save/import
 * mutations act on the latest-known list, never a render-stale snapshot).
 *
 * Saving mirrors the Swing client: libraries, templates, and removals
 * are submitted together through /codeTemplateLibraries/_bulkUpdate, with
 * revision-conflict prompting before an override retry. The script-completions
 * cache is invalidate()d on every mutation so script editors refetch the new scope.
 */

import { withEditorSave } from '../save-lock.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast, confirmDialog, saveFile, pickFile, contextMenu, fmtDate } from '@oie/web-ui';
import { TreeTable, TreeLabel } from '../tree-table.jsx';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import { validateScript } from '../../core/serialize.js';
import { invalidate as invalidateCompletions } from '../../core/script-completions.js';
import { ViewTasks } from '../mount.jsx';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { RailPane, TaskButton, CodeEditor } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { parseLibraryImport, prepareLibraryImport, parseTemplateImport, prepareTemplateImport } from './code-template-import.js';
import { libraryImportCallbacks } from './code-template-import-dialogs.js';


const CT_COLUMNS = [
    { key: 'name', label: '名称' },
    { key: 'id', label: 'ID' },
    { key: 'description', label: '描述' },
    { key: 'revision', label: '修订版本', align: 'right' },
    { key: 'lastModified', label: '上次修改' }
];
const CT_COL_WIDTHS = { name: 300, id: 280, description: 260, revision: 80, lastModified: 150 };

const PROPERTIES_CLASS = 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties';

/* CodeTemplateProperties.CodeTemplateType (XStream serializes enum names) */
const TEMPLATE_TYPES = [
    { value: 'FUNCTION', label: '函数' },
    { value: 'DRAG_AND_DROP_CODE', label: '拖放代码块' },
    { value: 'COMPILED_CODE', label: '已编译代码块' }
];

/* ContextType enum, grouped the way the Swing context tree presents it.
   The group `label` values are identifiers compared by CONNECTOR_CONTEXTS
   below, so only their display captions are localized. */
const CONTEXT_GROUPS = [
    { label: 'Global Scripts', types: [
        ['GLOBAL_DEPLOY', '部署脚本'],
        ['GLOBAL_UNDEPLOY', '取消部署脚本'],
        ['GLOBAL_PREPROCESSOR', '预处理器脚本'],
        ['GLOBAL_POSTPROCESSOR', '后处理器脚本']
    ] },
    { label: 'Channel Scripts', types: [
        ['CHANNEL_DEPLOY', '部署脚本'],
        ['CHANNEL_UNDEPLOY', '取消部署脚本'],
        ['CHANNEL_PREPROCESSOR', '预处理器脚本'],
        ['CHANNEL_POSTPROCESSOR', '后处理器脚本'],
        ['CHANNEL_ATTACHMENT', '附件脚本'],
        ['CHANNEL_BATCH', '批处理脚本']
    ] },
    { label: 'Source Connector', types: [
        ['SOURCE_RECEIVER', '接收器脚本'],
        ['SOURCE_FILTER_TRANSFORMER', '过滤器 / 转换器脚本']
    ] },
    { label: 'Destination Connector', types: [
        ['DESTINATION_FILTER_TRANSFORMER', '过滤器 / 转换器脚本'],
        ['DESTINATION_DISPATCHER', '分发器脚本'],
        ['DESTINATION_RESPONSE_TRANSFORMER', '响应转换器脚本']
    ] }
];

/* Display-only captions for the context group identifiers above. */
const CONTEXT_GROUP_LABEL: Record<string, string> = {
    'Global Scripts': '全局脚本',
    'Channel Scripts': '通道脚本',
    'Source Connector': '源连接器',
    'Destination Connector': '目的地连接器'
};

const ALL_CONTEXTS = CONTEXT_GROUPS.flatMap(g => g.types.map(t => t[0]));

// Swing's default for a NEW template is CodeTemplateContextSet.getConnectorContextSet()
// — only the Source/Destination Connector contexts, not global/channel scripts.
const CONNECTOR_CONTEXTS = CONTEXT_GROUPS
    .filter(g => g.label === 'Source Connector' || g.label === 'Destination Connector')
    .flatMap(g => g.types.map(t => t[0]));

/* CodeTemplate.DEFAULT_CODE */
const DEFAULT_CODE = '/**\n\tModify the description here. Modify the function name and parameters as needed. One function per\n\ttemplate is recommended; create a new code template for each new function.\n\n\t@param {String} arg1 - arg1 description\n\t@return {String} return description\n*/\nfunction new_function1(arg1) {\n\t// TODO: Enter code here\n}';

/* ---- XStream shape helpers (reused verbatim) --------------------------------- */

function templatesOf(library: any) {
    return api.asList(library.codeTemplates, 'codeTemplate').filter(t => t && typeof t === 'object');
}

function idSetOf(value: any) {
    return api.asList(value, 'string').map(String);
}

function toIdSet(ids: any) {
    // An empty Set serializes as an empty element; mirror that rather than null
    // (the server copy-constructor NPEs on null channel id sets).
    return ids.length ? { string: ids } : '';
}

function contextsOf(template: any) {
    return api.asList(template.contextSet && template.contextSet.delegate, 'contextType').map(String);
}

function setContexts(template: any, types: any) {
    template.contextSet = { delegate: { contextType: types } };
}

/* Swing's Code Templates table shows a Description column derived from the
   template's JSDoc block (CodeTemplate.getDescription parses the leading
   comment). Pull the first non-empty, non-@tag line out of the /** ... *\/. */
function templateDescription(template: any) {
    const code = template.properties && template.properties.code;
    if (!code) return '';
    const m = String(code).match(/\/\*\*([\s\S]*?)\*\//);
    if (!m) return '';
    for (let line of m[1].split('\n')) {
        line = line.replace(/^\s*\*?\s?/, '').trim();
        // Skip the two wrapped lines of the default-template boilerplate.
        if (line && !line.startsWith('@')
            && !/^Modify the description here/i.test(line)
            && !/^template is recommended/i.test(line)) return line;
    }
    return '';
}

function bulkSaveError(result: any): string {
    if (String(result?.librariesSuccess) !== 'true') {
        return result?.librariesCause?.detailMessage || '无法保存该库集合';
    }
    let failure = '';
    const scan = (value: any) => {
        if (!value || failure) return;
        if (Array.isArray(value)) return value.forEach(scan);
        if (typeof value !== 'object') return;
        if (String(value.success) === 'false') failure = value.cause?.detailMessage || '无法保存某个代码模板';
        else Object.values(value).forEach(scan);
    };
    scan(result.codeTemplateResults);
    return failure;
}

export function CodeTemplatesView() {
    // Maximize: grow the Code editor over the library list (top) and the
    // Name/Library/Type form, keeping the right-hand Context panel. Esc restores.
    const [editorMax, setEditorMax] = useState(false);
    useEffect(() => {
        if (!editorMax) return;
        const onKey = (e: any) => { if (e.key === 'Escape') setEditorMax(false); };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [editorMax]);

    /* Edit-session model: [{ library, templates: [...] }] working copies. The
       objects are mutated in place; markDirty() bumps the container identity so
       React repaints. entriesNowRef mirrors the state for save/import mutations
       (which must act on the latest-known list, not a render-stale snapshot);
       dirtyRef mirrors the dirty flag for the mount-captured guards. */
    const [entries, setEntries] = useState([] as any[]);
    const entriesNowRef = useRef(entries);
    entriesNowRef.current = entries;
    const [selected, setSelected] = useState<any>(null);   // { kind: 'library'|'template', id }
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    const persistedLibraryIdsRef = useRef(new Set<string>());
    const persistedTemplateIdsRef = useRef(new Set<string>());
    const persistedTemplatesRef = useRef(new Map<string, string>());
    // Keep generated import IDs through a failed/ambiguous write so selecting
    // the same file again can reconcile it against a fresh server baseline.
    const templateImportRef = useRef<{ xml: string; targetId: string; templates: any[]; ids: Map<string, string> } | null>(null);
    const libraryImportRef = useRef<{ xml: string; libraries: any[]; ids: Map<string, string> } | null>(null);
    const [filterText, setFilterText] = useState('');
    const [focusName, setFocusName] = useState(false);   // focus the Name field after creating
    const [collapsed, setCollapsed] = useState(() => new Set());   // collapsed library keys ('library:<id>')

    function markDirty() {
        dirtyRef.current = true;
        setDirty(true);
        setEntries(prev => prev.slice());   // model mutated in place — repaint
    }
    function markClean() {
        dirtyRef.current = false;
        setDirty(false);
    }

    // Resolve a { kind, id } selection against a library list (defaults to the
    // current render's). Menus/actions pass their own resolution explicitly.
    function resolve(sel: any, list = entries) {
        if (!sel) return null;
        for (const entry of list) {
            if (sel.kind === 'library' && entry.library.id === sel.id) return { entry };
            if (sel.kind === 'template') {
                const template = entry.templates.find((t: any) => t.id === sel.id);
                if (template) return { entry, template };
            }
        }
        return null;
    }

    /* ---- data ------------------------------------------------------------------ */

    /* Reads no render state (fetch + setState only), so the mount-captured
       codeTemplates:changed listener can safely call the first render's closure. */
    async function load() {
        try {
            const list = await api.codeTemplates.libraries(true);
            const next = list.map(library => ({ library, templates: templatesOf(library) }));
            const version = store.getState('serverVersion') || '4.5.2';
            // Normalize the required migrator fields before taking the clean
            // snapshot. Otherwise Save would add them later and misclassify an
            // untouched template as changed during a library-only edit.
            for (const entry of next) {
                for (const template of entry.templates) {
                    if (!template['@version']) template['@version'] = version;
                    if (template.properties && !template.properties['@version']) template.properties['@version'] = version;
                }
            }
            persistedLibraryIdsRef.current = new Set(next.map(entry => String(entry.library.id)));
            persistedTemplateIdsRef.current = new Set(next.flatMap(entry => entry.templates.map((template: any) => String(template.id))));
            persistedTemplatesRef.current = new Map(next.flatMap(entry => entry.templates)
                .map((template: any) => [String(template.id), JSON.stringify(template)]));
            setEntries(next);
            markClean();
            setSelected((prev: any) => (prev && resolve(prev, next) ? prev : null));
        } catch (e: any) {
            toast(`加载失败：${e.message}`, 'error');
        }
    }

    /* ---- table (Swing Code Templates tree-table) -------------------------------- */

    function templateMatches(template: any, term: any) {
        if (!term) return true;
        return (template.name || '').toLowerCase().includes(term)
            || (template.id || '').toLowerCase().includes(term)
            || templateDescription(template).toLowerCase().includes(term);
    }

    // Columns/data/filter for the JSX <TreeTable> (libraries -> code templates).
    function treeColumns() {
        return CT_COLUMNS.map((c: any) => ({
            key: c.key, label: c.label, align: c.align, tree: c.key === 'name', mono: c.key === 'id',
            render: (n: any) => {
                switch (c.key) {
                    case 'name': return n.kind === 'library'
                        ? <TreeLabel icon="folder" label={n.lib.name || '（未命名库）'} />
                        : <TreeLabel icon="file" label={n.tpl.name || '（未命名代码模板）'} />;
                    case 'id': return n.kind === 'library' ? (n.lib.id || '') : (n.tpl.id || '');
                    case 'description': return n.kind === 'library' ? (n.lib.description || '') : templateDescription(n.tpl);
                    case 'revision': return String((n.kind === 'library' ? n.lib.revision : n.tpl.revision) ?? '');
                    case 'lastModified': return fmtDate(n.kind === 'library' ? n.lib.lastModified : n.tpl.lastModified);
                    default: return '';
                }
            },
            // Click-to-sort: mirror render(n)'s value extraction but return the raw
            // comparable. Sorts libraries among themselves AND templates within each
            // library (TreeTable sorts siblings at every level).
            sortValue: (n: any) => {
                switch (c.key) {
                    case 'name': return String((n.kind === 'library' ? n.lib.name : n.tpl.name) || '').toLowerCase();
                    case 'id': return String((n.kind === 'library' ? n.lib.id : n.tpl.id) || '').toLowerCase();
                    case 'description': return String((n.kind === 'library' ? n.lib.description : templateDescription(n.tpl)) || '').toLowerCase();
                    case 'revision': return Number(n.kind === 'library' ? n.lib.revision : n.tpl.revision) || 0;
                    case 'lastModified': return (n.kind === 'library' ? n.lib.lastModified : n.tpl.lastModified)?.time ?? 0;
                    default: return null;
                }
            }
        }));
    }

    // Right-click on empty space (below the rows) shows the non-contextual tasks.
    function emptyMenu(e: any) {
        if (e.target.closest('tr')) return;   // row menus are handled per-row
        e.preventDefault();
        const found = resolve(selected);
        contextMenu(e.clientX, e.clientY, [
            { label: '刷新', icon: 'refresh', task: 'doRefreshCodeTemplates', group: 'codeTemplate', onClick: () => load() },
            '-',
            { label: '新建代码模板', icon: 'plus', task: 'doNewCodeTemplate', group: 'codeTemplate', onClick: () => newTemplate(found && found.entry) },
            { label: '新建库', icon: 'folder', task: 'doNewLibrary', group: 'codeTemplate', onClick: () => newLibrary() },
            '-',
            { label: '导入代码模板', icon: 'import', task: 'doImportCodeTemplates', group: 'codeTemplate', onClick: () => importCodeTemplates(found && found.entry) },
            { label: '导入库', icon: 'import', task: 'doImportLibraries', group: 'codeTemplate', onClick: () => importLibraries() },
            { label: '导出全部库', icon: 'export', task: 'doExportAllLibraries', group: 'codeTemplate', onClick: () => exportLibraries() }
        ]);
    }

    // Right-click parity with the Swing Code Templates tree (codeTemplatePopupMenu).
    // The menu resolves its target ONCE, here — every item acts on that explicit
    // resolution, never on selection state that changes underneath it.
    function nodeMenu(sel: any, e: any) {
        e.preventDefault();
        setSelected(sel);
        const isTpl = sel.kind === 'template';
        const isLib = sel.kind === 'library';
        const resolved = resolve(sel) || {};
        // Plugin-contributed per-code-template actions (registerCodeTemplateAction),
        // e.g. "View History". Shown for a single selected template unless the
        // action supplies its own isEnabled. Mirrors the Swing code-template action.
        const actionCtx = { platform, template: (resolved as any).template, library: (resolved as any).entry && (resolved as any).entry.library };
        const pluginItems = platform.codeTemplateActions()
            .filter((a: any) => (a.isEnabled ? a.isEnabled(actionCtx) : isTpl))
            .map((a: any): any => ({
                label: a.label, icon: a.icon, task: a.task, group: a.group || 'codeTemplate',
                onClick: () => a.onInvoke((resolved as any).template, actionCtx)
            }));
        contextMenu(e.clientX, e.clientY, [
            { label: '刷新', icon: 'refresh', task: 'doRefreshCodeTemplates', group: 'codeTemplate', onClick: () => load() },
            '-',
            { label: '新建代码模板', icon: 'plus', task: 'doNewCodeTemplate', group: 'codeTemplate', onClick: () => newTemplate((resolved as any).entry) },
            { label: '新建库', icon: 'folder', task: 'doNewLibrary', group: 'codeTemplate', onClick: () => newLibrary() },
            '-',
            { label: '导入代码模板', icon: 'import', task: 'doImportCodeTemplates', group: 'codeTemplate', onClick: () => importCodeTemplates((resolved as any).entry) },
            { label: '导入库', icon: 'import', task: 'doImportLibraries', group: 'codeTemplate', onClick: () => importLibraries() },
            { label: '导出代码模板', icon: 'export', hidden: !isTpl, task: 'doExportCodeTemplate', group: 'codeTemplate', onClick: () => exportTemplate(resolved) },
            { label: '导出库', icon: 'export', hidden: !isLib, task: 'doExportLibrary', group: 'codeTemplate', onClick: () => exportLibrary(resolved) },
            { label: '导出全部库', icon: 'export', task: 'doExportAllLibraries', group: 'codeTemplate', onClick: () => exportLibraries() },
            '-',
            { label: '校验脚本', icon: 'check', hidden: !isTpl, task: 'doValidateCodeTemplate', group: 'codeTemplate', onClick: () => validateScriptTask(resolved) },
            ...(pluginItems.length ? ['-', ...pluginItems] : []),
            { label: '删除', icon: 'trash', danger: true, task: isTpl ? 'doDeleteCodeTemplate' : 'doDeleteLibrary', group: 'codeTemplate', onClick: () => deleteSelected(sel) },
            '-',
            { label: '全部保存', icon: 'save', task: 'doSaveCodeTemplates', group: 'codeTemplate', onClick: () => saveAll() }
        ]);
    }

    /* (The library editor, template form, and context checkbox tree are the
       declarative <LibraryEditor> / <TemplateForm> / <ContextPanel> components
       at the bottom of this file.) */

    /* ---- tasks --------------------------------------------------------------------- */

    function newLibrary() {
        // No name prompt — create the library and select it with the empty Name
        // field focused (the library editor focuses it when focusNewName is set).
        const library = {
            '@version': store.getState('serverVersion') || '4.5.2',
            id: uuid(),
            name: '',
            revision: 0,
            description: '',
            includeNewChannels: false,
            enabledChannelIds: '',
            disabledChannelIds: '',
            codeTemplates: null
        };
        setEntries(prev => [...prev, { library, templates: [] }]);
        setSelected({ kind: 'library', id: library.id });
        setFocusName(true);
        dirtyRef.current = true;
        setDirty(true);
    }

    function newTemplate(entryArg: any) {
        // Re-resolve by id at execution time: the menu that offered this action
        // may have outlived a reload, leaving entryArg detached from the live
        // list (pushing onto it would silently never reach saveAll).
        const entry = entryArg && entriesNowRef.current.find(en => en.library.id === entryArg.library.id);
        if (!entry) {
            toast('请先选择一个库', 'warn');
            return;
        }
        const v = store.getState('serverVersion') || '4.5.2';
        const template = {
            // '@version' is required: the engine migrates every write and
            // 500s when it's absent.
            '@version': v,
            id: uuid(),
            name: 'New Code Template',
            revision: 0,
            contextSet: { delegate: { contextType: [...CONNECTOR_CONTEXTS] } },
            properties: { '@class': PROPERTIES_CLASS, '@version': v, type: 'FUNCTION', code: DEFAULT_CODE }
        };
        entry.templates.push(template);
        setSelected({ kind: 'template', id: template.id });
        setFocusName(true);
        markDirty();
    }

    /* Deletion re-resolves its target against the LATEST list both at entry and
       again after the confirm await — a reload landing while the menu or the
       dialog was open would otherwise leave a detached entry whose removal
       no-ops, letting a later Save All resurrect the engine-deleted templates. */
    async function deleteSelected(sel: any) {
        let found = resolve(sel, entriesNowRef.current);
        if (!sel || !found) { toast('请先选择库或代码模板', 'warn'); return; }

        if (sel.kind === 'library') {
            const count = found.entry.templates.length;
            const message = count
                ? `确定要删除库“${found.entry.library.name}”及其 ${count} 个代码模板吗？全部保存后才会提交删除`
                : `确定要删除库“${found.entry.library.name}”吗？全部保存后才会提交删除`;
            if (!await confirmDialog('删除库', message, { danger: true, okLabel: '删除' })) return;
            found = resolve(sel, entriesNowRef.current);
            if (!found) { toast('该库已不存在（列表已重新加载）', 'warn'); return; }
            const entry = found.entry;
            setEntries(prev => prev.filter(en => en !== entry));
        } else {
            if (!await confirmDialog('删除代码模板', `确定要删除代码模板“${found.template.name}”吗？`, { danger: true, okLabel: '删除' })) return;
            found = resolve(sel, entriesNowRef.current);
            if (!found) { toast('该代码模板已不存在（列表已重新加载）', 'warn'); return; }
            found.entry.templates = found.entry.templates.filter((t: any) => t !== found!.template!);
        }
        invalidateCompletions();   // deleted templates no longer autocomplete
        setSelected(null);
        markDirty();
        toast('已删除 — 使用全部保存提交库更改');
    }

    function saveAll() { return withEditorSave(() => saveAllUnlocked()); }

    async function saveAllUnlocked(overrideConflicts = false, session?: () => void): Promise<any> {
        let assertSession: () => void;
        try { assertSession = session || captureEngineSession(); assertSession(); } catch { return; }
        // Swing-parity conflict handling: save with override=false and the revisions AS
        // LOADED (the engine bumps them itself; sending a self-bumped revision would read
        // as a conflict on every save). A "false" response means someone else saved since
        // this view loaded — prompt once, then retry everything with override=true.
        const conflict = async (): Promise<any> => {
            const overwrite = await confirmDialog('代码模板已被修改',
                '您打开的一个或多个代码模板或库已被他人修改，确定要用您的更改覆盖它们吗？',
                { danger: true, okLabel: '覆盖' });
            assertSession();
            if (overwrite) return saveAllUnlocked(true, assertSession);
            toast('已取消保存 — 请刷新以加载最新的代码模板', 'warn');
        };
        try {
            const v = store.getState('serverVersion') || '4.5.2';
            const libraries = entriesNowRef.current;
            const templates: any[] = [];
            for (const entry of libraries) {
                for (const template of entry.templates) {
                    // Defensive: the engine's migrator 500s without '@version'.
                    if (!template['@version']) template['@version'] = v;
                    if (template.properties && !template.properties['@version']) template.properties['@version'] = v;
                    const persisted = persistedTemplatesRef.current.get(String(template.id));
                    if (persisted === undefined || persisted !== JSON.stringify(template)) templates.push(template);
                }
            }
            const payload = libraries.map(entry => ({
                '@version': entry.library['@version'] || v,
                ...entry.library,
                codeTemplates: entry.templates.length
                    // id-only refs, but '@version' is still required — the
                    // engine migrates every nested model and 500s without it.
                    ? { codeTemplate: entry.templates.map((t: any) => ({ '@version': t['@version'] || v, id: t.id })) }
                    : null
            }));
            const currentLibraryIds = new Set(libraries.map(entry => String(entry.library.id)));
            const currentTemplateIds = new Set(libraries.flatMap(entry => entry.templates.map((template: any) => String(template.id))));
            const removedLibraryIds = [...persistedLibraryIdsRef.current].filter(id => !currentLibraryIds.has(id));
            const removedTemplateIds = [...persistedTemplateIdsRef.current].filter(id => !currentTemplateIds.has(id));
            const result = await api.codeTemplates.bulkUpdate(
                payload,
                templates,
                removedLibraryIds,
                removedTemplateIds,
                overrideConflicts
            );
            assertSession();
            if (String(result?.overrideNeeded) === 'true') return await conflict();
            const failure = bulkSaveError(result);
            if (failure) {
                if (String(result?.librariesSuccess) === 'true') {
                    // The engine saves the library set first, then processes each
                    // template independently. Reconcile successes exactly as Swing
                    // does so retries carry current library/template revisions while
                    // failed edits/removals remain dirty and retryable.
                    const libraryResults = result?.libraryResults && typeof result.libraryResults === 'object'
                        ? result.libraryResults : {};
                    for (const entry of libraries) {
                        const summary = libraryResults[String(entry.library.id)];
                        if (!summary) continue;
                        if (summary.newRevision !== undefined) entry.library.revision = summary.newRevision;
                        if (summary.newLastModified !== undefined) entry.library.lastModified = summary.newLastModified;
                    }

                    const updatedById = new Map(templates.map(template => [String(template.id), template]));
                    const persistedIds = new Set(persistedTemplateIdsRef.current);
                    const persistedTemplates = new Map(persistedTemplatesRef.current);
                    const templateResults = result?.codeTemplateResults && typeof result.codeTemplateResults === 'object'
                        ? result.codeTemplateResults : {};
                    for (const [id, rawSummary] of Object.entries(templateResults)) {
                        const summary: any = rawSummary;
                        if (String(summary?.success) !== 'true') continue;
                        const template = updatedById.get(String(id));
                        if (template) {
                            if (summary.newRevision !== undefined) template.revision = summary.newRevision;
                            if (summary.newLastModified !== undefined) template.lastModified = summary.newLastModified;
                            persistedIds.add(String(id));
                            persistedTemplates.set(String(id), JSON.stringify(template));
                        } else {
                            // A successful result with no updated object is a removal.
                            persistedIds.delete(String(id));
                            persistedTemplates.delete(String(id));
                        }
                    }
                    persistedLibraryIdsRef.current = new Set(currentLibraryIds);
                    persistedTemplateIdsRef.current = persistedIds;
                    persistedTemplatesRef.current = persistedTemplates;
                    invalidateCompletions();
                    setEntries(prev => prev.slice());
                    toast(`保存部分失败：${failure}`, 'error');
                    return;
                }
                throw new Error(failure);
            }
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast('代码模板已保存');
            await load();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`保存失败：${e.message}`, 'error');
        }
    }

    /* ---- import / export (Swing-compatible XStream XML) ----------------------------- */

    async function exportLibraries() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        try {
            await saveFile('codeTemplateLibraries.xml', 'application/xml',
                () => api.getXml('/codeTemplateLibraries', { includeCodeTemplates: true }), assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导出失败：${e.message}`, 'error');
        }
    }

    async function exportLibrary(found: any) {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        if (!found || !found.entry || found.template) {
            toast('请先选择一个库', 'warn');
            return;
        }
        const { library } = found.entry;
        try {
            await saveFile(`${library.name || library.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/codeTemplateLibraries/${encodeURIComponent(library.id)}`, { includeCodeTemplates: true });
                if (!xml || !String(xml).trim()) throw new Error('服务端未找到该库 — 请先保存');
                return xml;
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导出失败：${e.message}`, 'error');
        }
    }

    async function exportTemplate(found: any) {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        if (!found || !found.template) {
            toast('请先选择一个代码模板', 'warn');
            return;
        }
        try {
            await saveFile(`${found.template.name || found.template.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/codeTemplates/${found.template.id}`);
                if (!xml || !String(xml).trim()) throw new Error('服务端未找到该代码模板 — 请先保存');
                return xml;
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导出失败：${e.message}`, 'error');
        }
    }

    /* Swing imports merge into the current collection. The engine endpoint
       replaces that collection, so always obtain a fresh, complete baseline,
       send no removals, and never force a stale import over concurrent edits. */
    function importLibraries() {
        return withEditorSave(importLibrariesUnlocked, '正在导入库…');
    }

    async function importLibrariesUnlocked() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        let writeAttempted = false;
        try {
            if (dirtyRef.current) {
                if (!platform.checkTask('codeTemplate', 'doSaveCodeTemplates')) {
                    toast('您没有保存这些更改的权限，请先刷新丢弃更改后再导入库', 'warn');
                    return;
                }
                const save = await confirmDialog('未保存的更改',
                    '要在导入库之前保存您的代码模板更改吗？', { okLabel: '保存并导入' });
                assertSession();
                if (!save) return;
                await saveAllUnlocked();
                assertSession();
                if (dirtyRef.current) return; // cancelled, failed, or partial save
            }
            const file = await pickFile('.xml');
            assertSession();
            if (!file) return;
            const v = store.getState('serverVersion') || '4.5.2';
            const xml = String(file.content || '').trim();
            if (libraryImportRef.current?.xml !== xml) {
                libraryImportRef.current = { xml, libraries: parseLibraryImport(xml, v), ids: new Map() };
            }
            const pending = libraryImportRef.current;
            const confirmed = await confirmDialog('导入库',
                `要从“${file.name}”导入库吗？现有库和模板将保留，冲突会在保存前逐一确认`,
                { okLabel: '导入' });
            assertSession();
            if (!confirmed) return;
            const current = await api.codeTemplates.libraries(true);
            assertSession();
            const payload = await prepareLibraryImport(current, pending.libraries, v,
                libraryImportCallbacks(assertSession, pending.ids));
            assertSession();
            if (!payload) return;
            writeAttempted = true;
            const result = await api.codeTemplates.bulkUpdate(payload.libraries, payload.templates, [], [], false);
            assertSession();
            if (String(result?.overrideNeeded) === 'true') {
                writeAttempted = false; // the engine checks conflicts before writing
                throw new Error('导入期间库或代码模板已被更改，请重新导入以与服务端最新版本合并');
            }
            const failure = bulkSaveError(result);
            if (failure) throw new Error(failure);
            libraryImportRef.current = null;
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast(`已导入 ${file.name}`);
            setSelected(null);
            await load();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            if (writeAttempted) {
                // Bulk updates can commit the libraries before a template fails;
                // network errors can also arrive after a commit. Retain import IDs
                // for retry, and reconcile the editor with the server's outcome.
                invalidateCompletions();
                await load();
                try { assertSession(); } catch { return; }
            }
            toast(`导入失败：${e.message}`, 'error');
        }
    }

    function importCodeTemplates(entryArg: any) {
        return withEditorSave(() => importCodeTemplatesUnlocked(entryArg), '正在导入代码模板…');
    }

    async function importCodeTemplatesUnlocked(entryArg: any) {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        let writeAttempted = false;
        try {
            const target = entriesNowRef.current.find(en => en.library.id === entryArg?.library.id)
                || (entriesNowRef.current.length === 1 ? entriesNowRef.current[0] : null);
            if (!target) { toast('请先选择要导入到哪个库', 'warn'); return; }
            const targetId = target.library.id;
            if (dirtyRef.current) {
                if (!platform.checkTask('codeTemplate', 'doSaveCodeTemplates')) {
                    toast('您没有保存这些更改的权限，请先刷新丢弃更改后再导入代码模板', 'warn');
                    return;
                }
                const save = await confirmDialog('未保存的更改',
                    '要在导入代码模板之前保存您的代码模板更改吗？', { okLabel: '保存并导入' });
                assertSession();
                if (!save) return;
                await saveAllUnlocked(false, assertSession);
                assertSession();
                if (dirtyRef.current) return;
            }
            const file = await pickFile('.xml');
            assertSession();
            if (!file) return;
            const version = store.getState('serverVersion') || '4.5.2';
            const xml = String(file.content || '').trim();
            if (templateImportRef.current?.xml !== xml || templateImportRef.current.targetId !== targetId) {
                templateImportRef.current = { xml, targetId, templates: parseTemplateImport(xml, version), ids: new Map() };
            }
            const pending = templateImportRef.current;
            const current = await api.codeTemplates.libraries(true);
            assertSession();
            const payload = await prepareTemplateImport(current, pending.templates, targetId, version,
                libraryImportCallbacks(assertSession, pending.ids));
            assertSession();
            if (!payload || !payload.templates.length) return;
            writeAttempted = true;
            const result = await api.codeTemplates.bulkUpdate(payload.libraries, payload.templates, [], [], false);
            assertSession();
            if (String(result?.overrideNeeded) === 'true') {
                writeAttempted = false;
                throw new Error('导入期间库或代码模板已被更改，请重新导入以与服务端最新版本合并');
            }
            const failure = bulkSaveError(result);
            if (failure) throw new Error(failure);
            templateImportRef.current = null;
            invalidateCompletions();
            toast(`已将 ${payload.templates.length} 个代码模板导入“${target.library.name || '未命名库'}”`);
            await load();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            if (writeAttempted) {
                invalidateCompletions();
                await load();
                try { assertSession(); } catch { return; }
            }
            toast(`导入失败：${e.message}`, 'error');
        }
    }

    /* Validate Script (Swing) — real Rhino compile check of the selected
       template's code via the engine bridge. */
    async function validateScriptTask(found: any) {
        if (!found || !found.template) { toast('请先选择一个代码模板', 'warn'); return; }
        const code = found.template.properties && found.template.properties.code;
        if (typeof code !== 'string' || !code.trim()) { toast('该代码模板没有可校验的代码', 'warn'); return; }
        const result = await validateScript(code);
        if (result.ok === null) { toast(result.message, 'warn'); return; }
        if (result.ok === false) { toast(`校验错误 — ${result.message}`, 'error'); return; }
        toast('代码模板校验通过');
    }

    async function refreshTask() {
        if (dirtyRef.current && !await confirmDialog('刷新', '要丢弃未保存的更改并刷新吗？', { okLabel: '刷新' })) return;
        load();
    }

    /* Move a template between libraries (the Library dropdown on the template
       form). Mutates both entries' template lists, expands the target, and
       keeps the template selected. */
    function moveTemplate(entry: any, template: any, targetId: any) {
        if (targetId === entry.library.id) return;
        const target = entries.find(en => en.library.id === targetId);
        if (!target) return;
        entry.templates = entry.templates.filter((t: any) => t !== template);
        target.templates.push(template);
        setCollapsed(prev => { const next = new Set(prev); next.delete('library:' + targetId); return next; });
        setSelected({ kind: 'template', id: template.id });
        markDirty();
    }

    /* ---- mount: load ---- */

    useEffect(() => {
        load();
        // Prompt before leaving with unsaved library/template edits (Swing parity).
        store.setState('navGuard', async () => {
            if (!dirtyRef.current) return;
            // No save permission -> say the edits can't be kept (channel editor parity).
            const ok = platform.checkTask('codeTemplate', 'doSaveCodeTemplates')
                ? await confirmDialog('未保存的更改',
                    '代码模板有未保存的更改，要直接离开吗？',
                    { danger: true, okLabel: '离开' })
                : await confirmDialog('未保存的更改',
                    '您没有保存代码模板更改的权限，离开后更改将被丢弃。',
                    { okLabel: '确定' });
            return ok ? undefined : false;
        });
        // Tab-close guard: same dirty state, synchronous (see core/unsaved.js).
        const unregister = registerUnsavedCheck(() => dirtyRef.current);
        // A plugin that mutates a template out-of-band (e.g. history revert) emits
        // this so the tree reflects the change immediately (Swing doRefreshCodeTemplates).
        const off = platform.events.on('codeTemplates:changed', () => load());
        return () => { store.setState('navGuard', null); unregister(); off(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-dependent task visibility (Swing Code Template Tasks pane).
    const found = resolve(selected);

    /* Editor pane collapse: while nothing is selected the tree pane (the
       .split-handle's drag target) flexes to fill the column and the editor
       shrinks to a slim strip; selection restores the class-default or last
       dragged tree height. The handle mutates style.height directly during
       drags, so the layout effect writes styles only on open/close transitions
       (the message browser's detail-pane mechanism, inverted for this
       geometry). */
    const treePaneRef = useRef<any>(null);
    const treeHeightRef = useRef('');         // '' = the h-[288px] class default
    const prevEditorOpenRef = useRef(false);
    const editorOpen = !!found;
    useLayoutEffect(() => {
        const el = treePaneRef.current;
        if (!el) return;
        if (editorOpen) {
            if (!prevEditorOpenRef.current) {
                el.style.flex = '';
                el.style.height = treeHeightRef.current;
            }
        } else {
            if (prevEditorOpenRef.current) treeHeightRef.current = el.style.height || treeHeightRef.current;
            el.style.flex = '1 1 0%';
            el.style.height = 'auto';
        }
        prevEditorOpenRef.current = editorOpen;
    }, [editorOpen]);
    const isTemplate = !!found && selected && selected.kind === 'template';
    const isLibrary = !!found && selected && selected.kind === 'library';

    // Tree data + filter for the <TreeTable>.
    const treeData = entries.map((entry: any) => ({
        kind: 'library', id: entry.library.id, lib: entry.library,
        children: entry.templates.map((t: any) => ({ kind: 'template', id: t.id, tpl: t }))
    }));
    const term = filterText.trim().toLowerCase();
    const ctMatches = term
        ? (n: any) => (n.kind === 'library' ? (n.lib.name || '').toLowerCase().includes(term) : templateMatches(n.tpl, term))
        : undefined;
    const totalTemplates = entries.reduce((sum: any, en: any) => sum + en.templates.length, 0);
    const countsText = `${entries.length} 个库，${totalTemplates} 个代码模板`;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="代码模板任务" paneKey="tasks:Code Template Tasks" group="codeTemplate">
                    <div className="taskbar" data-pane-title="Code Template Tasks">
                        <TaskButton label="刷新" icon="refresh" task="doRefreshCodeTemplates" onClick={refreshTask} />
                        {dirty && <TaskButton label="保存更改" icon="save" primary task="doSaveCodeTemplates" onClick={() => saveAll()} />}
                        {found && <TaskButton label="新建代码模板" icon="plus" task="doNewCodeTemplate" onClick={() => newTemplate(found.entry)} />}
                        <TaskButton label="新建库" icon="folder" task="doNewLibrary" onClick={newLibrary} />
                        <TaskButton label="导入代码模板" icon="import" task="doImportCodeTemplates" onClick={() => importCodeTemplates(found && found.entry)} />
                        <TaskButton label="导入库" icon="import" task="doImportLibraries" onClick={importLibraries} />
                        {isTemplate && <TaskButton label="导出代码模板" icon="export" task="doExportCodeTemplate" onClick={() => exportTemplate(found)} />}
                        {isLibrary && <TaskButton label="导出库" icon="export" task="doExportLibrary" onClick={() => exportLibrary(found)} />}
                        {isTemplate && <TaskButton label="删除代码模板" icon="trash" danger task="doDeleteCodeTemplate" onClick={() => deleteSelected(selected)} />}
                        {isLibrary && <TaskButton label="删除库" icon="trash" danger task="doDeleteLibrary" onClick={() => deleteSelected(selected)} />}
                        {isTemplate && <TaskButton label="校验脚本" icon="check" task="doValidateCodeTemplate" onClick={() => validateScriptTask(found)} />}
                        {isTemplate && platform.codeTemplateActions()
                            .filter((a: any) => (a.isEnabled ? a.isEnabled({ platform, template: found!.template, library: found!.entry.library }) : true))
                            .map((a: any) => <TaskButton key={a.id || a.label} label={a.label} icon={a.icon} task={a.task}
                                onClick={() => a.onInvoke(found!.template, { platform, template: found!.template, library: found!.entry.library })} />)}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex">
                {/* Top: libraries/templates tree-table + filter bar; bottom: editor.
                    When maximized, the top pane (data-editor-overtake) is hidden so the
                    editor fills the column; the right Context panel stays. */}
                <div className={'split vertical flex-1 min-w-0' + (editorMax ? ' is-editor-max' : '')}>
                    <div ref={treePaneRef} className="split-a h-[288px] flex-none flex flex-col min-h-0" data-editor-overtake>
                        <div className="flex-1 min-h-0 overflow-auto oie-tablecard px-[13px] pt-3">
                            <TreeTable
                                data={treeData}
                                columns={treeColumns()}
                                getChildren={(n: any) => n.children}
                                rowKey={(n: any) => `${n.kind}:${n.id}`}
                                rowClassName={(n: any) => (n.kind === 'library' ? 'group-row' : '')}
                                selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
                                onSelect={(n: any) => setSelected({ kind: n.kind, id: n.id })}
                                onRowContextMenu={(n: any, e: any) => nodeMenu({ kind: n.kind, id: n.id }, e)}
                                onEmptyContextMenu={emptyMenu}
                                matches={ctMatches}
                                collapsedKeys={collapsed}
                                onToggleCollapse={(key: any) => setCollapsed(prev => {
                                    const next = new Set(prev);
                                    next.has(key) ? next.delete(key) : next.add(key);
                                    return next;
                                })}
                                columnsKey="codetemplates"
                                columnWidths={CT_COL_WIDTHS}
                                defaultHidden={['id']}
                                pinnedKeys={['name']}
                                emptyText="未找到代码模板库" />
                        </div>
                        <div className="filterbar flex-none panel overflow-visible mx-[13px] my-2">
                            <span className="counts">{countsText}</span>
                            <span className="ml-auto inline-flex items-center gap-1.5">
                                <label>筛选：</label>
                                <input type="text" placeholder="筛选…" className="max-w-[234px]" value={filterText}
                                    onChange={(e: any) => setFilterText(e.target.value)} />
                            </span>
                        </div>
                    </div>
                    {found ? <>
                        <div className="split-handle mx-[13px]" data-orient="v" data-resize="prev" data-editor-overtake />
                        <div className="split-b flex flex-col min-h-0">
                            <div className="flex flex-col flex-1 min-h-0 py-3.5 px-4 overflow-auto">
                                <EditorPane found={found} kind={selected && selected.kind}
                                    entries={entries}
                                    markDirty={markDirty}
                                    focusName={focusName}
                                    onFocusConsumed={() => setFocusName(false)}
                                    onMoveTemplate={moveTemplate}
                                    maximized={editorMax}
                                    onToggleMax={() => setEditorMax((m: any) => !m)} />
                            </div>
                        </div>
                    </> : <div className="split-b flex-none text-text-faint py-[8px] px-3.5">请选择要编辑的库或代码模板</div>}
                </div>
            </div>
        </div>
    );
}

/* The editor pane. Branches on the current selection into the declarative
   library / template editors. Keyed on the selected id so per-selection state
   (channel filter, focus) resets when the selection changes. */
function EditorPane({ found, kind, entries, markDirty, focusName, onFocusConsumed, onMoveTemplate, maximized, onToggleMax }: any) {
    if (kind === 'library') {
        return <LibraryEditor key={'lib:' + found.entry.library.id} entry={found.entry}
            markDirty={markDirty} focusName={focusName} onFocusConsumed={onFocusConsumed} />;
    }
    return <TemplateEditor key={'tpl:' + found.template.id} entry={found.entry} template={found.template}
        entries={entries} markDirty={markDirty} focusName={focusName} onFocusConsumed={onFocusConsumed}
        onMoveTemplate={onMoveTemplate} maximized={maximized} onToggleMax={onToggleMax} />;
}

/* Focuses + selects the Name input once, when the editor opens for a
   just-created library/template. */
function useFocusName(focusName: any, onFocusConsumed: any) {
    const ref = useRef<any>(null);
    useEffect(() => {
        if (focusName) {
            onFocusConsumed();
            ref.current?.focus();
            ref.current?.select();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return ref;
}

/* The library editor: Name / Include New Channels, the type-count summary +
   Description, and the Channels checkbox list (Swing's right-hand panel). */
function LibraryEditor({ entry, markDirty, focusName, onFocusConsumed }: any) {
    const { library } = entry;
    const nameRef = useFocusName(focusName, onFocusConsumed);
    const [channels, setChannels] = useState<any>(null);   // null = loading
    const [chError, setChError] = useState<any>(null);
    const [chFilter, setChFilter] = useState('');

    useEffect(() => {
        let alive = true;
        api.channels.idsAndNames().then((map: any) => {
            if (!alive) return;
            const rows = api.asList(map && map.entry).map((en: any) => {
                const pair = api.asList(en.string);
                return { id: String(pair[0] ?? ''), name: String(pair[1] ?? pair[0] ?? '') };
            }).sort((a: any, b: any) => a.name.localeCompare(b.name));
            setChannels(rows);
        }).catch((e: any) => { if (alive) setChError(e.message); });
        return () => { alive = false; };
    }, []);

    // Summary line (Swing shows template-type counts for the library).
    const counts = { FUNCTION: 0, DRAG_AND_DROP_CODE: 0, COMPILED_CODE: 0 };
    for (const t of entry.templates) {
        const type = (t.properties && t.properties.type) || 'FUNCTION';
        if ((counts as any)[type] === undefined) (counts as any)[type] = 0;
        (counts as any)[type]++;
    }
    const summaryText = `${counts.FUNCTION} 个函数，`
        + `${counts.DRAG_AND_DROP_CODE} 个拖放代码块，`
        + `${counts.COMPILED_CODE} 个已编译代码块`;

    const enabled = new Set(idSetOf(library.enabledChannelIds));
    function setChannel(id: any, on: any) {
        const en = new Set(idSetOf(library.enabledChannelIds));
        const dis = new Set(idSetOf(library.disabledChannelIds));
        if (on) { en.add(id); dis.delete(id); } else { en.delete(id); dis.add(id); }
        library.enabledChannelIds = toIdSet([...en]);
        library.disabledChannelIds = toIdSet([...dis]);
        markDirty();
    }
    function setAllChannels(on: any) {
        const term = chFilter.trim().toLowerCase();
        for (const row of channels || []) {
            if (!term || row.name.toLowerCase().includes(term)) setChannel(row.id, on);
        }
    }

    const term = chFilter.trim().toLowerCase();
    const visible = (channels || []).filter((r: any) => !term || r.name.toLowerCase().includes(term));

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="form-grid mb-3">
                <div className="field">
                    <label>名称</label>
                    <input ref={nameRef} type="text" value={library.name || ''}
                        onChange={(e: any) => { library.name = e.target.value; markDirty(); }} />
                </div>
                <div className="field justify-end">
                    <label className="check">
                        <input type="checkbox" checked={!!library.includeNewChannels}
                            onChange={(e: any) => { library.includeNewChannels = e.target.checked; markDirty(); }} />
                        包含新通道
                    </label>
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="flex flex-col flex-1 min-h-0 mr-3.5">
                    <div className="mb-2.5 text-[11px] text-text-dim">
                        <span className="font-[650]">概览：</span>{summaryText}
                    </div>
                    <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim mb-1.5">描述</label>
                    <textarea className="flex-1 min-h-[108px] resize-none" value={library.description || ''}
                        onChange={(e: any) => { library.description = e.target.value; markDirty(); }} />
                </div>
                <div className="w-[270px] flex-none flex flex-col min-h-0 border-l border-line pl-3.5">
                    <div className="flex items-baseline justify-between mb-2">
                        <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">通道</label>
                        <span className="text-[10px]">
                            <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAllChannels(true); }}>全选</a>
                            <span className="text-text-faint my-0 mx-1.5">|</span>
                            <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAllChannels(false); }}>全不选</a>
                        </span>
                    </div>
                    <input type="text" placeholder="筛选…" className="w-full mb-1.5" value={chFilter}
                        onChange={(e: any) => setChFilter(e.target.value)} />
                    <div className="overflow-auto flex-1">
                        {chError ? <div className="text-text-faint">{`通道不可用：${chError}`}</div>
                            : channels === null ? <div className="loading-block"><div className="spinner" />正在加载通道…</div>
                                : visible.length === 0 ? <div className="text-text-faint">{channels.length ? '无匹配项' : '暂无通道'}</div>
                                    : visible.map((row: any) => (
                                        <div key={row.id}>
                                            <label className="check">
                                                <input type="checkbox" checked={enabled.has(row.id)}
                                                    onChange={(e: any) => setChannel(row.id, e.target.checked)} />
                                                {row.name}
                                            </label>
                                        </div>
                                    ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function TemplateEditor({ entry, template, entries, markDirty, focusName, onFocusConsumed, onMoveTemplate, maximized, onToggleMax }: any) {
    const nameRef = useFocusName(focusName, onFocusConsumed);
    if (!template.properties || typeof template.properties !== 'object') {
        template.properties = { '@class': PROPERTIES_CLASS, type: 'FUNCTION', code: '' };
    }
    // Maximize (state lifted to the view so it can also hide the library list above)
    // grows the Code editor over the Name/Library/Type form, which is tagged
    // data-editor-overtake, while the right-hand Context panel stays visible.
    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div data-editor-overtake style={{ flex: 'none' }}>
                <div className="form-grid mb-3">
                    <div className="field">
                        <label>名称</label>
                        <input ref={nameRef} type="text" value={template.name || ''}
                            onChange={(e: any) => { template.name = e.target.value; markDirty(); }} />
                    </div>
                    <div className="field">
                        <label>库</label>
                        {/* Swing lets you move a template between libraries here. */}
                        <select value={entry.library.id}
                            onChange={(e: any) => onMoveTemplate(entry, template, e.target.value)}>
                            {entries.map((en: any) => (
                                <option key={en.library.id} value={en.library.id}>{en.library.name || '（未命名库）'}</option>
                            ))}
                        </select>
                    </div>
                    <div className="field">
                        <label>类型</label>
                        <select value={template.properties.type || 'FUNCTION'}
                            onChange={(e: any) => { template.properties.type = e.target.value; markDirty(); }}>
                            {TEMPLATE_TYPES.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    </div>
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="flex flex-col flex-1 min-h-0 mr-3.5">
                    <div className="flex items-center mb-1.5">
                        <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">代码</label>
                        <button type="button" className="icon-btn ml-auto"
                            title={maximized ? '还原编辑器（Esc）' : '最大化编辑器'}
                            onClick={onToggleMax}>
                            <Icon name={maximized ? 'minimize' : 'maximize'} size={15} />
                        </button>
                    </div>
                    <CodeEditor language="javascript"
                        defaultValue={template.properties.code || ''}
                        onChange={(v: any) => { template.properties.code = v; markDirty(); }}
                        style={{ flex: 1, minHeight: '200px' }} />
                </div>
                <ContextPanel template={template} markDirty={markDirty} />
            </div>
        </div>
    );
}

/* Group checkbox with the tri-state (indeterminate) look — `indeterminate` is a
   DOM property, not an attribute, so it is applied through a ref. */
function GroupCheck({ label, checked, indeterminate, onChange }: any) {
    const ref = useRef<any>(null);
    useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
    return (
        <label className="check">
            <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />
            {label}
        </label>
    );
}

/* The template's Context checkbox tree (Swing's right-hand panel). All state
   derives from the template's contextSet; toggles rewrite it via setContexts. */
function ContextPanel({ template, markDirty }: any) {
    const active = new Set(contextsOf(template));
    const apply = (next: any) => {
        setContexts(template, ALL_CONTEXTS.filter((t: any) => next.has(t)));
        markDirty();
    };
    const toggleType = (type: any, on: any) => {
        const next = new Set(active);
        on ? next.add(type) : next.delete(type);
        apply(next);
    };
    const toggleGroup = (group: any, on: any) => {
        const next = new Set(active);
        for (const [type] of group.types) { on ? next.add(type) : next.delete(type); }
        apply(next);
    };
    const setAll = (on: any) => apply(on ? new Set(ALL_CONTEXTS) : new Set());

    return (
        <div className="w-[234px] flex-none flex flex-col min-h-0 border-l border-line pl-3.5">
            <div className="flex items-baseline justify-between mb-2">
                <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">上下文</label>
                <span className="text-[10px]">
                    <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAll(true); }}>全选</a>
                    <span className="text-text-faint my-0 mx-1.5">|</span>
                    <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAll(false); }}>全不选</a>
                </span>
            </div>
            <div className="overflow-auto flex-1">
                {CONTEXT_GROUPS.map((group: any) => {
                    const on = group.types.filter(([type]: any) => active.has(type)).length;
                    return (
                        <div key={group.label} className="mb-1.5">
                            <div>
                                <GroupCheck label={CONTEXT_GROUP_LABEL[group.label] ?? group.label}
                                    checked={on === group.types.length && on > 0}
                                    indeterminate={on > 0 && on < group.types.length}
                                    onChange={(e: any) => toggleGroup(group, e.target.checked)} />
                            </div>
                            {group.types.map(([type, label]: any) => (
                                <div key={type} className="pl-5">
                                    <label className="check">
                                        <input type="checkbox" checked={active.has(type)}
                                            onChange={(e: any) => toggleType(type, e.target.checked)} />
                                        {label}
                                    </label>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
