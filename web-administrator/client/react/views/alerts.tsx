/*
 * Alerts list (React port of the list half of views/alerts.js). Multi-select
 * table + the selection-gated Alert Tasks pane. The alert EDITOR is now also
 * React (../views/alert-editor.jsx): its connector-granular channel tree and the
 * intricate AlertChannels serialization are reused verbatim there, mounted into
 * a ref'd host. Both halves register here.
 */

import { useState, useRef } from 'react';
import { h, icon, modal, toast, confirmDialog, promptDialog, contextMenu, saveFile, pickFile } from '@oie/web-ui';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { useAlerts } from '../queries.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { newAlert } from './alert-editor.jsx';
import { checkImportVersion } from '../../core/import-guard.js';


const COLUMNS = [
    {
        key: 'enabled', label: '状态', width: '90px',
        sortValue: (a: any) => a.enabled ? 0 : 1,
        render: (a: any) => a.enabled
            ? h('span.status-cell', h('span.pip.ok'), '已启用')
            : h('span.status-cell', h('span.pip'), h('span.text-text-dim', '已禁用'))
    },
    { key: 'name', label: '名称', render: (a: any) => a.name || '' },
    { key: 'id', label: 'ID', className: 'mono', render: (a: any) => h('span', { style: { color: 'var(--text-faint)' } }, a.id || '') }
];

export function AlertsList() {
    // Server state + Swing-parity polling via TanStack Query — useAlerts'
    // refetchInterval replaces the hand-rolled setTimeout loop (and the
    // destroyed/timer refs). Manual Refresh toasts on error; background polls
    // stay quiet — they self-heal on the next tick and Query keeps the last data.
    const alertsQuery = useAlerts();
    const alerts = alertsQuery.data ?? [];
    const [sel, setSel] = useState([] as any[]);
    const tableRef = useRef<any>(null);
    const importInFlight = useRef(false);

    const selectedRows = () => (tableRef.current ? tableRef.current.selectedRows() : []);

    const refresh = async () => {
        const r = await alertsQuery.refetch();
        if (r.error) toast(r.error.message, 'error');
        setSel(selectedRows());
    };

    function single() {
        const rows = selectedRows();
        if (rows.length !== 1) { toast('请仅选择一个警报', 'warn'); return null; }
        return rows[0];
    }
    function multi() {
        const rows = selectedRows();
        if (!rows.length) { toast('请先选择警报', 'warn'); return null; }
        return rows;
    }

    function startClassicAlert() {
        const model = newAlert('', store.getState('serverVersion'));
        store.setState('editingAlert', model);
        router.navigate(`/alerts/${model.id}/edit?new=1`);
    }
    const startGuidedAlert = () => router.navigate('/alerts/new/guided');

    // New Alert: honor the saved default (Settings → Administrator), else show a
    // Classic-vs-Wizard chooser. "Remember" writes the pick to the default.
    function newTask() {
        const pref = getPref('newAlertDefault');
        if (pref === 'classic') return startClassicAlert();
        if (pref === 'guided') return startGuidedAlert();
        let remember = false;
        const card = (mode: any, iconName: any, title: any, desc: any) => h('button', {
            class: 'panel !mt-0 appearance-none text-[var(--text)] text-left p-3 flex gap-3 items-start cursor-pointer w-full hover:border-accent',
            style: { font: 'inherit' },
            onClick: () => {
                if (remember) setPrefs({ newAlertDefault: mode });
                m.close();
                if (mode === 'guided') startGuidedAlert(); else startClassicAlert();
            }
        }, icon(iconName, 20),
            h('div', h('div', { class: 'font-semibold' }, title), h('div.hint', desc)));
        const m = modal({
            title: '新建警报',
            body: h('div', { class: 'flex flex-col gap-2.5 min-w-[396px]' },
                card('classic', 'edit', '经典编辑器', '完整编辑器，所有选项集中在同一屏'),
                card('guided', 'wand', '向导', '分步引导创建：基本信息、触发条件、通道、操作'),
                h('label', { class: 'flex items-center gap-2 mt-2 text-text-dim' },
                    h('input', { type: 'checkbox', onChange: (e: any) => { remember = e.target.checked; } }),
                    '记住我的选择（设为默认）')),
            buttons: [{ label: '取消' }]
        });
    }
    function editTask() {
        const alert = single();
        if (alert) router.navigate(`/alerts/${alert.id}/edit`);
    }
    async function setEnabledTask(enabled: any) {
        const rows = multi();
        if (!rows) return;
        for (const alert of rows) {
            try { await (enabled ? api.alerts.enable(alert.id) : api.alerts.disable(alert.id)); }
            catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }
    async function deleteTask() {
        const rows = multi();
        if (!rows) return;
        if (!await confirmDialog('删除警报', `确定要永久删除 ${rows.length} 个警报吗？此操作无法撤销`, { danger: true, okLabel: '删除' })) return;
        for (const alert of rows) {
            try { await api.alerts.remove(alert.id); } catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }
    async function importTask() {
        if (importInFlight.current) return;
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        importInFlight.current = true;
        let imported = 0;
        const refreshImported = async () => {
            const result = await alertsQuery.refetch();
            assertSession();
            if (result.error) toast(result.error.message, 'error');
            setSel(selectedRows());
        };
        try {
            const file = await pickFile('.xml,.json');
            assertSession();
            if (!file) return;
            const content = String(file.content || '').trim();
            // Resolve names against the server after the picker closes, and
            // remember each successful item while importing an exported list.
            const currentAlerts = await api.alerts.list();
            assertSession();
            const known = currentAlerts.map(alert => ({ id: String(alert.id), name: String(alert.name ?? '') }));
            const nameError = (name: string): string | null => {
                if (!name) return '警报名称不能为空';
                // Frame.checkAlertName parity: the fork's pattern also allows CJK.
                if (!/^[A-Za-z0-9_\-\s.\()\u4e00-\u9fa5\u3001\u3002\u300a\u300b\u3010\u3011\uff08\uff09\uff0c\uff1a\uff1b\uff1f\uff01\u2014\u2018\u2019\u201c\u201d\u00b7\t\n\r\f\v]*$/.test(name)) return '警报名称只能包含中文、字母、数字、空格、连字符、下划线、括号、点号及常用中文标点。';
                if (known.some(alert => alert.name.toLowerCase() === name.toLowerCase())) return `警报 "${name}" 已存在`;
                return null;
            };
            const resolveIdentity = async (nameValue: any, idValue: any) => {
                let name = String(nameValue ?? '');
                let id = String(idValue || uuid());
                const warning = nameError(name);
                if (warning) {
                    // Swing validates every imported name. Its overwrite branch
                    // may explicitly proceed even when the warning is about an
                    // invalid name rather than an existing alert.
                    const choice = await new Promise<'overwrite' | 'create' | null>(resolve => modal({
                        title: '导入警报',
                        body: h('div', h('p', warning), h('p', '是否覆盖已有的警报？选择“新建”可输入有效且唯一的名称')),
                        onClose: () => resolve(null),
                        buttons: [
                            { label: '取消', onClick: () => resolve(null) },
                            { label: '新建', onClick: () => resolve('create') },
                            { label: '覆盖', primary: true, onClick: () => resolve('overwrite') }
                        ]
                    }));
                    assertSession();
                    if (choice === null) return null;
                    if (choice === 'overwrite') {
                        const clash = known.find(alert => alert.name.toLowerCase() === name.toLowerCase());
                        if (clash) id = clash.id;
                    } else {
                        let error: string | null;
                        do {
                            const next = await promptDialog('导入警报', '请为该警报输入新名称', name);
                            assertSession();
                            if (next == null) return null;
                            name = next;
                            error = nameError(name);
                            if (error) toast(error, 'warn');
                        } while (error);
                        id = uuid();
                    }
                }
                return { id, name };
            };
            const allowVersion = (version: any) => {
                const verdict = checkImportVersion(version, 'alert');
                if (verdict.action === 'ok') return Promise.resolve(true);
                return new Promise<boolean>(resolve => modal({
                    title: verdict.action === 'block' ? '信息' : '请选择操作',
                    body: h('div', { style: 'white-space: pre-line' }, verdict.message),
                    onClose: () => resolve(false),
                    buttons: verdict.action === 'block'
                        ? [{ label: '确定', primary: true, onClick: () => resolve(false) }]
                        : [
                            { label: '否', onClick: () => resolve(false) },
                            { label: '是', primary: true, onClick: () => resolve(true) }
                        ]
                }));
            };
            const allowVersions = async (versions: any[]) => {
                for (const version of [...new Set(versions.map(value => String(value || '')))]) {
                    const allowed = await allowVersion(version || undefined);
                    assertSession();
                    if (!allowed) return false;
                }
                return true;
            };

            if (content.startsWith('<')) {
                const doc = new DOMParser().parseFromString(content, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('不是有效的 XML 文件');
                const root = doc.documentElement;
                const elements = root.tagName === 'alertModel' ? [root] : [...root.querySelectorAll(':scope > alertModel')];
                if (!elements.length) throw new Error('文件中未找到警报');
                const rootVersion = root.getAttribute('version');
                if (!await allowVersions(rootVersion ? [rootVersion] : elements.map(element => element.getAttribute('version')))) return;
                for (const element of elements) {
                    const direct = (tag: string) => [...element.children].find(child => child.tagName === tag);
                    const identity = await resolveIdentity(direct('name')?.textContent, direct('id')?.textContent);
                    if (!identity) break;
                    for (const [tag, value] of Object.entries(identity)) {
                        let child = direct(tag);
                        if (!child) { child = doc.createElement(tag); element.appendChild(child); }
                        child.textContent = value;
                    }
                    try {
                        assertSession();
                        await api.postXml('/alerts', new XMLSerializer().serializeToString(element));
                        assertSession();
                        known.splice(0, known.length, ...known.filter(alert => alert.id !== identity.id), identity);
                        imported++;
                    } catch (e: any) {
                        assertSession();
                        toast(`导入警报出错：${e.message || e}`, 'error');
                    }
                }
            } else {
                let parsed = JSON.parse(content);
                if (parsed && typeof parsed === 'object' && parsed.list) parsed = parsed.list;
                const objects = api.asList(parsed && parsed.alertModel !== undefined ? parsed.alertModel : parsed);
                if (!objects.length) throw new Error('文件中未找到警报');
                if (!await allowVersions(parsed?.['@version'] ? [parsed['@version']] : objects.map(object => object?.['@version']))) return;
                for (const object of objects) {
                    const identity = await resolveIdentity(object?.name, object?.id);
                    if (!identity) break;
                    try {
                        assertSession();
                        await api.alerts.create({ ...object, ...identity });
                        assertSession();
                        known.splice(0, known.length, ...known.filter(alert => alert.id !== identity.id), identity);
                        imported++;
                    } catch (e: any) {
                        assertSession();
                        toast(`导入警报出错：${e.message || e}`, 'error');
                    }
                }
            }
            if (imported) toast(`已从 ${file.name} 导入 ${imported} 个警报`);
            await refreshImported();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导入失败：${e.message}${imported ? `（已导入 ${imported} 个警报）` : ''}`, 'error');
            if (imported) {
                try { await refreshImported(); } catch { /* The session may have ended while refreshing. */ }
            }
        } finally {
            importInFlight.current = false;
        }
    }
    async function exportTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        const alert = single();
        if (!alert) return;
        try {
            await saveFile(`${alert.name || alert.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${alert.id}`);
                if (!xml || !String(xml).trim()) throw new Error('服务器上未找到该警报');
                return xml;
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导出失败：${e.message}`, 'error');
        }
    }
    async function exportAllTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        const all = alerts;
        if (!all.length) { toast('没有可导出的警报', 'warn'); return; }
        try {
            let count = 0;
            await saveFile('alerts.xml', 'application/xml', async () => {
                const parts: any[] = [];
                for (const a of all) {
                    const xml = await api.getXml(`/alerts/${a.id}`);
                    assertSession();
                    if (xml && String(xml).trim()) parts.push(String(xml).replace(/^<\?xml[^>]*\?>\s*/, '').trim());
                }
                count = parts.length;
                return `<list>\n${parts.join('\n')}\n</list>`;
            }, assertSession);
            assertSession();
            if (count) toast(`已导出 ${count} 个警报`);
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导出失败：${e.message}`, 'error');
        }
    }

    const openMenu = (a: any, e: any) => {
        const rows = selectedRows();
        setSel(rows);
        const one = rows.length === 1 ? rows[0] : null;
        contextMenu(e.clientX, e.clientY, [
            { label: '刷新', icon: 'refresh', task: 'doRefreshAlerts', group: 'alert', onClick: () => refresh() },
            { label: '新建警报', icon: 'plus', task: 'doNewAlert', group: 'alert', onClick: () => newTask() },
            { label: '导入警报', icon: 'import', task: 'doImportAlert', group: 'alert', onClick: () => importTask() },
            { label: '导出全部警报', icon: 'export', task: 'doExportAlerts', group: 'alert', onClick: () => exportAllTask() },
            '-',
            { label: '导出警报', icon: 'export', task: 'doExportAlert', group: 'alert', hidden: !one, onClick: () => exportTask() },
            { label: '删除警报', icon: 'trash', task: 'doDeleteAlert', group: 'alert', danger: true, onClick: () => deleteTask() },
            { label: '编辑警报', icon: 'edit', task: 'doEditAlert', group: 'alert', hidden: !one, onClick: () => editTask() },
            { label: '启用警报', icon: 'check', task: 'doEnableAlert', group: 'alert', hidden: !one || one.enabled, onClick: () => setEnabledTask(true) },
            { label: '禁用警报', icon: 'x', task: 'doDisableAlert', group: 'alert', hidden: !one || !one.enabled, onClick: () => setEnabledTask(false) }
        ]);
    };

    const options = useRef({
        selectable: 'multi',
        rowKey: (a: any) => a.id,
        emptyText: '未找到警报',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-alerts',
        onActivate: (a: any) => router.navigate(`/alerts/${a.id}/edit`),
        onSelect: (rows: any) => setSel(rows),
        onContextMenu: openMenu
    }).current;

    // Selection-gated visibility (Swing Alert Tasks pane): Export/Edit need a
    // single selection; Delete any; Enable/Disable show only the applicable one.
    const one = sel.length === 1 ? sel[0] : null;
    const showExport = !!one;
    const showEdit = !!one;
    const showDelete = sel.length > 0;
    const showEnable = sel.some(a => !a.enabled);
    const showDisable = sel.some(a => a.enabled);

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="警报任务" paneKey="tasks:Alert Tasks" group="alert">
                    <div className="taskbar" data-pane-title="Alert Tasks">
                        <TaskButton label="刷新" icon="refresh" task="doRefreshAlerts" onClick={refresh} />
                        <TaskButton label="新建警报" icon="plus" primary task="doNewAlert" onClick={newTask} />
                        <TaskButton label="导入警报" icon="import" task="doImportAlert" onClick={importTask} />
                        <TaskButton label="导出全部警报" icon="export" task="doExportAlerts" onClick={exportAllTask} />
                        {showExport && <TaskButton label="导出警报" icon="export" task="doExportAlert" onClick={exportTask} />}
                        {showDelete && <TaskButton label="删除警报" icon="trash" danger task="doDeleteAlert" onClick={deleteTask} />}
                        {showEdit && <TaskButton label="编辑警报" icon="edit" task="doEditAlert" onClick={editTask} />}
                        {showEnable && <TaskButton label="启用警报" icon="check" task="doEnableAlert" onClick={() => setEnabledTask(true)} />}
                        {showDisable && <TaskButton label="禁用警报" icon="x" task="doDisableAlert" onClick={() => setEnabledTask(false)} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel"><div className="panel-body flush">
                    {alertsQuery.data === undefined ? (
                        <div className="loading-block"><div className="spinner" />正在加载警报…</div>
                    ) : alerts.length === 0 ? (
                        /* Empty landing state: explain what alerts do and offer the two
                           ways in (RBAC-gated like their task buttons). */
                        <div className="dt-empty">
                            <div className="empty-icon"><Icon name="alerts" size={30} /></div>
                            <div>尚未配置警报</div>
                            <div className="mt-[14px] flex items-center justify-center gap-2">
                                {platform.checkTask('alert', 'doNewAlert') && (
                                    <button type="button" className="btn btn-primary" onClick={newTask}>
                                        <Icon name="plus" size={14} />新建警报
                                    </button>
                                )}
                                {platform.checkTask('alert', 'doImportAlert') && (
                                    <button type="button" className="btn" onClick={importTask}>
                                        <Icon name="import" size={14} />导入警报
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <DataTableHost columns={COLUMNS} options={options} rows={alerts}
                            onReady={(t: any) => { tableRef.current = t; }} />
                    )}
                </div></div>
            </div>
        </div>
    );
}
