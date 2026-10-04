/*
 * Settings view — server configuration with the same tabs as the Swing
 * Administrator's Settings panel: Server, Administrator, Tags, Configuration
 * Map, Database Tasks, Resources, plus any panels registered through
 * platform.registerSettingsPanel (e.g. Data Pruner), which append after the
 * built-ins.
 *
 * Every built-in tab body is a React component (controlled forms/grids +
 * DataTableHost tables), mounted through the SAME mountReact wrapper the
 * plugin panels use — the ctx contract (setTasks with DOM taskButton items,
 * markDirty/markClean/setSave) is unchanged, so plugin settings panels are
 * unaffected. The per-tab task pane is portaled into the rail via <ViewTasks>;
 * switching tabs swaps the pane (and title) reactively, no route change. Only
 * the active tab is mounted, and re-activating a tab reloads it.
 *
 * All writes round-trip the object shapes fetched from the engine so that XStream
 * "@class"/"@version" attributes and unknown keys survive. The per-tab Save lives
 * inside each tab's own task pane (Server/Tags/Configuration Map/Resources/Data
 * Pruner save; Administrator is localStorage-only; Database Tasks has no Save).
 */

import { withEditorSave } from '../save-lock.js';
import { loadConfigurationMapImport, serializeConfigurationMap } from './configuration-map-import.js';
import { useState, useEffect, useRef, useReducer, useMemo } from 'react';
import { h, icon, toast, taskButton, confirmDialog, promptDialog, modal, field, textInput, checkbox, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import api from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { getPref, setPrefs, resetPrefs, PREF_DEFAULTS, DASHBOARD_REFRESH_SECONDS } from '../../core/prefs.js';
import { checkImportVersionFromDoc } from '../../core/import-guard.js';
import { setTheme, setTableDensity, setFontUi, setFontMono, FONT_UI_OPTIONS, FONT_MONO_OPTIONS, getState, setState } from '../../core/store.js';
import { ViewTasks, mountReact } from '../mount.jsx';
import { applyEnvironmentColor, environmentColorVars, darkSurfaceTint, parseColorPref, serializeColorPref } from '../bridges.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { RailPane, DataTableHost } from '../ui.jsx';
import { apiUrl } from '../../core/deployment.js';
import { engineFetch, assertEngineResponse } from '../../core/engine-fetch.js';

const DIRECTORY_RESOURCE_CLASS = 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties';
const CONFIGURATION_PROPERTY_CLASS = 'com.mirth.connect.util.ConfigurationProperty';


/* ---- java.util.Properties helpers --------------------------------------------
   XStream serializes Properties as {"property":[{"@name":"key","$":"value"}]}.
   Be defensive about singletons, {entry:...} maps and plain objects, and keep
   every property (known or not) so saves never drop server-side keys. */

function listToProps(list: any) {
    return { property: list.map((p: any) => ({ '@name': p.name, $: String(p.value ?? '') })) };
}

/* ---- java.awt.Color helpers ({red, green, blue, alpha}) ---- */

function colorCss(c: any) {
    if (c && typeof c === 'object' && c.red !== undefined) {
        return `rgb(${Number(c.red) || 0}, ${Number(c.green) || 0}, ${Number(c.blue) || 0})`;
    }
    return 'rgb(192, 192, 192)';
}

function colorToHex(c: any, fallback = '#c0c0c0') {
    const part = (v: any) => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0');
    if (!c || typeof c !== 'object') return fallback;
    return '#' + part(c.red) + part(c.green) + part(c.blue);
}

function hexToColor(hex: any, alpha = 255) {
    const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
    if (!m) return { red: 192, green: 192, blue: 192, alpha };
    return {
        red: parseInt(m[1].slice(0, 2), 16),
        green: parseInt(m[1].slice(2, 4), 16),
        blue: parseInt(m[1].slice(4, 6), 16),
        alpha
    };
}

function randomPastel() {
    const c = () => 140 + Math.floor(Math.random() * 116);
    return { red: c(), green: c(), blue: c(), alpha: 255 };
}

function swatch(color: any) {
    return h('span', {
        class: 'inline-block w-[14px] h-[14px] rounded-[3px] border border-line-strong align-middle',
        style: {
            background: colorCss(color)
        }
    });
}

/* ---- misc helpers ---- */

function tabHost() {
    return h('div', { class: 'p-3.5 overflow-auto flex-1' });
}

/* ---- React tab scaffolding ----------------------------------------------------
   Ported tab bodies are React components hosted through the SAME mountReact
   wrapper the plugin settings panels use (teardown tracked on the host node so
   SettingsTab unmounts the root on tab switch). The ctx contract is unchanged:
   React inputs dispatch native input/change events, so SettingsTab's host
   listeners keep driving markDirty; task panes still receive DOM taskButton
   items via ctx.setTasks (the one contract plugin panels share). */

function reactTab(ctx: any, Component: any) {
    const hostEl = tabHost();
    (hostEl as any).__teardown = mountReact(hostEl, <Component ctx={ctx} />);
    return hostEl;
}

/* Radio-group primitives (same DOM as the Swing-era builders: .radio-group.inline-row). */
let reactRadioSeq = 0;
function RadioGroup({ options, value, onChange }: any) {
    const nameRef = useRef<any>(null);
    if (!nameRef.current) nameRef.current = 'settings-rg-' + (reactRadioSeq++);
    return (
        <div className="radio-group inline-row">
            {options.map((o: any) => (
                <label key={String(o.value)}>
                    <input type="radio" name={nameRef.current} value={o.value}
                        checked={String(o.value) === String(value)}
                        onChange={() => onChange(o.value)} />
                    {o.label}
                </label>
            ))}
        </div>
    );
}

function YesNo({ value, onChange }: any) {
    return <RadioGroup value={value ? 'yes' : 'no'} onChange={(v: any) => onChange(v === 'yes')}
        options={[{ value: 'yes', label: '是' }, { value: 'no', label: '否' }]} />;
}

function TabLoadFailed({ error }: any) {
    return (
        <div className="dt-empty">
            <div className="empty-icon">{/* warning glyph, same as loadFailed() */}
                <span className="inline-flex" ref={(el: any) => { if (el && !el.firstChild) el.appendChild(icon('warning', 30)); }} />
            </div>
            <div>加载失败</div>
            <div className="text-text-faint mt-[14px]">{String(error)}</div>
        </div>
    );
}

function Field({ label, children, className = '' }: any) {
    return <div className={'field ' + className}><label>{label}</label>{children}</div>;
}

/* Stacked label-left / control-right row (Swing settings layout; one preference
   per line). Module scope on purpose: defining it inside a tab would mint a new
   component type every render and remount each row — dropping input focus per
   keystroke and closing the native color picker mid-adjustment. */
function PrefRow({ label, children }: any) {
    return (
        <div className="flex items-center gap-4 py-2.5 px-0 border-b border-line">
            <label className="flex-1 m-0">{label}</label>
            <div className="flex-none">{children}</div>
        </div>
    );
}

/* =============================================================================
   Tab 1 — Server settings
   ServerSettings fields (verified in server/src/.../model/ServerSettings.java):
   environmentName, serverName, clearGlobalMap, queueBufferSize,
   defaultMetaDataColumns (List<MetaDataColumn> {name,type,mappingName}),
   defaultAdministratorBackgroundColor (java.awt.Color), smtpHost, smtpPort,
   smtpTimeout, smtpFrom, smtpSecure ('none'|'tls'|'ssl'), smtpAuth,
   smtpUsername, smtpPassword, loginNotificationEnabled,
   loginNotificationMessage, administratorAutoLogoutIntervalEnabled,
   administratorAutoLogoutIntervalField.
   ============================================================================ */

const DEFAULT_META_COLUMNS = {
    SOURCE: { name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' },
    TYPE: { name: 'TYPE', type: 'STRING', mappingName: 'mirth_type' },
    VERSION: { name: 'VERSION', type: 'STRING', mappingName: 'mirth_version' }
};

// Routed React roots can finish requests after logout or a tab switch. Keep
// their settings callbacks attached to the tab and session that started them.
function useSettingsSession() {
    const mounted = useRef(true);
    const [current] = useState(() => {
        const assertSession = captureEngineSession();
        return () => {
            if (!mounted.current) return false;
            try { assertSession(); return true; } catch { return false; }
        };
    });
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    return current;
}

function ServerTab({ ctx }: any) {
    const current = useSettingsSession();
    // Round-trip object (mutated on save; unknown fields survive).
    const settingsRef = useRef<any>(null);        // ServerSettings
    const [form, setForm] = useState<any>(null);  // null = loading
    const [loadError, setLoadError] = useState<any>(null);
    const patch = (p: any) => setForm((f: any) => ({ ...f, ...p }));

    async function load() {
        if (!current()) return;
        setForm(null);
        setLoadError(null);
        try {
            const settings = await api.server.settings();
            if (!current()) return;
            settingsRef.current = settings || {};
        } catch (e: any) {
            if (!current()) return;
            toast(`加载服务器设置失败：${e.message}`, 'error');
            setLoadError(String(e.message || e));
            return;
        }
        const s = settingsRef.current;
        const metaCols = api.asList(s.defaultMetaDataColumns, 'metaDataColumn')
            .filter(c => c && typeof c === 'object');
        const hasCol = (n: any) => metaCols.some(c => String(c.name || '').toUpperCase() === n);
        setForm({
            envName: s.environmentName ?? '',
            srvName: s.serverName ?? '',
            bgColor: colorToHex(s.defaultAdministratorBackgroundColor, '#2a75b2'),
            autoLogout: s.administratorAutoLogoutIntervalEnabled === true,
            autoLogoutInterval: String(s.administratorAutoLogoutIntervalField ?? 5),
            clearMap: s.clearGlobalMap === true,
            queueBuffer: String(s.queueBufferSize ?? ''),
            metaCols,
            metaSource: hasCol('SOURCE'), metaType: hasCol('TYPE'), metaVersion: hasCol('VERSION'),
            smtpHost: s.smtpHost ?? '', smtpPort: s.smtpPort ?? '',
            smtpTimeout: s.smtpTimeout ?? '', smtpFrom: s.smtpFrom ?? '',
            smtpSecure: String(s.smtpSecure || 'none').toLowerCase(),
            smtpAuth: s.smtpAuth === true,
            smtpUsername: s.smtpUsername ?? '', smtpPassword: s.smtpPassword ?? '',
            loginNotification: s.loginNotificationEnabled === true,
            loginNotificationMessage: s.loginNotificationMessage ?? ''
        });
    }

    function save() { return withEditorSave(saveUnlocked); }

    async function saveUnlocked() {
        if (!current()) return false;
        const settings = settingsRef.current;
        const f = formRef.current;
        if (!f || !settings) return;
        try {
            settings.environmentName = f.envName;
            settings.serverName = f.srvName;
            const alpha = settings.defaultAdministratorBackgroundColor?.alpha ?? 255;
            settings.defaultAdministratorBackgroundColor = hexToColor(f.bgColor, alpha);
            settings.administratorAutoLogoutIntervalEnabled = f.autoLogout;
            const interval = parseInt(f.autoLogoutInterval, 10);
            settings.administratorAutoLogoutIntervalField = isNaN(interval) ? 5 : interval;

            settings.clearGlobalMap = f.clearMap;
            if (String(f.queueBuffer) !== '') settings.queueBufferSize = parseInt(f.queueBuffer, 10);
            else delete settings.queueBufferSize;

            /* Rebuild defaultMetaDataColumns: known columns follow the
               checkboxes, unknown entries are preserved untouched. */
            const next: any[] = [];
            for (const name of ['SOURCE', 'TYPE', 'VERSION']) {
                const on = { SOURCE: f.metaSource, TYPE: f.metaType, VERSION: f.metaVersion }[name];
                if (!on) continue;
                next.push(f.metaCols.find((c: any) => String(c.name || '').toUpperCase() === name) || (DEFAULT_META_COLUMNS as any)[name]);
            }
            for (const c of f.metaCols) {
                const n = String(c.name || '').toUpperCase();
                if (n !== 'SOURCE' && n !== 'TYPE' && n !== 'VERSION') next.push(c);
            }
            settings.defaultMetaDataColumns = Array.isArray(settings.defaultMetaDataColumns)
                ? next : { metaDataColumn: next };

            settings.smtpHost = f.smtpHost;
            settings.smtpPort = f.smtpPort;
            settings.smtpTimeout = f.smtpTimeout;
            settings.smtpFrom = f.smtpFrom;
            settings.smtpSecure = f.smtpSecure;
            settings.smtpAuth = f.smtpAuth;
            settings.smtpUsername = f.smtpUsername;
            settings.smtpPassword = f.smtpPassword;

            settings.loginNotificationEnabled = f.loginNotification;
            settings.loginNotificationMessage = f.loginNotificationMessage;

            await api.server.setSettings(settings);
            if (!current()) return false;
            // Re-tint the rail + topbar live with the saved color.
            applyEnvironmentColor(settings.defaultAdministratorBackgroundColor);
            toast('服务器设置已保存');
            ctx.markClean();
            return true;
        } catch (e: any) {
            if (!current()) return false;
            toast(`保存失败：${e.message}`, 'error');
            return false;
        }
    }

    // The task pane + ctx.setSave are registered ONCE (mount); they run the
    // LATEST load/save/form through refs.
    const formRef = useRef<any>(null);
    formRef.current = form;
    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;

    function sendTestEmail() {
        if (!current()) return;
        const f = formRef.current;
        if (!f) return;
        /* Properties keys verified against SettingsPanelServer.sendTestEmail():
           port, encryption, host, timeout, authentication, username,
           password, toAddress, fromAddress. */
        const toInput = textInput(f.smtpFrom);
        modal({
            title: '发送测试邮件',
            body: field('收件人地址', toInput),
            buttons: [
                { label: '取消' },
                {
                    label: '发送', primary: true,
                    onClick: async () => {
                        if (!current()) return;
                        try {
                            const props = listToProps([
                                { name: 'port', value: f.smtpPort },
                                { name: 'encryption', value: f.smtpSecure },
                                { name: 'host', value: f.smtpHost },
                                { name: 'timeout', value: f.smtpTimeout },
                                { name: 'authentication', value: String(f.smtpAuth) },
                                { name: 'username', value: f.smtpUsername },
                                { name: 'password', value: f.smtpPassword },
                                { name: 'toAddress', value: toInput.value },
                                { name: 'fromAddress', value: f.smtpFrom }
                            ]);
                            const response = await api.server.testEmail(props);
                            if (!current()) return;
                            const message = (response && typeof response === 'object' ? response.message : response) || '测试邮件已发送';
                            const failed = response && typeof response === 'object' && response.type && response.type !== 'SUCCESS';
                            toast(String(message), failed ? 'error' : 'info');
                        } catch (e: any) {
                            if (!current()) return;
                            toast(`测试邮件发送失败：${e.message}`, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    async function backupConfig() {
        if (!current()) return;
        try {
            // Open the Save dialog within the click gesture; fetch inside the callback.
            await saveFile('server-configuration.xml', 'application/xml', async () => {
                const res = await engineFetch(apiUrl('/server/configuration'), {
                    headers: { 'Accept': 'application/xml', 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                    credentials: 'same-origin'
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const text = await res.text();
                assertEngineResponse(res);
                return text;
            }, () => { if (!current()) throw new Error('设置编辑器已失效。'); });
        } catch (e: any) {
            if (current()) toast(`备份失败：${e.message}`, 'error');
        }
    }

    // Swing alertInformation / "Select an Option" dialogs (pre-line renders \n).
    function migrationDialog(verdict: any) {
        if (verdict.action === 'block') {
            return new Promise((resolve: any) => modal({
                title: '信息',
                body: h('div', { style: 'white-space: pre-line' }, verdict.message),
                onClose: () => resolve(false),
                buttons: [{ label: '确定', primary: true, onClick: () => resolve(false) }]
            }));
        }
        return new Promise((resolve: any) => modal({
            title: '请选择操作',
            body: h('div', { style: 'white-space: pre-line' }, verdict.message),
            onClose: () => resolve(false),
            buttons: [
                { label: '否', onClick: () => resolve(false) },
                { label: '是', primary: true, onClick: () => resolve(true) }
            ]
        }));
    }

    async function restoreConfig() {
        if (!current()) return;
        let file;
        try { file = await pickFile('.xml'); }
        catch (e: any) { if (current()) toast(`恢复失败：${e.message}`, 'error'); return; }
        if (!current() || !file) return;
        // Swing promptObjectMigration("server configuration") before the restore prompt.
        const verdict = checkImportVersionFromDoc(
            new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml'), 'server configuration');
        if (verdict.action !== 'ok' && !await migrationDialog(verdict)) return;
        if (!current()) return;
        // Match the Swing import prompt: deploy ON by default, overwrite config map OFF.
        const deployCheck = checkbox('导入后部署所有通道', true);
        const overwriteCheck = checkbox('覆盖配置映射', false);
        // Swing labels the prompt with the configuration's saved date; fall back to the file name.
        const dateMatch = String(file.content || '').match(/<date>([^<]*)<\/date>/);
        const source = (dateMatch && dateMatch[1].trim()) || file.name;
        modal({
            title: '恢复服务器配置',
            body: h('div',
                h('div.mb-[14px]',
                    `确定从 ${source} 导入配置吗？警告：这将覆盖当前所有通道、` +
                    '警报、服务器属性与插件属性。'),
                deployCheck.el,
                overwriteCheck.el),
            buttons: [
                { label: '取消' },
                {
                    label: '恢复', danger: true,
                    onClick: async () => {
                        if (!current()) return;
                        try {
                            await api.put('/server/configuration', file.content, {
                                contentType: 'application/xml',
                                params: {
                                    deploy: deployCheck.input.checked,
                                    overwriteConfigMap: overwriteCheck.input.checked
                                }
                            });
                            if (!current()) return;
                            toast('服务器配置已恢复');
                            loadRef.current();
                        } catch (e: any) {
                            if (!current()) return;
                            toast(`恢复失败：${e.message}`, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    async function clearAllStatistics() {
        if (!current()) return;
        if (await confirmDialog('清除全部统计',
            '确定要清除所有通道与连接器的统计信息（已接收、已过滤、已发送、错误）吗？此操作无法撤销。',
            { danger: true, okLabel: '清除' })) {
            if (!current()) return;
            try {
                await api.statistics.clearAll();
                if (!current()) return;
                toast('已清除全部统计');
            } catch (e: any) {
                if (!current()) return;
                toast(`清除失败：${e.message}`, 'error');
            }
        }
    }

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        ctx.setTasks('服务器任务', [
            taskButton('刷新', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Server' }),
            taskButton('保存', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Server' }),
            '-',
            taskButton('备份配置', 'export', backupConfig, { task: 'doBackup', group: 'settings_Server' }),
            taskButton('恢复配置', 'import', restoreConfig, { task: 'doRestore', group: 'settings_Server' }),
            taskButton('清除全部统计', 'clear', clearAllStatistics, { danger: true, task: 'doClearAllStats', group: 'settings_Server' })
        ]);
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!form) return <div className="loading-block"><div className="spinner" />加载中…</div>;

    /* Live preview of the rail + topbar tint in both light and dark mode
       (Swing's color-chooser Preview panel), updating as the color changes. */
    const previewColor = hexToColor(form.bgColor, 255);
    const miniPreview = (dark: any) => {
        const v = environmentColorVars(previewColor, dark);
        const surf = dark ? darkSurfaceTint(previewColor) : null;
        const paneBg = surf ? surf['--bg1'] : (dark ? '#111922' : '#f4f7fa');
        return (
            <div className="w-[190px]">
                <div className="text-[10px] text-text-faint mb-[3px] uppercase tracking-[0.1em]">{dark ? '深色模式' : '浅色模式'}</div>
                <div className="border border-line rounded overflow-hidden">
                    <div className="py-[5px] px-[9px] text-[11px] font-[650]" style={{ background: (v as any).topbarBg, color: (v as any).fg }}>仪表盘</div>
                    <div className="flex min-h-16">
                        <div className="py-[7px] px-2 w-16 text-[10px]" style={{ background: v!.railBg! }}>
                            <div className="font-bold tracking-[0.1em] mb-[3px]" style={{ color: v!.fgDim! }}>任务</div>
                            <div style={{ color: v!.fg! }}>通道</div>
                            <div style={{ color: v!.fgDim! }}>消息</div>
                            <div style={{ color: v!.fgDim! }}>设置</div>
                        </div>
                        <div className="flex-1 p-2 text-[11px]" style={{ color: dark ? '#c8d4e0' : '#33414f', background: paneBg }}>示例文字</div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <div className="panel">
                <div className="panel-header">常规</div>
                <div className="panel-body"><div className="form-grid">
                    <Field label="环境名称">
                        <input type="text" value={form.envName} onChange={(e: any) => patch({ envName: e.target.value })} />
                    </Field>
                    <Field label="服务器名称">
                        <input type="text" value={form.srvName} onChange={(e: any) => patch({ srvName: e.target.value })} />
                    </Field>
                    <Field label="默认背景色">
                        <div className="flex items-center">
                            <input type="color" className="w-[60px] p-0.5 h-8" value={form.bgColor}
                                onChange={(e: any) => patch({ bgColor: e.target.value })} />
                            {/* Reset the picker to the engine default (ServerSettings.DEFAULT_COLOR = 0x2A75B2). */}
                            <button type="button" className="btn ml-2" title="重置为默认背景色"
                                onClick={() => patch({ bgColor: '#2a75b2' })}>恢复默认</button>
                        </div>
                    </Field>
                    <div className="field span-2">
                        <label>预览</label>
                        <div className="flex gap-3.5 flex-wrap">{miniPreview(false)}{miniPreview(true)}</div>
                    </div>
                    <Field label="启用自动退出登录">
                        <YesNo value={form.autoLogout} onChange={(v: any) => patch({ autoLogout: v })} />
                    </Field>
                    <Field label="自动退出登录间隔（分钟）">
                        <input type="number" min="1" disabled={!form.autoLogout} value={form.autoLogoutInterval}
                            onChange={(e: any) => patch({ autoLogoutInterval: e.target.value })} />
                    </Field>
                </div></div>
            </div>
            <div className="panel">
                <div className="panel-header">通道</div>
                <div className="panel-body"><div className="form-grid">
                    <Field label="重新部署时清除全局映射">
                        <YesNo value={form.clearMap} onChange={(v: any) => patch({ clearMap: v })} />
                    </Field>
                    <Field label="默认队列缓冲区大小">
                        <input type="number" min="1" value={form.queueBuffer}
                            onChange={(e: any) => patch({ queueBuffer: e.target.value })} />
                    </Field>
                    <Field label="默认元数据列">
                        <div className="radio-group inline-row">
                            <label className="check"><input type="checkbox" checked={form.metaSource} onChange={(e: any) => patch({ metaSource: e.target.checked })} />源</label>
                            <label className="check"><input type="checkbox" checked={form.metaType} onChange={(e: any) => patch({ metaType: e.target.checked })} />类型</label>
                            <label className="check"><input type="checkbox" checked={form.metaVersion} onChange={(e: any) => patch({ metaVersion: e.target.checked })} />版本</label>
                        </div>
                    </Field>
                </div></div>
            </div>
            <div className="panel">
                <div className="panel-header">电子邮件</div>
                <div className="panel-body"><div className="form-grid">
                    <Field label="SMTP 主机">
                        <div className="flex items-center gap-2">
                            <input type="text" value={form.smtpHost} onChange={(e: any) => patch({ smtpHost: e.target.value })} />
                            <button type="button" className="btn whitespace-nowrap" onClick={sendTestEmail}>
                                <span className="inline-flex" ref={(el: any) => { if (el && !el.firstChild) el.appendChild(icon('mail')); }} />发送测试邮件
                            </button>
                        </div>
                    </Field>
                    <Field label="SMTP 端口">
                        <input type="text" value={form.smtpPort} onChange={(e: any) => patch({ smtpPort: e.target.value })} />
                    </Field>
                    <Field label="发送超时（毫秒）">
                        <input type="text" value={form.smtpTimeout} onChange={(e: any) => patch({ smtpTimeout: e.target.value })} />
                    </Field>
                    <Field label="默认发件人地址">
                        <input type="text" value={form.smtpFrom} onChange={(e: any) => patch({ smtpFrom: e.target.value })} />
                    </Field>
                    <Field label="安全连接">
                        <RadioGroup value={form.smtpSecure} onChange={(v: any) => patch({ smtpSecure: v })} options={[
                            { value: 'none', label: '无' },
                            { value: 'tls', label: 'STARTTLS' },
                            { value: 'ssl', label: 'SSL' }
                        ]} />
                    </Field>
                    <Field label="需要认证">
                        <YesNo value={form.smtpAuth} onChange={(v: any) => patch({ smtpAuth: v })} />
                    </Field>
                    <Field label="用户名">
                        <input type="text" disabled={!form.smtpAuth} value={form.smtpUsername}
                            onChange={(e: any) => patch({ smtpUsername: e.target.value })} />
                    </Field>
                    <Field label="密码">
                        {/* SMTP relay credential, not the user's own login — don't
                            let the browser save or autofill it (#24). */}
                        <input type="password" autoComplete="off" disabled={!form.smtpAuth} value={form.smtpPassword}
                            onChange={(e: any) => patch({ smtpPassword: e.target.value })} />
                    </Field>
                </div></div>
            </div>
            <div className="panel">
                <div className="panel-header">通知</div>
                <div className="panel-body">
                    <Field label="要求登录通知与同意">
                        <YesNo value={form.loginNotification} onChange={(v: any) => patch({ loginNotification: v })} />
                    </Field>
                    <Field label="登录通知">
                        <textarea disabled={!form.loginNotification} value={form.loginNotificationMessage}
                            onChange={(e: any) => patch({ loginNotificationMessage: e.target.value })} />
                    </Field>
                </div>
            </div>
        </>
    );
}

/* =============================================================================
   Tab 2 — Channel tags
   ChannelTag: { id, name, channelIds (set of string), backgroundColor (Color) }
   ============================================================================ */

function fixTagName(name: any) {
    // Engine ChannelTag.INVALID_NAME_PATTERN allows CJK and '&'; mirror it exactly.
    const fixed = String(name || '').replace(/[^a-zA-Z_0-9&\-\s\u4e00-\u9fa5]/g, '').slice(0, 24);
    return fixed.trim() === '' ? '_' : fixed;
}

function channelIdNamePairs(raw: any) {
    const out: any[] = [];
    if (raw && typeof raw === 'object' && raw.entry !== undefined) {
        for (const e of api.asList(raw.entry)) {
            if (!e || typeof e !== 'object') continue;
            const s = e.string;
            if (Array.isArray(s)) out.push({ id: String(s[0] ?? ''), name: String(s[1] ?? s[0] ?? '') });
            else if (s !== undefined) out.push({ id: String(s), name: String(s) });
        }
    } else if (raw && typeof raw === 'object') {
        for (const [id, name] of Object.entries(raw)) {
            if (id.startsWith('@')) continue;
            out.push({ id, name: String(name ?? id) });
        }
    }
    out.sort((a: any, b: any) => a.name.localeCompare(b.name));
    return out;
}

/* =============================================================================
   Tab 2 — Administrator (browser preferences)
   The web-admin equivalent of the Swing SettingsPanelAdministrator, slimmed to
   the settings that actually apply to a browser client (System / User
   Preferences); stored per-browser via core/prefs.js.
   ============================================================================ */

function AdministratorTab({ ctx }: any) {
    const current = useSettingsSession();
    const [form, setForm] = useState<any>(null);
    const patch = (p: any) => setForm((f: any) => ({ ...f, ...p }));
    const serverDefaultColorRef = useRef<any>(null);   // loaded async, for the live re-tint on save
    const userId = getState('user')?.id;

    const yesNoAskValue = (val: any) => (['yes', 'no', 'ask'].includes(val) ? val : 'ask');
    const builderValue = (val: any) => (['ask', 'classic', 'guided'].includes(val) ? val : 'ask');
    const fontUiValue = (val: any) => (FONT_UI_OPTIONS.includes(val) ? val : 'inter');
    const fontMonoValue = (val: any) => (FONT_MONO_OPTIONS.includes(val) ? val : 'jetbrains');

    function load() {
        if (!current()) return;
        setForm({
            dashRefresh: String(getPref('dashboardRefreshSeconds') ?? ''),
            msgPageSize: String(Number(getPref('messagePageSize')) || 20),
            evtPageSize: String(Number(getPref('eventPageSize')) || 20),
            formatMsgs: getPref('formatMessages') !== false,
            confirmReprocess: getPref('confirmReprocessRemove') !== false,
            importLibs: yesNoAskValue(getPref('importLibrariesWithChannels')),
            exportLibs: yesNoAskValue(getPref('exportLibrariesWithChannels')),
            newChannelDefault: builderValue(getPref('newChannelDefault')),
            newAlertDefault: builderValue(getPref('newAlertDefault')),
            showViewSwitch: getPref('showViewSwitch') !== false,
            theme: document.documentElement.dataset.theme || 'light',
            tableDensity: getPref('tableDensity') || 'normal',
            fontUi: fontUiValue(getPref('fontUi')),
            fontMono: fontMonoValue(getPref('fontMono')),
            bgMode: 'default',
            bgColor: '#2a75b2'
        });
        // Per-user background-color override (Swing SettingsPanelAdministrator):
        // "Server Default" uses the server's color; "Custom" overrides it for
        // this user. Stored as the server user preference "backgroundColor".
        (async () => {
            try {
                const [srv, bgPref] = await Promise.all([
                    api.server.settings().catch(() => null),
                    // Single-key RAW read (see bridges.jsx / welcome.js): the bulk
                    // getPreferences collapses/mangles the <awt-color> value.
                    userId != null ? api.users.getPreference(userId, 'backgroundColor', { raw: true }).catch(() => null) : Promise.resolve(null)
                ]);
                if (!current()) return;
                serverDefaultColorRef.current = srv && srv.defaultAdministratorBackgroundColor;
                const override = parseColorPref(bgPref);
                if (override) patch({ bgMode: 'custom', bgColor: colorToHex(override, '#2a75b2') });
            } catch { /* ignore */ }
        })();
    }

    function save() { return withEditorSave(saveUnlocked); }

    async function saveUnlocked() {
        if (!current()) return false;
        const f = formRef.current;
        if (!f) return;
        setPrefs({
            dashboardRefreshSeconds: Math.max(1, parseInt(f.dashRefresh, 10) || DASHBOARD_REFRESH_SECONDS),
            messagePageSize: Number(f.msgPageSize) || 20,
            eventPageSize: Number(f.evtPageSize) || 20,
            formatMessages: f.formatMsgs,
            confirmReprocessRemove: f.confirmReprocess,
            importLibrariesWithChannels: f.importLibs,
            exportLibrariesWithChannels: f.exportLibs,
            newChannelDefault: f.newChannelDefault,
            newAlertDefault: f.newAlertDefault,
            showViewSwitch: f.showViewSwitch,
            tableDensity: f.tableDensity,
            fontUi: f.fontUi,
            fontMono: f.fontMono
        });
        setTheme(f.theme);
        setTableDensity(f.tableDensity);   // takes effect now, like the theme
        setFontUi(f.fontUi);
        setFontMono(f.fontMono);
        // Persist the per-user color override (or clear it) and re-tint live.
        // Swing (SettingsPanelAdministrator.doSave) writes this as a single
        // preference: setUserPreference(id, "backgroundColor", <awt-color xml>).
        // The whole-map PUT deserializes to a Java Properties server-side and
        // 500s on the <awt-color> value (issue #10), so mirror Swing exactly
        // and set just the one key (stored verbatim, no server-side parsing).
        if (userId != null) {
            try {
                let effective, value;
                if (f.bgMode === 'custom') {
                    const c = hexToColor(f.bgColor, 255);
                    value = serializeColorPref(c);   // <awt-color> XML (Swing-compatible)
                    effective = c;
                } else {
                    // Swing clears the override by writing ObjectXMLSerializer
                    // .serialize(null) === "<null/>" (NOT an empty string). Match
                    // it: both tools read a non-<awt-color> value as server
                    // default, and a non-empty value avoids an Oracle edge case
                    // where '' -> NULL breaks the insert/update existence check
                    // and can duplicate the preference row.
                    value = '<null/>';
                    effective = serverDefaultColorRef.current;
                }
                await api.users.setPreference(userId, 'backgroundColor', value);
                if (!current()) return false;
                applyEnvironmentColor(effective);
            } catch (e: any) {
                if (!current()) return false;
                toast(`无法保存背景色：${e.message}`, 'error');
                return false;
            }
        }
        ctx.markClean();
        toast('偏好设置已保存');
        return true;
    }

    function restoreDefaults() {
        // resetPrefs persists immediately, so keep the live document in the same
        // committed state. Programmatic form changes do not fire the tab host's
        // dirty listeners; this action is complete, not a pending edit.
        resetPrefs();
        setTableDensity(PREF_DEFAULTS.tableDensity);
        setFontUi(PREF_DEFAULTS.fontUi);
        setFontMono(PREF_DEFAULTS.fontMono);
        loadRef.current();
        ctx.markClean();
        toast('偏好设置已恢复默认');
    }

    const formRef = useRef<any>(null);
    formRef.current = form;
    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        ctx.setTasks('管理员任务', [
            taskButton('刷新', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Administrator' }),
            taskButton('保存', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Administrator' }),
            taskButton('恢复默认设置', 'refresh', restoreDefaults, { task: 'doSetAdminDefaults', group: 'settings_Administrator' })
        ]);
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!form) return <div className="loading-block"><div className="spinner" />加载中…</div>;

    const pageSizeOptions = [20, 50, 100].map((n: any) => <option key={n} value={String(n)}>{n}</option>);

    return (
        <>
            <div className="panel">
                <div className="panel-header">系统偏好设置</div>
                <div className="panel-body">
                    <PrefRow label="仪表盘刷新间隔（秒）">
                        <input type="number" min="1" value={form.dashRefresh}
                            onChange={(e: any) => patch({ dashRefresh: e.target.value })} />
                    </PrefRow>
                    <PrefRow label="消息浏览器每页条数">
                        <select value={form.msgPageSize} onChange={(e: any) => patch({ msgPageSize: e.target.value })}>{pageSizeOptions}</select>
                    </PrefRow>
                    <PrefRow label="事件浏览器每页条数">
                        <select value={form.evtPageSize} onChange={(e: any) => patch({ evtPageSize: e.target.value })}>{pageSizeOptions}</select>
                    </PrefRow>
                    <PrefRow label="格式化消息浏览器中的文本">
                        <YesNo value={form.formatMsgs} onChange={(v: any) => patch({ formatMsgs: v })} />
                    </PrefRow>
                    <PrefRow label="重新处理/移除消息时需确认">
                        <YesNo value={form.confirmReprocess} onChange={(v: any) => patch({ confirmReprocess: v })} />
                    </PrefRow>
                    <PrefRow label="导入通道时一并导入代码模板库">
                        <select value={form.importLibs} onChange={(e: any) => patch({ importLibs: e.target.value })}>
                            <option value="yes">是</option><option value="no">否</option><option value="ask">询问</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="导出通道时一并导出代码模板库">
                        <select value={form.exportLibs} onChange={(e: any) => patch({ exportLibs: e.target.value })}>
                            <option value="yes">是</option><option value="no">否</option><option value="ask">询问</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="新建通道默认编辑器">
                        <select value={form.newChannelDefault} onChange={(e: any) => patch({ newChannelDefault: e.target.value })}>
                            <option value="ask">每次询问</option><option value="classic">经典编辑器</option><option value="guided">向导</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="新建警报默认编辑器">
                        <select value={form.newAlertDefault} onChange={(e: any) => patch({ newAlertDefault: e.target.value })}>
                            <option value="ask">每次询问</option><option value="classic">经典编辑器</option><option value="guided">向导</option>
                        </select>
                    </PrefRow>
                    <PrefRow label={'在通道/警报编辑器中显示“切换视图”'}>
                        <YesNo value={form.showViewSwitch} onChange={(v: any) => patch({ showViewSwitch: v })} />
                    </PrefRow>
                </div>
            </div>
            <div className="panel">
                <div className="panel-header">用户偏好设置</div>
                <div className="panel-body">
                    {/* The pending choices, before Save applies them to the app.
                        Theme, density and the typeface pair are plain data attributes,
                        and the app's own rules key off them without needing :root — so
                        the very CSS that dresses the app dresses this sample, with no
                        second set of styles to drift. It sits ABOVE the controls
                        because this panel is the last on a long tab: below them it
                        fell off the fold, and a preview you have to scroll to is one
                        nobody sees change. The counts column is .num so the Data font
                        choice is visible here too. */}
                    <div className="pref-preview" data-theme={form.theme}
                        data-table-density={form.tableDensity}
                        data-font-ui={form.fontUi} data-font-mono={form.fontMono}
                        style={form.bgMode === 'custom' ? { '--rail-bg': form.bgColor } as any : undefined}>
                        <div className="pref-preview-label">预览</div>
                        <div className="pref-preview-frame">
                            <div className="pref-preview-rail">
                                <span className="pref-preview-brand" /><span /><span /><span />
                            </div>
                            <table className="dt">
                                <thead>
                                    <tr><th>状态</th><th>名称</th><th className="num">已接收</th></tr>
                                </thead>
                                <tbody>
                                    {[
                                        ['ok', '已启动', '演示通道', '48,316'],
                                        ['ok', '已启动', 'HL7 入站', '12,004'],
                                        ['warn', '已暂停', 'DICOM 发送器', '1,204'],
                                        ['ok', '已启动', 'Web 演示', '860'],
                                        ['err', '已停止', '示例 - 校验 XSD', '0'],
                                        ['ok', '已启动', '全局路由器', '9,431'],
                                        ['ok', '已启动', '文件投放', '77'],
                                    ].map(([pip, state, name, count]) => (
                                        <tr key={name}>
                                            <td><span className={'pip ' + pip} /> {state}</td>
                                            <td>{name}</td><td className="num">{count}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <PrefRow label="表格密度">
                        <select value={form.tableDensity} onChange={(e: any) => patch({ tableDensity: e.target.value })}>
                            <option value="compact">紧凑</option>
                            <option value="normal">标准</option>
                            <option value="wide">宽松</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="主题">
                        <select value={form.theme} onChange={(e: any) => patch({ theme: e.target.value })}>
                            <option value="light">浅色</option>
                            <option value="dark">深色</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="界面字体">
                        <select value={form.fontUi} onChange={(e: any) => patch({ fontUi: e.target.value })}>
                            <option value="inter">Inter（默认）</option>
                            <option value="plex">IBM Plex Sans</option>
                            <option value="b612">B612 — 航电</option>
                            <option value="martian">Martian Mono — 终端</option>
                            <option value="system">系统</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="数据字体">
                        <select value={form.fontMono} onChange={(e: any) => patch({ fontMono: e.target.value })}>
                            <option value="jetbrains">JetBrains Mono（默认）</option>
                            <option value="plexmono">IBM Plex Mono</option>
                            <option value="b612mono">B612 Mono — 航电</option>
                            <option value="martian">Martian Mono — 终端</option>
                            <option value="system">系统</option>
                        </select>
                    </PrefRow>
                    <PrefRow label="背景色">
                        <div className="flex items-center">
                            <select value={form.bgMode} onChange={(e: any) => patch({ bgMode: e.target.value })}>
                                <option value="default">服务器默认</option>
                                <option value="custom">自定义</option>
                            </select>
                            <input type="color" className="w-[60px] p-0.5 h-8 ml-2" disabled={form.bgMode !== 'custom'}
                                value={form.bgColor} onChange={(e: any) => patch({ bgColor: e.target.value })} />
                        </div>
                    </PrefRow>
                </div>
            </div>
        </>
    );
}

function TagsTab({ ctx }: any) {
    const current = useSettingsSession();
    /* Edit-session model: tag objects are mutated in place (their identity is
       the setChannelTags payload); mutations bump the container to repaint.
       Modal-driven mutations (add/edit/remove) call ctx.markDirty() explicitly —
       modals live outside the tab host, so their edits never bubble into the
       auto-dirty listeners (the legacy builder silently missed them). */
    const [tags, setTags] = useState<any>(null);          // null = loading
    const tagsNowRef = useRef(tags);
    tagsNowRef.current = tags;
    const [allChannels, setAllChannels] = useState([] as any[]);
    const [selectedId, setSelectedId] = useState<any>(null);
    const [chFilter, setChFilter] = useState('');
    const [loadError, setLoadError] = useState<any>(null);
    const tableRef = useRef<any>(null);

    const tagChannelIds = (tag: any) => api.asList(tag.channelIds, 'string').map(String);
    const setTagChannelIds = (tag: any, ids: any) => { tag.channelIds = ids.length ? { string: ids } : ''; };
    const channelCount = (tag: any) => tagChannelIds(tag).length;
    const touch = () => setTags((prev: any) => (prev ? prev.slice() : prev));

    const currentTag = (tags || []).find((t: any) => t.id === selectedId) || null;

    async function load() {
        if (!current()) return;
        setLoadError(null);
        try {
            const [tagList, idsAndNames] = await Promise.all([
                api.server.channelTags(),
                api.channels.idsAndNames()
            ]);
            if (!current()) return;
            setTags(tagList);
            setAllChannels(channelIdNamePairs(idsAndNames));
            setSelectedId(null);
            tableRef.current?.clearSelection();
        } catch (e: any) {
            if (!current()) return;
            toast(`加载标签失败：${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    function visibleChannels() {
        const filter = chFilter.trim().toLowerCase();
        return filter ? allChannels.filter(c => c.name.toLowerCase().includes(filter)) : allChannels;
    }

    function toggleChannel(tag: any, id: any, on: any) {
        const cur = new Set(tagChannelIds(tag));
        if (on) cur.add(id); else cur.delete(id);
        setTagChannelIds(tag, [...cur]);
        touch();
    }

    function bulkSelect(checked: any) {
        const tag = tagsNowRef.current?.find((t: any) => t.id === selectedId) || null;
        if (!tag) { toast('请先选择标签', 'warn'); return; }
        const cur = new Set(tagChannelIds(tag));
        for (const ch of visibleChannels()) {
            if (checked) cur.add(ch.id); else cur.delete(ch.id);
        }
        setTagChannelIds(tag, [...cur]);
        touch();
        ctx.markDirty();
    }

    async function addTag() {
        if (!current()) return;
        const name = await promptDialog('新建标签', '标签名称');
        if (!current() || name === null || name.trim() === '') return;
        setTags((prev: any) => [...(prev || []), {
            id: crypto.randomUUID(),
            name: fixTagName(name),
            channelIds: '',
            backgroundColor: randomPastel()
        }]);
        ctx.markDirty();
    }

    function editTag(tag: any) {
        const nameInput = textInput(tag.name || '', { maxlength: 24, title: '仅允许字母、数字、空格、- 和 _（最多 24 个字符）' });
        const colorInput = h('input', { type: 'color', value: colorToHex(tag.backgroundColor), class: 'w-[60px] p-0.5' });
        modal({
            title: '编辑标签',
            body: h('div',
                field('名称', nameInput),
                field('颜色', colorInput)),
            buttons: [
                { label: '取消' },
                {
                    label: '确定', primary: true,
                    onClick: () => {
                        tag.name = fixTagName(nameInput.value);
                        const alpha = tag.backgroundColor && tag.backgroundColor.alpha !== undefined
                            ? tag.backgroundColor.alpha : 255;
                        tag.backgroundColor = hexToColor((colorInput as any).value, alpha);
                        touch();
                        ctx.markDirty();
                    }
                }
            ]
        });
    }

    async function removeTag(tagArg: any) {
        if (!current()) return;
        const tag = tagArg || tagsNowRef.current?.find((t: any) => t.id === selectedId) || null;
        if (!tag) { toast('请先选择标签', 'warn'); return; }
        if (await confirmDialog('移除标签', `确定要移除标签 "${tag.name}" 吗？保存后生效。`, { danger: true, okLabel: '移除' })) {
            if (!current()) return;
            setTags((prev: any) => prev.filter((t: any) => t !== tag));
            setSelectedId((prev: any) => (prev === tag.id ? null : prev));
            ctx.markDirty();
        }
    }

    function save() { return withEditorSave(saveUnlocked); }

    async function saveUnlocked() {
        if (!current()) return false;
        try {
            await api.server.setChannelTags(tagsNowRef.current || []);
            if (!current()) return false;
            ctx.markClean();
            toast('标签已保存');
            await loadRef.current();
            return current();
        } catch (e: any) {
            if (!current()) return false;
            toast(`保存失败：${e.message}`, 'error');
            return false;
        }
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;
    const addRef = useRef(addTag);
    addRef.current = addTag;
    const editRef = useRef(editTag);
    editRef.current = editTag;
    const removeRef = useRef<any>(removeTag);
    removeRef.current = removeTag;

    // Table config is mount-captured by DataTableHost — every callback routes
    // through the refs above so it always runs the latest closure.
    const columns = useRef([
        { key: 'color', label: '', width: '36px', sortable: false, render: (t: any) => swatch(t.backgroundColor) },
        { key: 'name', label: '名称', render: (t: any) => t.name || '' },
        { key: 'channels', label: '通道数', className: 'num', width: '130px', sortValue: (t: any) => channelCount(t), render: (t: any) => String(channelCount(t)) }
    ]).current;
    const options = useRef({
        selectable: 'single',
        rowKey: (t: any) => t.id,
        emptyText: '暂无标签',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-tags',
        onSelect: (rows: any) => setSelectedId(rows[0] ? rows[0].id : null),
        onActivate: (t: any) => editRef.current(t),
        onContextMenu: (t: any, e: any) => {
            setSelectedId(t.id);
            if (tableRef.current) { tableRef.current.selected = new Set([t.id]); tableRef.current.render(); }
            // Tag mutations ride settings_Tags/doSave (no Swing constants —
            // same convention as the Config Map Add Row, RBAC.md §3).
            contextMenu(e.clientX, e.clientY, [
                { label: '新建标签', icon: 'plus', task: 'doSave', group: 'settings_Tags', onClick: () => addRef.current() },
                { label: '编辑标签', icon: 'edit', task: 'doSave', group: 'settings_Tags', onClick: () => editRef.current(t) },
                '-',
                { label: '移除标签', icon: 'trash', danger: true, task: 'doSave', group: 'settings_Tags', onClick: () => removeRef.current(t) }
            ]);
        }
    }).current;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-dependent tasks only show when a tag is selected.
    useEffect(() => {
        ctx.setTasks('标签任务', [
            taskButton('刷新', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Tags' }),
            taskButton('保存', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Tags' }),
            taskButton('添加标签', 'plus', () => addRef.current(), { task: 'doSave', group: 'settings_Tags' }),
            selectedId ? taskButton('移除标签', 'trash', () => removeRef.current(), { danger: true, task: 'doSave', group: 'settings_Tags' }) : null
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!tags) return <div className="loading-block"><div className="spinner" />加载中…</div>;

    const ids = currentTag ? new Set(tagChannelIds(currentTag)) : null;
    const visible = visibleChannels();

    return (
        <>
            <div className="panel"><div className="panel-body flush">
                <DataTableHost columns={columns} options={options} rows={tags}
                    onReady={(t: any) => { tableRef.current = t; }} />
            </div></div>
            <div className="panel">
                <div className="panel-header">通道</div>
                <div className="panel-body">
                    <div className="hint mb-[14px]">通道选择将应用于当前选中的标签。</div>
                    <div className="flex items-center gap-2 mb-[14px]">
                        <input type="text" placeholder="筛选通道" className="max-w-[280px]"
                            value={chFilter} onChange={(e: any) => setChFilter(e.target.value)} />
                        <button type="button" className="btn" onClick={() => bulkSelect(true)}>全选</button>
                        <button type="button" className="btn" onClick={() => bulkSelect(false)}>全不选</button>
                    </div>
                    <div className="max-h-[260px] overflow-auto flex flex-col gap-1.5">
                        {!currentTag ? (
                            <div className="text-text-faint">请在上方选择标签以编辑其通道分配</div>
                        ) : visible.length === 0 ? (
                            <div className="text-text-faint">没有通道匹配筛选条件</div>
                        ) : (
                            visible.map((ch: any) => (
                                <label key={ch.id} className="check">
                                    <input type="checkbox" checked={ids!.has!(ch.id)}
                                        onChange={(e: any) => toggleChannel(currentTag, ch.id, e.target.checked)} />
                                    {ch.name}
                                </label>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

/* =============================================================================
   Tab 3 — Configuration Map
   {entry:[{string: key, 'com.mirth.connect.util.ConfigurationProperty':
            {value, comment}}]}
   ============================================================================ */

let cfgRowSeq = 0;
const newCfgRow = (key = '', value = '', comment = '', propKey = CONFIGURATION_PROPERTY_CLASS, prop = null) =>
    ({ _id: ++cfgRowSeq, key, value, comment, propKey, prop });

function ConfigurationMapTab({ ctx }: any) {
    const currentSession = useSettingsSession();
    /* Rows are plain state; inputs are controlled with STABLE per-row keys so
       typing keeps focus across re-renders and insert/delete never re-binds a
       neighboring row's value. Insert/delete positions use the ORIGINAL index
       (the filter only hides rows), exactly like the legacy grid. */
    const [rows, setRows] = useState<any>(null);          // null = loading
    const rowsNowRef = useRef(rows);
    rowsNowRef.current = rows;
    const [filterText, setFilterText] = useState('');
    const [showValues, setShowValues] = useState(false);
    const [loadError, setLoadError] = useState<any>(null);
    // Bumped on structural changes only (load/insert/delete/add/import). The
    // content filter re-applies on FILTER or STRUCTURE changes — never on a
    // value keystroke, so the row being edited can't vanish under the cursor
    // (and a just-added blank row survives its first characters), matching the
    // legacy grid's re-filter timing.
    const [structureVersion, setStructureVersion] = useState(0);
    const bumpStructure = () => setStructureVersion(v => v + 1);

    async function load() {
        if (!currentSession()) return;
        setLoadError(null);
        try {
            const raw = await api.server.configurationMap();
            if (!currentSession()) return;
            const next: any[] = [];
            for (const entry of api.asList(raw && raw.entry)) {
                if (!entry || typeof entry !== 'object') continue;
                const key = Array.isArray(entry.string) ? entry.string[0] : entry.string;
                let propKey = CONFIGURATION_PROPERTY_CLASS;
                let prop = entry[CONFIGURATION_PROPERTY_CLASS];
                if (prop === undefined || prop === null || typeof prop !== 'object') {
                    for (const [k, v] of Object.entries(entry)) {
                        if (k !== 'string' && v && typeof v === 'object') { propKey = k; prop = v; break; }
                    }
                }
                next.push(newCfgRow(
                    String(key ?? ''),
                    String(prop?.value ?? ''),
                    String(prop?.comment ?? ''),
                    propKey,
                    (prop && typeof prop === 'object') ? prop : null));
            }
            setRows(next);
            bumpStructure();
        } catch (e: any) {
            if (!currentSession()) return;
            toast(`加载配置映射失败：${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    function save() { return withEditorSave(saveUnlocked); }

    async function saveUnlocked() {
        if (!currentSession()) return false;
        try {
            /* Round-trip each entry's property-class key and any extra fields
               the engine put on the ConfigurationProperty. */
            const current = rowsNowRef.current || [];
            if (current.some((row: any) => !row.key.trim() && (row.value.trim() || row.comment.trim()))) {
                toast('不允许使用空键名', 'warn');
                return false;
            }
            const entry = current.filter((r: any) => r.key.trim() !== '').map((r: any) => ({
                string: r.key,
                [r.propKey || CONFIGURATION_PROPERTY_CLASS]: { ...(r.prop || {}), value: r.value, comment: r.comment }
            }));
            await api.server.setConfigurationMap({ entry });
            if (!currentSession()) return false;
            ctx.markClean();
            toast('配置映射已保存');
            return true;
        } catch (e: any) {
            if (!currentSession()) return false;
            toast(`保存失败：${e.message}`, 'error');
            return false;
        }
    }

    function importMap() { return withEditorSave(importMapUnlocked, '正在导入配置映射…'); }

    async function importMapUnlocked() {
        if (!currentSession()) return;
        if (!rowsNowRef.current) { toast('配置映射尚未加载', 'warn'); return; }
        let file;
        try { file = await pickFile('.properties'); }
        catch (e: any) {
            if (currentSession()) toast(`导入失败：${e.message}`, 'error');
            return;
        }
        if (!currentSession() || !file) return;
        let imported;
        try {
            imported = await loadConfigurationMapImport(String(file.content), file.name, async include => {
                if (!currentSession()) return undefined;
                const choice = await new Promise<'select' | 'skip' | null>(resolve => modal({
                    title: '导入内嵌属性文件',
                    body: h('p', `请选择配置映射引用的 "${include.path}"。${include.optional ? '该文件为可选，若不存在可以跳过。' : ''}`),
                    onClose: () => resolve(null),
                    buttons: [
                        { label: '取消', onClick: () => resolve(null) },
                        ...(include.optional ? [{ label: '跳过', onClick: () => resolve('skip') }] : []),
                        { label: '选择文件', primary: true, onClick: () => resolve('select') }
                    ]
                }));
                if (!currentSession() || choice === null) return undefined;
                if (choice === 'skip') return null;
                const included = await pickFile('.properties');
                if (!currentSession() || !included) return undefined;
                return String(included.content);
            });
        }
        catch (e: any) {
            if (currentSession()) toast(`导入失败：${e.message}`, 'error');
            return;
        }
        if (!currentSession() || imported === null) return;
        const ok = await confirmDialog('导入配置映射',
            `确定要用 "${file.name}" 中的 ${imported.length} 个属性替换配置映射吗？现有条目与注释将被替换。保存后导入的映射才会生效。`,
            { okLabel: '导入' });
        if (!currentSession() || !ok) return;
        setRows(imported.map(imp => newCfgRow(imp.key, imp.value, imp.comment)));
        bumpStructure();
        ctx.markDirty();
        toast(`已导入 ${imported.length} 个属性——保存后生效`);
    }

    async function exportMap() {
        if (!currentSession()) return;
        const content = serializeConfigurationMap(rowsNowRef.current || []);
        try {
            await saveFile('configuration.properties', 'text/plain', content, () => {
                if (!currentSession()) throw new Error('设置编辑器已失效。');
            });
        } catch (e: any) {
            if (currentSession()) toast(`导出失败：${e.message}`, 'error');
        }
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;
    const importRef = useRef(importMap);
    importRef.current = importMap;
    const exportRef = useRef(exportMap);
    exportRef.current = exportMap;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        ctx.setTasks('配置映射任务', [
            taskButton('刷新', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Configuration Map' }),
            taskButton('保存', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Configuration Map' }),
            taskButton('导入映射', 'import', () => importRef.current(), { task: 'doImportMap', group: 'settings_Configuration Map' }),
            taskButton('导出映射', 'export', () => exportRef.current(), { task: 'doExportMap', group: 'settings_Configuration Map' })
        ]);
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Visible-row set, frozen between filter/structure changes (see above). */
    const visibleIds = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        const matches = (row: any) => {
            if (!q) return true;
            // Blank rows (e.g. a just-added row) always show so adding while
            // filtering isn't hidden.
            if (!row.key && !row.value && !row.comment) return true;
            return row.key.toLowerCase().includes(q)
                || row.value.toLowerCase().includes(q)
                || row.comment.toLowerCase().includes(q);
        };
        return new Set((rowsNowRef.current || []).filter(matches).map((r: any) => r._id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterText, structureVersion]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!rows) return <div className="loading-block"><div className="spinner" />加载中…</div>;

    const shown = rows.filter((r: any) => visibleIds.has(r._id)).length;
    const patchRow = (id: any, patch: any) => setRows((prev: any) => prev.map((r: any) => (r._id === id ? { ...r, ...patch } : r)));
    const insertAt = (i: any) => { setRows((prev: any) => { const next = prev.slice(); next.splice(i, 0, newCfgRow()); return next; }); bumpStructure(); ctx.markDirty(); };
    const deleteAt = (i: any) => { setRows((prev: any) => { const next = prev.slice(); next.splice(i, 1); return next; }); bumpStructure(); ctx.markDirty(); };
    const addRow = () => { setRows((prev: any) => [...prev, newCfgRow()]); bumpStructure(); ctx.markDirty(); };

    const valueType = showValues ? 'text' : 'password';

    return (
        <div className="panel">
            {/* Controls live in the panel header (this app's convention — panels carry
                their tools in .panel-tools), so the filter attaches to the table it acts on. */}
            <div className="panel-header">配置映射
                <div className="panel-tools">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius)] border border-line-strong bg-bg2 text-text-dim min-w-[260px]">
                        <span className="inline-flex" ref={(el: any) => { if (el && !el.firstChild) el.appendChild(icon('search', 15)); }} />
                        <input type="search" placeholder="筛选条目…" autoComplete="off"
                            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-text"
                            value={filterText} onChange={(e: any) => setFilterText(e.target.value)} />
                    </div>
                    <label className="check">
                        <input type="checkbox" checked={showValues} onChange={(e: any) => setShowValues(e.target.checked)} />
                        显示值
                    </label>
                    {/* Add Row rides the tab's doSave permission — adding a row is
                        meaningless without save rights, so no separate identifier. */}
                    {platform.checkTask('settings_Configuration Map', 'doSave') && (
                        <button type="button" className="btn" onClick={addRow}>
                            <span className="inline-flex" ref={(el: any) => { if (el && !el.firstChild) el.appendChild(icon('plus')); }} />添加行
                        </button>
                    )}
                </div>
            </div>
            <div className="panel-body flush">
                <div className="dt-wrap">
                    <table className="dt">
                        <thead><tr><th>键</th><th>值</th><th>注释</th><th className="w-10"></th></tr></thead>
                        <tbody>
                            {rows.map((row: any, i: any) => visibleIds.has(row._id) && (
                                <tr key={row._id}
                                    onContextMenu={(e: any) => {
                                        e.preventDefault();
                                        // Row edits ride doSave like the Add Row button (RBAC.md §3).
                                        contextMenu(e.clientX, e.clientY, [
                                            { label: '在上方插入行', icon: 'plus', task: 'doSave', group: 'settings_Configuration Map', onClick: () => insertAt(i) },
                                            { label: '在下方插入行', icon: 'plus', task: 'doSave', group: 'settings_Configuration Map', onClick: () => insertAt(i + 1) },
                                            '-',
                                            { label: '删除行', icon: 'trash', task: 'doSave', group: 'settings_Configuration Map', onClick: () => deleteAt(i) }
                                        ]);
                                    }}>
                                    <td><input type="text" value={row.key} onChange={(e: any) => patchRow(row._id, { key: e.target.value })} /></td>
                                    <td><input type={valueType} value={row.value} onChange={(e: any) => patchRow(row._id, { value: e.target.value })} /></td>
                                    <td><input type="text" value={row.comment} onChange={(e: any) => patchRow(row._id, { comment: e.target.value })} /></td>
                                    <td>
                                        <button type="button" className="icon-btn" title="移除行" onClick={() => deleteAt(i)}>
                                            <span className="inline-flex" ref={(el: any) => { if (el && !el.firstChild) el.appendChild(icon('trash')); }} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 ? (
                                <tr><td colSpan={4}><span className="text-text-faint">暂无配置映射条目</span></td></tr>
                            ) : shown === 0 ? (
                                <tr><td colSpan={4}><span className="text-text-faint">{`没有条目匹配“${filterText.trim().toLowerCase()}”`}</span></td></tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

/* =============================================================================
   Tab 4 — Database tasks
   DatabaseTask: { id, name, description, status (IDLE/RUNNING),
                   confirmationMessage, affectedChannels, startDateTime }
   ============================================================================ */

function DatabaseTasksTab({ ctx }: any) {
    const current = useSettingsSession();
    const [taskRows, setTaskRows] = useState<any>(null);   // null = loading
    const [selectedId, setSelectedId] = useState<any>(null);
    const [loadError, setLoadError] = useState<any>(null);
    const tableRef = useRef<any>(null);

    // Status-driven gating (Swing parity): Run only when no task is running;
    // Cancel only for the running task.
    const isRunning = (t: any) => String((t && t.status) || '').toUpperCase() === 'RUNNING';
    const anyRunning = () => (taskRowsNowRef.current || []).some(isRunning);
    const taskRowsNowRef = useRef(taskRows);
    taskRowsNowRef.current = taskRows;

    function normalize(raw: any) {
        const tasks: any[] = [];
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.entry !== undefined) {
            for (const e of api.asList(raw.entry)) {
                if (!e || typeof e !== 'object') continue;
                let task = e.databaseTask;
                if (task === undefined || task === null || typeof task !== 'object') {
                    for (const [k, v] of Object.entries(e)) {
                        if (k !== 'string' && v && typeof v === 'object') { task = v; break; }
                    }
                }
                if (task && typeof task === 'object') tasks.push(task);
            }
            return tasks;
        }
        return api.asList(raw, 'databaseTask').filter(t => t && typeof t === 'object');
    }

    async function load() {
        if (!current()) return;
        try {
            const tasks = await api.databaseTasks.list();
            if (!current()) return;
            setTaskRows(normalize(tasks));
            setLoadError(null);
        } catch (e: any) {
            if (!current()) return;
            toast(`加载数据库任务失败：${e.message}`, 'error');
            if (taskRowsNowRef.current === null) setLoadError(String(e.message || e));
        }
    }

    async function runTask(task: any) {
        if (!current()) return;
        if (!task) { toast('请先选择任务', 'warn'); return; }
        const message = task.confirmationMessage || `确定要运行 "${task.name}" 吗？此任务可能需要较长时间完成。`;
        if (await confirmDialog('运行数据库任务', message, { okLabel: '运行' })) {
            if (!current()) return;
            try {
                const result = await api.databaseTasks.run(task.id);
                if (!current()) return;
                toast(typeof result === 'string' && result ? result : '任务已启动');
            } catch (e: any) {
                if (!current()) return;
                toast(`运行失败：${e.message}`, 'error');
            }
            loadRef.current();
        }
    }

    async function cancelTask(task: any) {
        if (!current()) return;
        if (!task) { toast('请先选择任务', 'warn'); return; }
        if (!isRunning(task)) { toast(`任务 "${task.name}" 当前未运行。`, 'warn'); return; }
        try {
            await api.databaseTasks.cancel(task.id);
            if (!current()) return;
            toast('已请求取消');
        } catch (e: any) {
            if (!current()) return;
            toast(`取消失败：${e.message}`, 'error');
        }
        loadRef.current();
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const runRef = useRef(runTask);
    runRef.current = runTask;
    const cancelRef = useRef(cancelTask);
    cancelRef.current = cancelTask;

    // Table config is mount-captured by DataTableHost — callbacks route through refs.
    const columns = useRef([
        { key: 'name', label: '名称', render: (t: any) => t.name || '' },
        { key: 'description', label: '描述', render: (t: any) => t.description || '' },
        {
            key: 'status', label: '状态', width: '120px',
            render: (t: any) => {
                const running = String(t.status || '').toUpperCase() === 'RUNNING';
                return h('span.status-cell', h(`span.pip${running ? '.busy' : ''}`), running ? '运行中' : '空闲');
            }
        }
    ]).current;
    const options = useRef({
        selectable: 'single',
        rowKey: (t: any) => t.id,
        emptyText: '暂无数据库任务——引擎没有需要执行的清理工作',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-dbtasks',
        onSelect: (rows: any) => setSelectedId(rows[0] ? rows[0].id : null),
        onContextMenu: (row: any, e: any) => {
            setSelectedId(row.id);
            if (tableRef.current) { tableRef.current.selected = new Set([row.id]); tableRef.current.render(); }
            contextMenu(e.clientX, e.clientY, [
                { label: '运行任务', icon: 'play', hidden: anyRunning(), task: 'doRunDatabaseTask', group: 'settings_Database Tasks', onClick: () => runRef.current(row) },
                { label: '取消任务', icon: 'stop', danger: true, hidden: !isRunning(row), task: 'doCancelDatabaseTask', group: 'settings_Database Tasks', onClick: () => cancelRef.current(row) }
            ]);
        }
    }).current;

    useEffect(() => {
        loadRef.current();
    }, []);

    // Selection/status-gated task pane (no Save — this tab is read/run only).
    const selected = (taskRows || []).find((t: any) => t.id === selectedId) || null;
    useEffect(() => {
        ctx.setTasks('数据库任务', [
            taskButton('刷新', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Database Tasks' }),
            selected && !anyRunning() ? taskButton('运行任务', 'play', () => runRef.current(selected), { task: 'doRunDatabaseTask', group: 'settings_Database Tasks' }) : null,
            selected && isRunning(selected) ? taskButton('取消任务', 'stop', () => cancelRef.current(selected), { danger: true, task: 'doCancelDatabaseTask', group: 'settings_Database Tasks' }) : null
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, taskRows]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!taskRows) return <div className="loading-block"><div className="spinner" />加载中…</div>;

    return (
        <div className="panel"><div className="panel-body flush">
            <DataTableHost columns={columns} options={options} rows={taskRows}
                onReady={(t: any) => { tableRef.current = t; }} />
        </div></div>
    );
}

/* =============================================================================
   Tab 5 — Resources
   GET /server/resources returns a list of ResourceProperties subclasses. In
   XStream JSON the entries are keyed by class name (or carry '@class' in an
   array) — normalize to [{className, obj}] and rebuild the same container
   shape on save. DirectoryResourceProperties fields (verified):
   pluginPointName 'Directory Resource', type 'Directory', id, name,
   description, includeWithGlobalScripts, loadParentFirst, directory,
   directoryRecursion (the "include subdirectories" flag).
   Loaded libraries: GET /extensions/directoryresource/resources/{id}/libraries
   (verified in DirectoryResourceServletInterface.java).
   ============================================================================ */

function ResourcesTab({ ctx }: any) {
    const current = useSettingsSession();
    /* Edit-session model: [{ className, obj }] — resource objects are mutated
       in place (checkbox columns, the plugin detail editor) and the container
       identity bumps to repaint; save rebuilds the fetched container shape.
       The detail editor for each resource type comes from a registered
       ResourceClientPlugin (e.g. plugins/directoryresource) — rendered as a
       plain <PluginSlot> child now (no nested mountReact/teardown dance), with
       the SAME ctx contract: { entry, locked, platform, refreshTable }. */
    const [entries, setEntries] = useState<any>(null);        // null = loading
    const entriesNowRef = useRef(entries);
    entriesNowRef.current = entries;
    const containerIsArrayRef = useRef(false);           // round-trip the fetched container shape
    const [selectedId, setSelectedId] = useState<any>(null);
    const [loadError, setLoadError] = useState<any>(null);
    const tableRef = useRef<any>(null);

    const isDefault = (entry: any) => entry && entry.obj.id === 'Default Resource';
    const touch = () => setEntries((prev: any) => (prev ? prev.slice() : prev));

    function normalize(raw: any) {
        const next: any[] = [];
        containerIsArrayRef.current = Array.isArray(raw);
        if (containerIsArrayRef.current) {
            for (const obj of raw) {
                if (obj && typeof obj === 'object') next.push({ className: obj['@class'] || DIRECTORY_RESOURCE_CLASS, obj });
            }
        } else if (raw && typeof raw === 'object') {
            for (const [className, value] of Object.entries(raw)) {
                if (className.startsWith('@')) continue;
                for (const obj of api.asList(value)) {
                    if (obj && typeof obj === 'object') next.push({ className, obj });
                }
            }
        }
        return next;
    }

    function container() {
        const list = entriesNowRef.current || [];
        if (containerIsArrayRef.current) return list.map((e: any) => e.obj);
        const out: any = {};
        for (const e of list) {
            if (!out[e.className]) out[e.className] = [];
            out[e.className].push(e.obj);
        }
        return out;
    }

    async function load() {
        if (!current()) return;
        setLoadError(null);
        try {
            const resources = await api.server.resources();
            if (!current()) return;
            setEntries(normalize(resources));
            setSelectedId(null);
            tableRef.current?.clearSelection();
        } catch (e: any) {
            if (!current()) return;
            toast(`加载资源失败：${e.message}`, 'error');
            setLoadError(String(e.message || e));
        }
    }

    // Create a new resource of the (only, for now) registered type, then edit it
    // in the detail panel below — the type plugin supplies the factory + editor.
    function addResource() {
        const def = platform.resourceTypes()[0];
        if (!def || !def.create) { toast('未注册任何资源类型', 'warn'); return; }
        const list = entriesNowRef.current || [];
        const template = list.find((e: any) => e.obj && e.obj['@version']);
        const obj = def.create({ version: template ? template.obj['@version'] : undefined, containerIsArray: containerIsArrayRef.current });
        const entry = { className: def.propertiesClass || DIRECTORY_RESOURCE_CLASS, obj };
        setEntries((prev: any) => [...(prev || []), entry]);
        // Adding SELECTS the new resource everywhere — table highlight, detail
        // pane, and the selection-gated tasks (the legacy opened the detail
        // without selecting the row, leaving the task pane out of sync).
        setSelectedId(obj.id);
        if (tableRef.current) { tableRef.current.selected = new Set([obj.id]); tableRef.current.render(); }
        ctx.markDirty();
    }

    async function removeResource(entryArg: any) {
        if (!current()) return;
        const entry = entryArg || (entriesNowRef.current || []).find((e: any) => e.obj.id === selectedId) || null;
        if (!entry) { toast('请先选择资源', 'warn'); return; }
        if (isDefault(entry)) { toast('默认资源不能被移除', 'warn'); return; }
        if (await confirmDialog('移除资源', `确定要移除资源 "${entry.obj.name}" 吗？保存后生效。`, { danger: true, okLabel: '移除' })) {
            if (!current()) return;
            setEntries((prev: any) => prev.filter((e: any) => e !== entry));
            setSelectedId((prev: any) => (prev === entry.obj.id ? null : prev));
            ctx.markDirty();
        }
    }

    async function reloadResource(entryArg: any) {
        if (!current()) return;
        const entry = entryArg || (entriesNowRef.current || []).find((e: any) => e.obj.id === selectedId) || null;
        if (!entry) { toast('请先选择资源', 'warn'); return; }
        try {
            await api.server.reloadResource(entry.obj.id);
            if (!current()) return;
            toast(`已重新加载资源 "${entry.obj.name}"`);
        } catch (e: any) {
            if (!current()) return;
            toast(`重新加载失败：${e.message}`, 'error');
        }
    }

    function save() { return withEditorSave(saveUnlocked); }

    async function saveUnlocked() {
        if (!current()) return false;
        try {
            await api.server.setResources(container());
            if (!current()) return false;
            ctx.markClean();
            toast('资源已保存');
            await loadRef.current();
            return current();
        } catch (e: any) {
            if (!current()) return false;
            toast(`保存失败：${e.message}`, 'error');
            return false;
        }
    }

    const loadRef = useRef(load);
    loadRef.current = load;
    const saveRef = useRef(save);
    saveRef.current = save;
    const addRef = useRef(addResource);
    addRef.current = addResource;
    const removeRef = useRef(removeResource);
    removeRef.current = removeResource;
    const reloadRef = useRef(reloadResource);
    reloadRef.current = reloadResource;

    // Table config is mount-captured by DataTableHost — callbacks route through refs.
    const columns = useRef([
        { key: 'name', label: '名称', sortValue: (e: any) => e.obj.name, render: (e: any) => e.obj.name || '' },
        { key: 'type', label: '类型', width: '120px', sortValue: (e: any) => e.obj.type, render: (e: any) => e.obj.type || '' },
        {
            key: 'globalScripts', label: '全局脚本', width: '110px',
            sortValue: (e: any) => e.obj.includeWithGlobalScripts === true ? 1 : 0,
            render: (e: any) => h('input', {
                type: 'checkbox', checked: e.obj.includeWithGlobalScripts === true,
                onClick: (ev: any) => ev.stopPropagation(),
                onChange: (ev: any) => { e.obj.includeWithGlobalScripts = ev.target.checked; }
            })
        },
        {
            key: 'loadParentFirst', label: '父级优先加载', width: '130px',
            sortValue: (e: any) => e.obj.loadParentFirst === true ? 1 : 0,
            render: (e: any) => h('input', {
                type: 'checkbox', checked: e.obj.loadParentFirst === true,
                onClick: (ev: any) => ev.stopPropagation(),
                onChange: (ev: any) => { e.obj.loadParentFirst = ev.target.checked; }
            })
        }
    ]).current;
    const options = useRef({
        selectable: 'single',
        rowKey: (e: any) => e.obj.id,
        emptyText: '暂无资源',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-resources',
        onSelect: (rows: any) => setSelectedId(rows[0] ? rows[0].obj.id : null),
        onContextMenu: (row: any, e: any) => {
            setSelectedId(row.obj.id);
            if (tableRef.current) { tableRef.current.selected = new Set([row.obj.id]); tableRef.current.render(); }
            contextMenu(e.clientX, e.clientY, [
                { label: '添加资源', icon: 'plus', task: 'doAddResource', group: 'settings_Resources', onClick: () => addRef.current() },
                { label: '移除资源', icon: 'trash', danger: true, hidden: isDefault(row), task: 'doRemoveResource', group: 'settings_Resources', onClick: () => removeRef.current(row) },
                { label: '重新加载资源', icon: 'refresh', task: 'doReloadResource', group: 'settings_Resources', onClick: () => reloadRef.current(row) }
            ]);
        }
    }).current;

    useEffect(() => {
        ctx.setSave(() => saveRef.current());
        loadRef.current();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-gated task pane (the Default Resource cannot be removed).
    const selected = (entries || []).find((e: any) => e.obj.id === selectedId) || null;
    useEffect(() => {
        ctx.setTasks('资源任务', [
            taskButton('刷新', 'refresh', () => loadRef.current(), { task: 'doRefresh', group: 'settings_Resources' }),
            taskButton('保存', 'save', () => saveRef.current(), { primary: true, task: 'doSave', group: 'settings_Resources' }),
            taskButton('添加资源', 'plus', () => addRef.current(), { task: 'doAddResource', group: 'settings_Resources' }),
            selected && !isDefault(selected) ? taskButton('移除资源', 'trash', () => removeRef.current(selected), { danger: true, task: 'doRemoveResource', group: 'settings_Resources' }) : null,
            selected ? taskButton('重新加载资源', 'refresh', () => reloadRef.current(selected), { task: 'doReloadResource', group: 'settings_Resources' }) : null
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, entries]);

    if (loadError) return <TabLoadFailed error={loadError} />;
    if (!entries) return <div className="loading-block"><div className="spinner" />加载中…</div>;

    const types = platform.resourceTypes();
    const detailDef = selected ? (types.find(t => t.type === selected.obj.type) || types[0]) : null;

    return (
        <>
            <div className="panel"><div className="panel-body flush">
                <DataTableHost columns={columns} options={options} rows={entries}
                    onReady={(t: any) => { tableRef.current = t; }} />
            </div></div>
            <div className="panel">
                <div className="panel-header">{(types[0] || {}).detailHeader || '资源设置'}</div>
                <div className="panel-body">
                    {!selected ? (
                        <div className="text-text-faint">请在上方选择资源以编辑其设置</div>
                    ) : detailDef && (detailDef as any).component ? (
                        <PluginSlot key={selected.obj.id} def={detailDef} ctx={{
                            entry: selected, locked: isDefault(selected), platform,
                            refreshTable: () => touch()
                        }} />
                    ) : (
                        <div className="text-text-faint">{`资源类型“${selected.obj.type || '?'}”未注册编辑器`}</div>
                    )}
                </div>
            </div>
        </>
    );
}

/* =============================================================================
   View shell — React tabs + per-tab task pane via <ViewTasks>
   Each tab BODY is a React component mounted via reactTab() (the same wrapper
   plugin panels use); it declares its task pane by calling setTasks(title,
   items) with DOM taskButton items — the one task-pane contract shared with
   plugin panels. The active tab's taskbar DOM is portaled into the rail
   through <RailPane> + <ViewTasks>, with the pane title following the active
   tab — switching tabs swaps the pane (and title) reactively, no route change.
   Only the active tab is mounted; re-activating a tab reloads it.
   ============================================================================ */

const BUILTIN_TABS = [
    { label: 'Server', render: (ctx: any) => reactTab(ctx, ServerTab) },
    { label: 'Administrator', render: (ctx: any) => reactTab(ctx, AdministratorTab) },
    { label: 'Tags', render: (ctx: any) => reactTab(ctx, TagsTab) },
    { label: 'Configuration Map', render: (ctx: any) => reactTab(ctx, ConfigurationMapTab) },
    { label: 'Database Tasks', render: (ctx: any) => reactTab(ctx, DatabaseTasksTab) },
    { label: 'Resources', render: (ctx: any) => reactTab(ctx, ResourcesTab) }
    // Data Pruner is a settings-panel plugin (plugins/datapruner), appended
    // below via platform.settingsPanels().
];

/* Display-only captions. The tab label doubles as the RBAC group key
   (`settings_<label>`) and the /settings?tab= deep-link key, so BUILTIN_TABS
   stays English and only the rendered caption is localised. Unknown labels
   (plugin panels) fall back to their own label. */
const TAB_LABELS_ZH: any = {
    Server: '服务器',
    Administrator: '管理员',
    Tags: '标签',
    'Configuration Map': '配置映射',
    'Database Tasks': '数据库任务',
    Resources: '资源',
    'Data Pruner': '数据修剪器'
};

// Build the full tab list once: built-ins + plugin-contributed settings panels
// (Data Pruner). A plugin panel renders into the tab host via panel.render(host,
// ctx); if it returns a detached Node, append it (matching the vanilla shell).
function buildTabDefs(plat: any) {
    // Hide a tab only when RBAC denies BOTH its doRefresh and its doSave — a
    // view-only holder (e.g. View Roles without Manage Roles) keeps the tab
    // read-only, exactly like Swing. Gating on doSave alone hid the RBAC tab
    // from everyone but Manage Roles holders, which locked viewers out entirely
    // (and made a missing is_admin assignment look like a permissions
    // chicken-and-egg).
    const visible = (label: string) => {
        const taskGroup = `settings_${label}`;
        return plat.checkTask(taskGroup, 'doRefresh') || plat.checkTask(taskGroup, 'doSave');
    };
    // The SAME gate for the built-in tabs. They were appended unconditionally,
    // so a role without viewServerSettings still got a Server tab whose first
    // request answered "Missing permission: viewServerSettings" in an error
    // dialog. The engine gates per tab, and the RBAC plugin already maps every
    // built-in tab's tasks (settings_Server/doRefresh → viewServerSettings,
    // settings_Tags/doRefresh → viewTags, …); only Administrator is deliberately
    // unmapped, because it reads and writes the current user's own preferences.
    const defs = BUILTIN_TABS.filter((tab) => visible(tab.label));
    for (const panel of plat.settingsPanels()) {
        // A plugin can publish group-prefixed doRefresh/doSave tasks through an
        // ExtensionPermission.
        if (!visible(panel.label)) continue;
        defs.push({
            label: panel.label,
            render: (ctx: any) => {
                const tabHostEl = tabHost();
                ctx.setTasks(`${TAB_LABELS_ZH[panel.label] || panel.label} 任务`, []);   // initial pane; the panel calls setTasks itself
                // Host the panel's React component; teardown is tracked on the
                // node so SettingsTab can unmount the root on tab switch.
                (tabHostEl as any).__teardown = mountReact(tabHostEl, <PluginSlot def={panel} ctx={ctx} />);
                return tabHostEl;
            }
        });
    }
    return defs;
}

/* Save/Discard/Cancel prompt for unsaved settings changes (Swing parity).
   Users whose role can't save the tab (settings_<Tab>/doSave denied) must not
   be offered a Save the server would reject — OK-only notice instead. */
function promptSaveSettings(canSave?: any) {
    return new Promise((resolve: any) => {
        if (canSave === false) {
            modal({
                title: '未保存的更改',
                body: h('div', '您没有保存此设置页的权限，更改将被丢弃。'),
                onClose: () => resolve('cancel'),
                buttons: [{ label: '确定', primary: true, onClick: () => resolve('discard') }]
            });
            return;
        }
        modal({
            title: '未保存的更改',
            body: h('div', '此设置页有未保存的更改，是否保存？'),
            onClose: () => resolve('cancel'),
            buttons: [
                { label: '取消', onClick: () => resolve('cancel') },
                { label: '不保存', danger: true, onClick: () => resolve('discard') },
                { label: '保存更改', primary: true, onClick: () => resolve('save') }
            ]
        });
    });
}

// Mounts the active tab's legacy builder once and tracks its declared task pane.
// The builder's setTasks(title, items) writes into tasksRef; notify() forces a
// re-render so the portaled <RailPane> reflects the new title + buttons.
function SettingsTab({ def, ctx }: any) {
    const ref = useRef<any>(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.replaceChildren();
        ctx.setSave(null);               // reset; the builder re-registers its own save
        const node = def.render(ctx);
        if (node instanceof Node && node !== host) host.appendChild(node);
        ctx.markClean();                 // a freshly built tab starts clean
        // Any user edit marks the tab dirty. Programmatic value sets during the
        // builder's load() don't dispatch input/change, so they don't false-trip.
        const onEdit = () => ctx.markDirty();
        host.addEventListener('input', onEdit);
        host.addEventListener('change', onEdit);
        return () => {
            host.removeEventListener('input', onEdit);
            host.removeEventListener('change', onEdit);
            if (node && node.__teardown) node.__teardown();
            host.replaceChildren();
        };
        // Build once per tab activation (keyed by label in the parent); the
        // legacy builder owns its own load()/setTasks() lifecycle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Hand the task-pane host back so the parent can portal its taskbar DOM.
    return <div ref={ref} className="flex flex-col flex-1 min-h-0" />;
}

// Hosts the legacy taskbar DOM (built by the active tab via setTasks) inside the
// rail. Rebuilds the .taskbar children whenever the tab's task spec changes.
// Extra props pass through to the RailPane: ViewTasks clones its children with
// the column-collapse wiring (`flat`, and the hide chevron as `headerExtra`),
// and a wrapper that swallowed them left Settings the one view that couldn't
// collapse its task pane.
function TasksPane({ title, items, ...paneProps }: any) {
    const ref = useRef<any>(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.replaceChildren();
        const bar = h('div.taskbar', { 'data-pane-title': title });
        for (const item of items) {
            if (item === '-') bar.appendChild(h('span.sep'));
            else if (item) bar.appendChild(item);
        }
        host.appendChild(bar);
        return () => host.replaceChildren();
    }, [title, items]);
    return (
        <RailPane title={title} paneKey={'tasks:' + title} {...paneProps}>
            <div ref={ref} className="[display:contents]" />
        </RailPane>
    );
}

export function SettingsView({ query }: any) {
    // Tab defs (built-ins + plugin panels) are stable for the view's lifetime.
    const [defs] = useState(() => buildTabDefs(platform));

    // Deep-link: /settings?tab=<label> opens that tab (e.g. the account menu's
    // "Settings" → Administrator preferences). Unknown/absent → the first tab
    // this role can see (Server for an administrator).
    const [active, setActive] = useState(() => {
        const want = String(query?.tab || '').trim().toLowerCase();
        const i = want ? defs.findIndex((d: any) => d.label.toLowerCase() === want) : -1;
        return i >= 0 ? i : 0;
    });
    const [dirty, setDirtyState] = useState(false);   // drives the unsaved-tab indicator
    const [, force] = useReducer((x: any) => x + 1, 0);
    // The active tab's declared task pane (title + legacy DOM items).
    const tasksRef = useRef({ title: '服务器任务', items: [] });
    const dirtyRef = useRef(false);
    useEffect(() => registerUnsavedCheck(() => dirtyRef.current), []);
    const saveRef = useRef<any>(null);   // the active tab's save(), if it supports saving
    const activeLabelRef = useRef<any>(null);   // active tab label, for its settings_<Tab> RBAC group

    // setTasks is what each legacy builder calls; it captures the task spec and
    // forces a re-render of the portaled pane. ctx mirrors the vanilla shell ctx,
    // plus dirty-tracking hooks (markDirty/markClean/setSave) used by the tabs.
    const [ctx] = useState(() => {
        // When dirty, install a route-leave guard that prompts to save/discard.
        function refreshGuard() {
            if (dirtyRef.current) {
                setState('navGuard', async () => {
                    const choice = await promptSaveSettings(
                        platform.checkTask(`settings_${activeLabelRef.current}`, 'doSave'));
                    if (choice === 'cancel') return false;
                    if (choice === 'save' && saveRef.current && (await saveRef.current()) === false) return false;
                    setClean();
                });
            } else {
                setState('navGuard', null);
            }
        }
        function setDirty() {
            // Only tabs that registered a save() participate in dirty tracking.
            if (!saveRef.current || dirtyRef.current) return;
            dirtyRef.current = true; setDirtyState(true); refreshGuard();
        }
        function setClean() {
            dirtyRef.current = false; setDirtyState(false); setState('navGuard', null);
        }
        return {
            platform,
            setTasks(title: any, items: any) { tasksRef.current = { title, items }; force(); },
            markDirty: setDirty,
            markClean: setClean,
            setSave(fn: any) { saveRef.current = fn || null; }
        };
    });

    const def = defs[active] || defs[0];

    /* Tab-switch guard: prompt if the current tab has unsaved changes.

       Re-entrancy matters. Radix's automatic activation proposes a value on FOCUS
       and again on CLICK, and while the prompt is open `active` deliberately has not
       moved — so the second event proposes the same switch and would open a second
       dialog. (A fast double-click could have done the same before Radix.) One
       pending prompt at a time. */
    const switchingRef = useRef(false);
    async function requestTab(i: any) {
        if (i === active || switchingRef.current) return;
        switchingRef.current = true;
        try {
            await performTabSwitch(i);
        } finally {
            switchingRef.current = false;
        }
    }

    async function performTabSwitch(i: any) {
        if (dirtyRef.current) {
            const choice = await promptSaveSettings(
                platform.checkTask(`settings_${activeLabelRef.current}`, 'doSave'));
            if (choice === 'cancel') return;
            if (choice === 'save' && saveRef.current && (await saveRef.current()) === false) return;
        }
        ctx.markClean();
        setActive(i);
    }

    // Radix Tabs is CONTROLLED here: onValueChange only proposes. requestTab may
    // refuse (the unsaved-changes prompt), and because `active` is ours the value
    // simply stays where it was — no fighting the component.

    // Clear the task spec the instant the active tab changes, so the pane never
    // shows the previous tab's buttons during the window before the new tab's
    // builder calls setTasks (which it does synchronously in its mount effect).
    const shownRef = useRef(active);
    if (shownRef.current !== active) {
        shownRef.current = active;
        tasksRef.current = { title: `${TAB_LABELS_ZH[def.label] || def.label} 任务`, items: [] };
    }
    activeLabelRef.current = def.label;

    // Drop the leave-guard when the settings view itself unmounts.
    useEffect(() => () => { setState('navGuard', null); }, []);

    const { title, items } = tasksRef.current;

    return (
        <div className="view">
            <ViewTasks>
                <TasksPane title={title} items={items} />
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                <TabsPrimitive.Root value={String(active)}
                    onValueChange={(v: any) => requestTab(Number(v))}
                    className="tabs-wrap flex flex-col flex-1 min-h-0 overflow-hidden">
                    <TabsPrimitive.List className="tabs" aria-label="设置分区">
                        {defs.map((d: any, i: any) => (
                            <TabsPrimitive.Trigger key={d.label} value={String(i)}
                                className={'tab' + (i === active ? ' active' : '')}>
                                {TAB_LABELS_ZH[d.label] || d.label}{i === active && dirty ? ' ●' : ''}
                            </TabsPrimitive.Trigger>
                        ))}
                    </TabsPrimitive.List>
                    <TabsPrimitive.Content value={String(active)} className="tab-body flex flex-col flex-1 min-h-0">
                        {/* Only the active tab is mounted; keyed by label so switching
                            tabs remounts (and reloads) it, matching vanilla tabs(). */}
                        <SettingsTab key={def.label} def={def} ctx={ctx} />
                    </TabsPrimitive.Content>
                </TabsPrimitive.Root>
            </div>
        </div>
    );
}
