/*
 * Shared user create/edit/password modals. Extracted from views/users.js so the
 * top-bar account menu (react/shell.jsx) can offer self-service "Edit Account" /
 * "Change Password" without duplicating the Users grid's logic — one source of
 * truth for the field set and the password-policy enforcement (issue #7).
 */

import { h, toast, modal, field, textInput, select } from '@oie/web-ui';
import api from '@oie/web-api';
import { passwordRequirementHints, passwordRejectedMessage } from '../../core/passwords.js';
import * as store from '../../core/store.js';
import { COUNTRIES, US_STATES, ROLES, INDUSTRIES, placeholderOpts } from '../welcome.js';
import { isSsoSelf, SSO_MANAGED_NOTE } from '../sso-session.js';

/* Fields editable in the web UI; everything else on the User object is
   preserved on round-trip. Extended profile fields (country, state/territory,
   role, business/industry, description) mirror the first-login welcome flow
   (react/welcome.js) — same labels, option sources and model keys, so the
   round-trip to the engine's User model is identical. `type` selects the input
   (text by default); `default` seeds an empty select. */
export const USER_FIELDS = [
    { key: 'username', label: '用户名' },
    { key: 'firstName', label: '名字' },
    { key: 'lastName', label: '姓氏' },
    { key: 'email', label: '电子邮箱' },
    { key: 'country', label: '国家/地区', type: 'select', options: COUNTRIES, default: 'United States' },
    { key: 'stateTerritory', label: '州/地区', type: 'select', options: placeholderOpts(US_STATES) },
    { key: 'phoneNumber', label: '电话' },
    { key: 'organization', label: '机构' },
    { key: 'role', label: '角色', type: 'select', options: placeholderOpts(ROLES) },
    { key: 'industry', label: '所属行业', type: 'select', options: placeholderOpts(INDUSTRIES) },
    { key: 'description', label: '描述', type: 'textarea' }
];

export function passwordViolations(result: any) {
    return api.asList(result, 'string').map(String).filter(s => s.trim());
}

export function gateSubmit(dialog: any, ready: () => boolean): () => void {
    const button = dialog?.el?.querySelector('.modal-foot .btn-primary') as HTMLButtonElement | null;
    const sync = () => { if (button) button.disabled = !ready(); };
    dialog?.el?.addEventListener('input', sync);
    dialog?.el?.addEventListener('change', sync);
    sync();
    return sync;
}

/* A label with a red required-asterisk — Swing's mandatory-field marker
   (UserEditPanel asterisk labels). */
function req(label: any) {
    return h('span', label + ' ', h('span', { style: { color: 'var(--err, #d9534f)' } }, '*'));
}

export function userForm(user: any = {}) {
    const inputs: any = {};
    const grid = h('div.form-grid');
    for (const def of USER_FIELDS) {
        let el: any;
        if (def.type === 'select') {
            el = select(def.options || [], (user as any)[def.key] ?? def.default ?? '');
        } else if (def.type === 'textarea') {
            el = h('textarea', { rows: 4, style: { width: '100%', resize: 'vertical' } });
            el.value = (user as any)[def.key] ?? '';
        } else {
            el = textInput((user as any)[def.key] ?? '');
        }
        inputs[def.key] = el;
        // Username is the only always-required profile field (Swing UserEditPanel).
        grid.appendChild(field(def.key === 'username' ? req(def.label) : def.label, el));
    }
    // State/Territory is US-only (Swing enables it only for United States) —
    // same behaviour as the welcome flow.
    if (inputs.country && inputs.stateTerritory) {
        const syncState = () => {
            const isUS = inputs.country.value === 'United States';
            inputs.stateTerritory.disabled = !isUS;
            if (!isUS) inputs.stateTerritory.value = '';
        };
        inputs.country.addEventListener('change', syncState);
        syncState();
    }
    return { grid, inputs };
}

/* Password + Confirm inputs with up-front policy hints. `optional: true` (Edit
   User) lets a blank pair leave the password unchanged; the default (New User /
   Change Password) requires both. `label` renames the field ("New Password"). */
export function passwordFields({ optional = false, label = '密码', managedNote = '' }: any = {}) {
    // autocomplete=new-password: this pair SETS a password (create user / reset)
    // — the hint stops the browser autofilling the admin's saved login into it
    // and prompts its generator/update flow instead (#24).
    const password = h('input', { type: 'password', autocomplete: 'new-password' });
    const confirm = h('input', { type: 'password', autocomplete: 'new-password' });
    // managedNote: the credential lives elsewhere (SSO), so the pair is greyed
    // and the reason stands in for the policy hint — hiding the fields outright
    // would read as a missing feature.
    const hint = h('div.hint', { class: 'mt-1.5' }, managedNote || null);
    if (managedNote) {
        (password as any).disabled = true;
        (confirm as any).disabled = true;
    } else {
        // Show the configured policy up front (the engine still enforces on
        // submit). Skipped when managed — the late resolve would otherwise
        // overwrite the note with a policy nobody here can act on.
        api.server.passwordRequirements()
            .then((reqs: any) => { const hs = passwordRequirementHints(reqs); if (hs.length) hint.textContent = `密码须包含 ${hs.join(', ')}`; })
            .catch(() => { /* requirements unavailable */ });
    }
    // Required (asterisk) when setting a password; plain when it's optional.
    const passLabel = optional ? label : req(label);
    const confLabel = optional ? `确认${label}` : req(`确认${label}`);
    const children = [h('div.form-grid', field(passLabel, password), field(confLabel, confirm)), hint];
    if (optional && !managedNote) children.push(h('div.hint', { class: 'mt-1.5' }, '留空则保持当前密码不变'));
    // True once either field has input — the caller only pushes a password change then.
    const hasValue = () => Boolean((password as any).value || (confirm as any).value);
    const filled = () => optional || Boolean((password as any).value && (confirm as any).value);
    return {
        password, confirm, hasValue, filled,
        grid: h('div', ...children),
        validate() {
            // Optional + untouched → no password change, nothing to validate.
            if (optional && !hasValue()) return true;
            if (!(password as any).value) { toast('请填写密码', 'warn'); return false; }
            if ((password as any).value !== (confirm as any).value) { toast('两次输入的密码不一致', 'warn'); return false; }
            return true;
        }
    };
}

/* Edit an existing user's profile. `onSaved(user)` fires after a successful
   save (the Users grid refreshes; the account menu re-reads the current user). */
export function openEditUserModal(user: any, { onSaved }: any = {}) {
    const form = userForm(user);
    // Mirror the New User form — profile fields + password — but the password is
    // optional here (blank leaves it unchanged), so an admin can reset a forgotten
    // password from the same place they edit the profile.
    // Computed here, not passed in, so every caller (account menu and the Users
    // grid both open this) gets it without having to remember.
    const pw = passwordFields({
        optional: true, label: '新密码',
        managedNote: isSsoSelf(user, store.getState('user')) ? SSO_MANAGED_NOTE : ''
    });
    const progress = h('div.hint', { role: 'status' });
    const isSelf = String(user.id) === String(store.getState('user')?.id);
    let acceptedProfile: string | null = null;
    let acceptedPassword: string | null = null;
    const dialog = modal({
        title: `编辑用户 — ${user.username}`,
        size: 'wide',
        body: h('div', form.grid, pw.grid, progress),
        buttons: [
            { label: '取消' },
            {
                label: '保存', primary: true,
                onClick: async () => {
                    const username = form.inputs.username.value.trim();
                    if (!username) { toast('请填写用户名', 'warn'); return false; }
                    if (!pw.validate()) return false;
                    const password = (pw.password as any).value;
                    if (isSelf && !(pw.password as any).disabled && username !== user.username && !password) {
                        toast('If you are changing your username, you must also update your password.', 'warn');
                        return false;
                    }
                    try {
                        if (password && acceptedPassword !== password) {
                            const violations = passwordViolations(await api.users.updatePassword(user.id, password));
                            if (violations.length) { toast(passwordRejectedMessage(violations), 'error'); return false; }
                            acceptedPassword = password;
                        }
                        const submitted = { ...user };
                        for (const def of USER_FIELDS) submitted[def.key] = form.inputs[def.key].value.trim();
                        const signature = JSON.stringify(submitted);
                        if (acceptedProfile !== signature) {
                            await api.users.update(user.id, submitted);
                            acceptedProfile = signature;
                            Object.assign(user, submitted);
                        }
                        toast(`已保存用户 "${username}"`);
                        if (onSaved) onSaved(user);
                        return true;
                    } catch (e: any) {
                        if (acceptedPassword) progress.textContent = '密码已保存，但资料尚未保存，请查看错误后重试';
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
    gateSubmit(dialog, () => Boolean(form.inputs.username.value.trim()));
}

/* Change an existing user's password (enforces the server policy up front). */
export function openChangePasswordModal(user: any, { onSaved, message }: any = {}) {
    const pw = passwordFields();
    const notice = message ? h('p', { role: 'alert', class: 'mb-3', style: { color: 'var(--err, #d9534f)' } }, String(message)) : null;
    const dialog = modal({
        title: `修改密码 — ${user.username}`,
        body: h('div', notice, pw.grid),
        buttons: [
            { label: '取消' },
            {
                label: '修改密码', primary: true,
                onClick: async () => {
                    if (!pw.validate()) return false;
                    try {
                        const violations = passwordViolations(await api.users.updatePassword(user.id, (pw.password as any).value));
                        if (violations.length) { toast(passwordRejectedMessage(violations), 'error'); return false; }
                        toast(`已更新 "${user.username}" 的密码`);
                        if (onSaved) onSaved(user);
                        return true;
                    } catch (e: any) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
    gateSubmit(dialog, pw.filled);
}
