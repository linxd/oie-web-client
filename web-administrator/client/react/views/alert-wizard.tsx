import { withEditorSave } from '../save-lock.js';
/*
 * Guided Alert builder — a step-by-step alternative to the classic alert editor,
 * modeled on the channel wizard (chevron stepper, validate-on-advance, prompt on
 * leave, Review with Save). It produces the exact same alert model as newAlert()
 * (from alert-editor.jsx), so create/update/enable are unchanged.
 *
 * Steps: Basics → Trigger → Channels → Actions → Review. First pass: channel-level
 * selection (whole channels), not per-connector granularity — that stays in the
 * classic editor's channel tree.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import api from '@oie/web-api';
import { alertBaseline, loadAlertForEdit, confirmIfAlertChanged } from '../alert-conflict.js';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { useInvalidate } from '../queries.js';
import { toast, saveFile } from '@oie/web-ui';
import * as store from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import * as router from '../../core/router.js';
import { Icon } from '../bridges.jsx';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { platform } from '@oie/web-shell';
import { getPref } from '../../core/prefs.js';
import { useWizardModel, useWizardSteps, useLeaveGuard, WizardStepper, WizardHeader } from './wizard-frame.jsx';
import {
    newAlert, ERROR_EVENT_TYPES, ALERT_VARIABLES, eventTypeLabel, protocolsOf, recipientOptionsOf
} from './alert-editor.jsx';

const STEPS = ['Basics', 'Trigger', 'Channels', 'Actions', 'Review'];

/* Display-only captions for the stepper (STEPS above are compared in code and
   stay engine-facing identifiers). */
const STEP_LABELS = ['基本信息', '触发条件', '通道', '操作', '确认'];

// Normalize the action group list to an array with at least one group.
function normalizeActionGroups(a: any) {
    const ag = a.actionGroups = a.actionGroups || {};
    let groups = api.asList(ag.alertActionGroup);
    if (!groups.length) groups = [{ actions: null, subject: '', template: '' }];
    ag.alertActionGroup = groups;
    return a;
}

// Loader: resolve the alert to edit (see wizard-frame's useWizardModel), then
// render the wizard. /alerts/new/guided creates; /alerts/:alertId/guided edits.
function AlertWizardView({ params }: any) {
    const version = store.getState('serverVersion') || '4.5.2';
    const { model, isNew, ready } = useWizardModel({
        routeId: params && params.alertId,
        storeKey: 'editingAlert',
        isValid: (a: any) => !!a.trigger,
        makeNew: () => newAlert('', version),
        fetch: loadAlertForEdit,
        normalize: normalizeActionGroups,
        backPath: '/alerts'
    });
    if (!ready || !model) return <div className="view"><div className="view-body"><div className="dt-empty">正在加载警报…</div></div></div>;
    return <AlertWizardInner key={model.id || 'new'} alert={model} isNew={isNew} />;
}

function AlertWizardInner({ alert, isNew }: any) {
    const baselineRef = useRef(alertBaseline(alert));
    useEffect(() => {
        // Tab-close guard: the wizard's dirty flag, synchronous (core/unsaved.js).
        return registerUnsavedCheck(() => dirtyRef.current);
    }, []);
    const [, forceRender] = useReducer((x: any) => x + 1, 0);
    const switchingRef = useRef(false);
    const focusedRef = useRef('template');   // which text field a clicked variable inserts into
    const grp = alert.actionGroups.alertActionGroup[0];

    const dirtyRef = useRef(store.getState('editingAlertDirty') === true);
    const savedRef = useRef(false);
    const bump = () => { dirtyRef.current = true; store.setState('editingAlertDirty', true); forceRender(); };

    const invalidate = useInvalidate();   // the list's ['alerts'] cache — see saveAlert()
    const { step, setStep, maxStep, goStep } = useWizardSteps(isNew, STEPS.length);
    const [nameTouched, setNameTouched] = useState(!isNew);   // don't flag a blank name until touched
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState<any>({ channels: [], protocols: [], recipients: {} });
    const [dataError, setDataError] = useState<string | null>(null);
    const [chFilter, setChFilter] = useState('');

    useEffect(() => {
        let alive = true;
        Promise.allSettled([api.channels.idsAndNames(), api.alerts.options()]).then(([channelResult, optionResult]) => {
            if (!alive) return;
            const ch = channelResult.status === 'fulfilled' ? channelResult.value : null;
            const opts = optionResult.status === 'fulfilled' ? optionResult.value : null;
            const channels: any[] = [];
            for (const en of api.asList(ch && ch.entry)) {
                const p = api.asList(en && en.string);
                if (p.length >= 2) channels.push({ id: String(p[0]), name: String(p[1]) });
            }
            channels.sort((a: any, b: any) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
            setData({ channels, protocols: protocolsOf(opts), recipients: recipientOptionsOf(opts) });
            const failures = [channelResult, optionResult]
                .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
                .map(result => String(result.reason?.message || result.reason));
            const message = failures.join('; ');
            setDataError(message || null);
            if (message) toast(`加载警报选项失败：${message}`, 'error');
        });
        return () => { alive = false; };
    }, []);

    // Keep the model in the store + prompt-on-leave (shared with the channel wizard).
    useLeaveGuard({
        model: alert, isNew, storeKey: 'editingAlert', storeNewKey: 'editingAlertNew',
        entityLabel: '警报', dirtyKey: 'editingAlertDirty', dirtyRef, savedRef, switchingRef, save: () => saveAlert(false),
        canSave: () => platform.checkTask('alertEdit', 'doSaveAlerts')
    });
    const canSave = platform.checkTask('alertEdit', 'doSaveAlerts');

    /* ---- model helpers ---- */
    const trigger = alert.trigger;
    const ac = trigger.alertChannels = trigger.alertChannels || {};
    const errTypes = new Set(api.asList(trigger.errorEventTypes && trigger.errorEventTypes.errorEventType).map(String));
    const setErrType = (t: any, on: any) => {
        if (on) errTypes.add(t); else errTypes.delete(t);
        trigger.errorEventTypes = errTypes.size ? { errorEventType: [...errTypes] } : null;
        bump();
    };
    const enabledChannels = new Set(api.asList(ac.enabledChannels && ac.enabledChannels.string).map(String));
    const setChannel = (id: any, on: any) => {
        if (on) enabledChannels.add(id); else enabledChannels.delete(id);
        ac.enabledChannels = enabledChannels.size ? { string: [...enabledChannels] } : null;
        bump();
    };

    const actionList = () => api.asList(grp.actions, 'alertAction').filter((a: any) => a && typeof a === 'object');
    const setActions = (list: any) => { grp.actions = list.length ? { alertAction: list } : null; bump(); };
    const defaultProtocol = () => data.protocols[0] || 'Email';
    const addAction = () => setActions([...actionList(), { protocol: defaultProtocol(), recipient: '' }]);
    const patchAction = (i: any, patch: any) => setActions(actionList().map((a: any, idx: any) => (idx === i ? { ...a, ...patch } : a)));
    const removeAction = (i: any) => setActions(actionList().filter((_, idx) => idx !== i));

    const insertVar = (v: any) => {
        const key = focusedRef.current === 'subject' ? 'subject' : 'template';
        grp[key] = `${grp[key] || ''}\${${v}}`;
        bump();
    };

    // Recipients are stored by id; show the friendly name (channel/user) in the summary.
    const recipientLabel = (protocol: any, rid: any) => {
        const opts = (data.recipients as any)[protocol];
        if (Array.isArray(opts)) { const o = opts.find((x: any) => x.value === rid); return o ? o.label : rid; }
        return rid;
    };
    const enabledNames = [...enabledChannels].map((id: any) => ((data.channels.find((c: any) => c.id === id) || {}) as any).name || id);

    /* ---- validation ---- */
    // Alert filters use java.util.regex.Pattern in the engine. Browser RegExp
    // rejects valid Java syntax (e.g. inline flags); match the classic/Swing path.
    function nameError() { return String(alert.name || '').trim() ? null : '请填写警报名称'; }
    function stepProblems(i: any) {
        if (STEPS[i] === 'Basics') return nameError() ? [nameError()] : [];
        return [];
    }
    function allProblems() {
        return [nameError()].filter(Boolean);
    }
    function firstProblemStep() {
        for (let i = 0; i < STEPS.length; i++) if (stepProblems(i).length) return i;
        return -1;
    }
    // Non-blocking heads-ups (an inert alert is still a valid draft, like the classic editor).
    function warnings() {
        const out: any[] = [];
        if (!enabledChannels.size && !ac.newChannelSource && !ac.newChannelDestination) out.push('未选择通道，该警报不会触发');
        if (!actionList().length) out.push('未配置操作，该警报不会通知任何人');
        else if (actionList().some((a: any) => !String(a.recipient || '').trim())) out.push('有操作未填写接收者');
        return out;
    }

    /* ---- navigation + save ---- */
    function tryNext() {
        const probs = stepProblems(step);
        if (probs.length) { toast(probs.join('  ·  '), 'warn'); return; }
        goStep(step + 1);
    }

    function saveAlert(enable: any) { return withEditorSave(() => saveAlertUnlocked(enable)); }

    async function saveAlertUnlocked(enable: any) {
        const probs = allProblems();
        if (probs.length) { const s = firstProblemStep(); if (s >= 0) setStep(s); toast(probs.join('  ·  '), 'warn'); return false; }
        if (enable && !alert.enabled) { alert.enabled = true; bump(); }
        try {
            if (isNew) {
                await api.alerts.create(alert);
            } else {
                if (!await confirmIfAlertChanged(alert.id, baselineRef.current)) return false;
                await api.alerts.update(alert.id, alert);
            }
            // The list caches ['alerts'] for 30s and outlives this view, so without
            // this the alerts list repaints its pre-save rows on the way back.
            await invalidate('alerts');
            savedRef.current = true;
            dirtyRef.current = false;
            return true;
        } catch (e: any) {
            toast(e && e.message ? e.message : '无法保存该警报', 'error');
            return false;
        }
    }
    async function finish(enable: any) {
        if (saving || store.getState('editorSave')) return;
        setSaving(true);
        const ok = await saveAlert(enable);
        if (!ok) { setSaving(false); return; }
        store.setState('navGuard', null);
        toast(`警报“${alert.name}”${isNew ? '已创建' : '已保存'}${enable ? '并已启用' : ''}`, 'info');
        router.navigate('/alerts');
    }
    function switchToClassic() {
        switchingRef.current = true;
        store.setState('editingAlert', alert);
        store.setState('editingAlertNew', isNew);
        store.setState('navGuard', null);
        router.navigate(`/alerts/${alert.id}/edit${isNew ? '?new=1' : ''}`);
    }
    async function exportAlert() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        if (isNew) { toast('请先保存警报，再执行导出', 'warn'); return; }
        try {
            await saveFile(`${alert.name || alert.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${alert.id}`);
                if (!xml || !String(xml).trim()) throw new Error('服务器上未找到该警报，请先保存');
                return xml;
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`导出失败：${e.message}`, 'error');
        }
    }

    const isLast = step === STEPS.length - 1;
    const stepName = STEPS[step];
    const channels = data.channels.filter((c: any) => !chFilter.trim() || c.name.toLowerCase().includes(chFilter.trim().toLowerCase()));
    const nErr = step === 0 && nameTouched ? nameError() : null;

    return (
        <div className="view">
            {/* Alert Tasks rail — mirrors the classic alert editor's tasks, plus the
                view switch (like the Dashboard's Card/Table toggle). */}
            <ViewTasks>
                <RailPane title="警报任务" paneKey="tasks:Alert Tasks" group="alertEdit">
                    <div className="taskbar" data-pane-title="Alert Tasks">
                        {getPref('showViewSwitch') !== false && <TaskButton label="经典编辑器" icon="edit" onClick={switchToClassic} />}
                        {/* A NEW alert is still being built (create lives in the footer); an
                            EXISTING alert adds Save (when dirty). */}
                        {!isNew && dirtyRef.current && <TaskButton label="保存警报" icon="save" primary task="doSaveAlerts" onClick={() => finish(false)} />}
                        {!isNew && <TaskButton label="导出警报" icon="export" task="doExportAlert" onClick={exportAlert} />}
                        <TaskButton label="返回警报列表" icon="logout" onClick={() => router.navigate('/alerts')} />
                    </div>
                </RailPane>
            </ViewTasks>
            <WizardHeader icon="alerts" title={isNew ? '新建警报 — 向导' : `${alert.name || '警报'} — 向导`} />
            <WizardStepper steps={STEP_LABELS} step={step} maxStep={maxStep} onStep={setStep} />

            <div className="view-body overflow-x-hidden">
                {dataError && <div className="panel border-danger text-danger max-w-[738px]" role="alert">
                    无法加载通道与接收者选项：{dataError}
                </div>}
                <div className="wiz-pane" key={step}>
                    {/* ---- Basics ---- */}
                    {stepName === 'Basics' && (
                        <div className="panel !mt-0 max-w-[576px]">
                            <div className="panel-body flex flex-col gap-4">
                                <label className="flex flex-col gap-1">
                                    <span className="text-text-dim">警报名称</span>
                                    <input autoFocus type="text" className={`w-full ${nErr ? 'cform-invalid' : ''}`} value={alert.name}
                                        placeholder="我的警报" onChange={(e: any) => { alert.name = e.target.value; setNameTouched(true); bump(); }} />
                                    {nErr ? <span className="text-err text-[10px]">{nErr}</span> : null}
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={alert.enabled === true} onChange={(e: any) => { alert.enabled = e.target.checked; bump(); }} />
                                    已启用
                                </label>
                                <div className="hint">警报会监视您选定通道上的错误，并通过您配置的操作发送通知。</div>
                            </div>
                        </div>
                    )}

                    {/* ---- Trigger ---- */}
                    {stepName === 'Trigger' && (
                        <div className="flex flex-col gap-4 max-w-[648px]">
                            <div className="panel !mt-0">
                                <div className="panel-header">错误类型</div>
                                <div className="panel-body grid sm:grid-cols-2 gap-x-6 gap-y-2">
                                    {ERROR_EVENT_TYPES.map((t: any) => (
                                        <label key={t} className="flex items-center gap-2">
                                            <input type="checkbox" checked={errTypes.has(t)} onChange={(e: any) => setErrType(t, e.target.checked)} />
                                            {eventTypeLabel(t)}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="panel !mt-0">
                                <div className="panel-header">错误消息筛选</div>
                                <div className="panel-body flex flex-col gap-1">
                                    <textarea className="w-full" rows={3} value={trigger.regex || ''}
                                        placeholder="仅当错误匹配此正则表达式时触发（留空则匹配任意错误）"
                                        onChange={(e: any) => { trigger.regex = e.target.value; bump(); }} />
                                    <span className="text-text-dim text-[10px]">使用 Java 正则表达式语法，与桌面管理员一致。</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- Channels ---- */}
                    {stepName === 'Channels' && (
                        <div className="panel !mt-0 max-w-[648px]">
                            <div className="panel-header">要监视的通道</div>
                            <div className="panel-body flex flex-col gap-2">
                                {data.channels.length > 6 && <input type="text" placeholder="筛选通道…" value={chFilter} onChange={(e: any) => setChFilter(e.target.value)} />}
                                <div className="flex flex-col border border-line rounded-md max-h-[288px] overflow-auto divide-y divide-line">
                                    {channels.length === 0 && <div className="p-2 text-text-faint text-[11px]">无通道</div>}
                                    {channels.map((c: any) => (
                                        <label key={c.id} className="flex items-center gap-2 px-2.5 py-2 hover:bg-bg1 cursor-pointer" title={c.name}>
                                            <input type="checkbox" checked={enabledChannels.has(c.id)} onChange={(e: any) => setChannel(c.id, e.target.checked)} />
                                            <span className="truncate">{c.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={ac.newChannelSource === true} onChange={(e: any) => { ac.newChannelSource = e.target.checked; bump(); }} />应用于新通道的源</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={ac.newChannelDestination === true} onChange={(e: any) => { ac.newChannelDestination = e.target.checked; bump(); }} />应用于新通道的目的地</label>
                                </div>
                                <div className="hint">选择此警报要监视的通道。按连接器细分请在经典编辑器中设置。</div>
                            </div>
                        </div>
                    )}

                    {/* ---- Actions ---- */}
                    {stepName === 'Actions' && (
                        <div className="flex flex-col gap-4 max-w-[738px]">
                            <div className="panel !mt-0">
                                <div className="panel-header">通知</div>
                                <div className="panel-body flex flex-col gap-2">
                                    {actionList().length === 0 && <div className="hint">尚未添加操作，警报触发时不会发送通知。</div>}
                                    {actionList().length > 0 && (
                                        <div className="flex items-center gap-2 px-0.5 text-[10px] uppercase tracking-wide text-text-faint">
                                            <span className="w-[144px] flex-none">协议</span><span className="flex-1">接收者</span><span className="w-[27px] flex-none" />
                                        </div>
                                    )}
                                    {actionList().map((a: any, i: any) => {
                                        const opts = (data.recipients as any)[a.protocol];
                                        return (
                                            <div key={i} className="flex items-center gap-2">
                                                <select className="w-[144px] flex-none" value={a.protocol} onChange={(e: any) => patchAction(i, { protocol: e.target.value, recipient: '' })}>
                                                    {data.protocols.map((p: any) => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                                {Array.isArray(opts) ? (
                                                    <select className="flex-1 min-w-0" value={a.recipient || ''} onChange={(e: any) => patchAction(i, { recipient: e.target.value })}>
                                                        <option value="">请选择…</option>
                                                        {opts.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                    </select>
                                                ) : (
                                                    <input type="text" className="flex-1 min-w-0" placeholder="接收者（如 name@example.com）" value={a.recipient || ''} onChange={(e: any) => patchAction(i, { recipient: e.target.value })} />
                                                )}
                                                <button type="button" className="btn btn-sm btn-danger w-[27px] flex-none justify-center" onClick={() => removeAction(i)}><Icon name="trash" size={13} /></button>
                                            </div>
                                        );
                                    })}
                                    <div><button type="button" className="btn btn-sm" onClick={addAction}><Icon name="plus" size={13} />添加操作</button></div>
                                </div>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-4">
                                <div className="panel !mt-0 flex-1 min-w-0">
                                    <div className="panel-header">消息</div>
                                    <div className="panel-body flex flex-col gap-3">
                                        <label className="flex flex-col gap-1">
                                            <span className="text-text-dim text-[11px]">主题</span>
                                            <input type="text" className="w-full" value={grp.subject || ''} onFocus={() => { focusedRef.current = 'subject'; }} onChange={(e: any) => { grp.subject = e.target.value; bump(); }} />
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-text-dim text-[11px]">模板</span>
                                            <textarea className="w-full" rows={8} value={grp.template || ''} onFocus={() => { focusedRef.current = 'template'; }} onChange={(e: any) => { grp.template = e.target.value; bump(); }} />
                                        </label>
                                    </div>
                                </div>
                                <div className="panel !mt-0 w-full lg:w-[216px] flex-none">
                                    <div className="panel-header">变量</div>
                                    <div className="panel-body flex flex-col gap-2">
                                        <div className="border border-line rounded overflow-auto max-h-[324px] min-h-[108px]">
                                            {ALERT_VARIABLES.map((v: any) => (
                                                <div key={v} role="button" draggable
                                                    onDragStart={(e: any) => { e.dataTransfer.setData('text/plain', `\${${v}}`); e.dataTransfer.effectAllowed = 'copy'; }}
                                                    onClick={() => insertVar(v)}
                                                    className="step-item cursor-grab" title={`点击或拖动以插入 \${${v}}`}>
                                                    <div className="flex-1 min-w-0"><div className="truncate">{v}</div></div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="hint">点击插入到当前聚焦的字段，或拖动到主题/模板上。</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- Review ---- */}
                    {stepName === 'Review' && (
                        <div className="panel !mt-0 max-w-[738px]">
                            {warnings().length > 0 && (
                                <div className="panel-body pb-0">
                                    {warnings().map((w: any, i: any) => (
                                        <div key={i} className="flex items-center gap-2 text-[11px] text-amber"><Icon name="warning" size={13} />{w}</div>
                                    ))}
                                </div>
                            )}
                            <div className="panel-body">
                                {[
                                    ['名称', alert.name || <span className="text-err">（必填）</span>],
                                    ['已启用', alert.enabled ? '是' : '否'],
                                    ['错误类型', errTypes.size ? [...errTypes].map(eventTypeLabel).join(', ') : '无'],
                                    ['错误筛选', trigger.regex ? trigger.regex : '（任意错误）'],
                                    ['通道', enabledNames.length ? enabledNames.join(', ') : (ac.newChannelSource || ac.newChannelDestination ? '仅新通道' : '无')],
                                    ['操作', actionList().length ? actionList().map((a: any) => `${a.protocol} → ${recipientLabel(a.protocol, a.recipient) || '（无）'}`).join(', ') : '无'],
                                    ['主题', grp.subject ? grp.subject : '（无）'],
                                    ['模板', grp.template ? <pre className="whitespace-pre-wrap font-mono text-[11px] max-h-[144px] overflow-auto m-0">{grp.template}</pre> : '（无）']
                                ].map(([label, value]) => (
                                    <div key={label} className="flex gap-4 py-2 border-b border-line">
                                        <div className="w-[144px] flex-none text-text-dim">{label}</div>
                                        <div className="flex-1 min-w-0">{value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
                <button className="btn" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>上一步</button>
                <div className="ml-auto flex items-center gap-2">
                    {/* RBAC: save/create affordances hide without alertEdit/doSaveAlerts. */}
                    {!isLast ? (
                        <button className="btn btn-primary" disabled={stepName === 'Basics' && !!nameError()} onClick={tryNext}>下一步</button>
                    ) : isNew && canSave ? (
                        <>
                            <button className="btn" disabled={saving || !!nameError()} onClick={() => finish(false)}><Icon name="save" size={14} />{saving ? '正在创建…' : '创建警报'}</button>
                            <button className="btn btn-primary" disabled={saving || !!nameError()} onClick={() => finish(true)}><Icon name="check" size={14} />创建并启用</button>
                        </>
                    ) : !isNew && dirtyRef.current && canSave ? (
                        <button className="btn btn-primary" disabled={saving || !!nameError()} onClick={() => finish(false)}><Icon name="save" size={14} />{saving ? '正在保存…' : '保存警报'}</button>
                    ) : (
                        <button className="btn" onClick={() => router.navigate('/alerts')}><Icon name="x" size={14} />退出</button>
                    )}
                </div>
            </div>
        </div>
    );
}


export { AlertWizardView };
