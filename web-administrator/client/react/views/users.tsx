/*
 * Users view (React port of views/users.js). The grid wraps core/ui.js
 * DataTable via <DataTableHost>; the create/edit/password modals reuse the
 * imperative modal()/field()/textInput() helpers as-is (called from React
 * handlers); the task pane is React, portaled into the rail via <ViewTasks>.
 */

import { useState, useEffect, useRef } from 'react';
import { h, toast, confirmDialog, contextMenu, modal, fmtDate } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import { ViewTasks } from '../mount.jsx';
import { useUsers, useInvalidate } from '../queries.js';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import {
    USER_FIELDS, userForm, passwordFields, passwordViolations,
    openEditUserModal, openChangePasswordModal
} from './user-modals.js';
import { isSsoSelf } from '../sso-session.js';


const COLUMNS = [
    { key: 'username', label: '用户名', render: (u: any) => u.username || '' },
    { key: 'firstName', label: '名字', render: (u: any) => u.firstName || '' },
    { key: 'lastName', label: '姓氏', render: (u: any) => u.lastName || '' },
    { key: 'organization', label: '机构', render: (u: any) => u.organization || '' },
    { key: 'email', label: '电子邮箱', render: (u: any) => u.email || '' },
    { key: 'phoneNumber', label: '电话', render: (u: any) => u.phoneNumber || '' },
    {
        key: 'lastLogin', label: '上次登录', className: 'mono',
        sortValue: (u: any) => {
            const v = u.lastLogin;
            return typeof v === 'object' ? Number(v?.time ?? v?.timestamp ?? 0) : Number(v) || 0;
        },
        render: (u: any) => fmtDate(u.lastLogin)
    }
];

export function UsersView() {
    // Server state via TanStack Query — replaces the hand-rolled
    // useState + useEffect(list) + manual refetch. `refresh` now just invalidates
    // the cache (and clears selection, as the old imperative refresh did).
    const usersQuery = useUsers();
    const users = usersQuery.data ?? [];
    const [sel, setSel] = useState([] as any[]);
    const tableRef = useRef<any>(null);
    const invalidate = useInvalidate();

    // Surface load errors the way the old imperative refresh did (toast).
    useEffect(() => {
        if (usersQuery.error) toast(usersQuery.error.message, 'error');
    }, [usersQuery.error]);

    const refresh = () => { invalidate(['users']); setSel([]); };

    const single = () => (sel.length === 1 ? sel[0] : null);

    function newTask() {
        const form = userForm();
        const pw = passwordFields();
        const notice = h('p', { role: 'status', hidden: true });
        let phase: 'draft' | 'unknown' | 'unverified' | 'created' = 'draft';
        let busy = false;
        let createdId: string | number | undefined;
        let createdUsername = '';
        const dialog = modal({
            title: '新建用户',
            size: 'wide',
            body: h('div', notice, form.grid, pw.grid),
            buttons: [
                { label: '取消' },
                {
                    label: '创建', primary: true,
                    onClick: async () => {
                        if (busy || (phase !== 'draft' && phase !== 'created')) return false;
                        const username = createdUsername || form.inputs.username.value.trim();
                        if (!username) { toast('请填写用户名', 'warn'); return false; }
                        if (!pw.validate()) return false;
                        const password = (pw.password as HTMLInputElement).value;
                        const user: any = {};
                        for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                        user.username = username;
                        busy = true;
                        form.grid.inert = pw.grid.inert = true;
                        const submit = dialog.el.querySelector<HTMLButtonElement>('.modal-foot .btn-primary');
                        if (submit) { submit.disabled = true; submit.textContent = '保存中…'; }
                        try {
                            // Enforce the password policy BEFORE creating the user
                            // (Swing checks first) — otherwise a rejected password
                            // leaves a passwordless user behind and the requirement
                            // is effectively ignored.
                            const violations = passwordViolations(await api.users.checkPassword(password));
                            if (violations.length) { toast(`密码未通过校验：${violations.join('; ')}`, 'warn'); return false; }

                            if (phase === 'draft') {
                                createdUsername = username;
                                // A failed response does not prove the write failed. Do
                                // not repeat creation or reset an unverified account.
                                phase = 'unknown';
                                await api.users.create(user);
                                phase = 'unverified';
                            }
                            if (createdId === undefined) {
                                const list = await api.users.list();
                                const created = list.find(u => u.username === username);
                                if (created?.id == null) throw new Error('未能找到已创建的账户，无法为其设置密码');
                                createdId = created.id;
                                phase = 'created';
                            }
                            const rejected = passwordViolations(await api.users.updatePassword(createdId, password));
                            if (rejected.length) throw new Error(`密码未通过校验：${rejected.join('; ')}`);
                            toast(`已创建用户 "${username}"`);
                            return true;
                        } catch (e: any) {
                            toast(e.message, 'error');
                            return false;
                        } finally {
                            busy = false;
                            form.grid.inert = phase !== 'draft';
                            pw.grid.inert = phase === 'unknown' || phase === 'unverified';
                            if (phase !== 'draft') {
                                notice.hidden = false;
                                notice.textContent = phase === 'created'
                                    ? `账户 "${createdUsername}" 已创建，但密码设置未完成，请在下方重试以完成。`
                                    : phase === 'unverified'
                                    ? `账户 "${createdUsername}" 已创建，但未能核实其身份。请关闭此对话框，刷新用户列表并选中该账户后再修改密码。`
                                    : `无法确认 "${createdUsername}" 是否创建成功。请关闭此对话框，刷新用户列表并核对该账户后，再重新创建或修改密码。`;
                                refresh();
                            }
                            if (submit) {
                                submit.disabled = phase === 'unknown' || phase === 'unverified';
                                submit.textContent = phase === 'created' ? '重试密码设置' : phase === 'unverified' ? '核实账户' : phase === 'unknown' ? '结果未知' : '创建';
                            }
                        }
                    }
                }
            ]
        });
    }

    function editTask(selected?: any) {
        const user = selected || single();
        if (!user) { toast('请先选择用户', 'warn'); return; }
        openEditUserModal(user, { onSaved: refresh });
    }

    function passwordTask(selected: any) {
        const user = selected || single();
        if (!user) { toast('请先选择用户', 'warn'); return; }
        openChangePasswordModal(user);
    }

    async function deleteTask(selected?: any) {
        const user = selected || single();
        if (!user) { toast('请先选择用户', 'warn'); return; }
        const me = store.getState('user');
        if (me && String(me.id) === String(user.id)) {
            toast('不能删除当前登录的用户', 'warn');
            return;
        }
        if (!await confirmDialog('删除用户', `确定要永久删除用户 "${user.username}" 吗？此操作无法撤销。`, { danger: true, okLabel: '删除' })) return;
        try {
            await api.users.remove(user.id);
            toast(`已删除用户 "${user.username}"`);
        } catch (e: any) {
            toast(e.message, 'error');
        }
        refresh();
    }

    const openMenu = (u: any, e: any) => {
        setSel(tableRef.current ? tableRef.current.selectedRows() : [u]);
        // Only YOUR OWN row is suppressed, and only in an SSO session: another
        // user's password stays an admin's to manage, including the break-glass
        // credential on an OIDC-linked local account. The reason rides in the
        // label — ctx items carry no tooltip, and a bare greyed row invites a
        // bug report.
        const ssoSelf = isSsoSelf(u, store.getState('user'));
        contextMenu(e.clientX, e.clientY, [
            { label: '刷新', icon: 'refresh', task: 'doRefreshUser', group: 'user', onClick: () => refresh() },
            { label: '新建用户', icon: 'plus', task: 'doNewUser', group: 'user', onClick: () => newTask() },
            '-',
            { label: '编辑用户', icon: 'edit', task: 'doEditUser', group: 'user', onClick: () => editTask(u) },
            {
                label: ssoSelf ? '修改密码——由 SSO 管理' : '修改密码',
                icon: 'key', disabled: ssoSelf, onClick: () => passwordTask(u)
            },
            '-',
            { label: '删除用户', icon: 'trash', danger: true, task: 'doDeleteUser', group: 'user', onClick: () => deleteTask(u) }
        ]);
    };

    const options = useRef({
        selectable: 'single',
        rowKey: (u: any) => String(u.id),
        emptyText: '暂无用户',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-users',
        onActivate: (u: any) => editTask(u),
        onSelect: (rows: any) => setSel(rows),
        onContextMenu: openMenu
    }).current;

    const hasSel = sel.length > 0;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="用户任务" paneKey="tasks:User Tasks" group="user">
                    <div className="taskbar" data-pane-title="User Tasks">
                        <TaskButton label="刷新" icon="refresh" task="doRefreshUser" onClick={refresh} />
                        <TaskButton label="新建用户" icon="plus" primary task="doNewUser" onClick={() => newTask()} />
                        {hasSel && <TaskButton label="编辑用户" icon="edit" task="doEditUser" onClick={() => editTask()} />}
                        {hasSel && <TaskButton label="删除用户" icon="trash" danger task="doDeleteUser" onClick={() => deleteTask()} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel"><div className="panel-body flush">
                    <DataTableHost columns={COLUMNS} options={options} rows={users}
                        onReady={(t: any) => { tableRef.current = t; }} />
                </div></div>
            </div>
        </div>
    );
}
