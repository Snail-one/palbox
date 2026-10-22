import { EditorSession } from '../../shared/domain/editor-session.js';
import { WorkspaceService } from './application/workspace-service.js';
import { createDom } from './ui/dom.js';
import { createDialog } from './ui/dialog.js';
import { createNotifications } from './ui/notifications.js';
import { createSummary } from './ui/components/summary.js';
import { createEditorPanel } from './ui/editor-panel.js';
import { createProfilePanel } from './ui/profile-panel.js';
import { createImportDialog } from './ui/import-dialog.js';
import { createNavigation } from './ui/navigation.js';
import { createManagementPanel } from './ui/management-panel.js';
import { createLoginLogsPanel } from './ui/login-logs-panel.js';
import { createAccountSecurity } from './ui/account-security.js';

/** Composition root: connect UI callbacks to domain/application services. */
export function createApp({ document, window, catalog, repository, clipboard, files, management }) {
  const dom = createDom(document);
  const workspace = new WorkspaceService({ repository, template: catalog.template });
  let defaultConfiguration = repository.defaultConfiguration;
  const emptySource = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()\n';
  const editor = new EditorSession(workspace.active?.source ?? emptySource, { validate: catalog.validate, formatOutput: catalog.formatOutput, baselineSource: workspace.initialSource });
  function resetEditor() { editor.reset(workspace.active?.source ?? emptySource, { baselineSource: workspace.initialSource }); }
  const notifications = createNotifications(dom);
  const ask = createDialog(dom);
  const isDirty = () => editor.sourceDraft !== null || editor.errorCount > 0 || editor.source() !== (workspace.active?.source ?? emptySource) || !workspace.persisted || repository.pending || Boolean(repository.error);
  const summary = createSummary({ dom, editor, workspace, catalog, isDirty, persistence: repository });
  const ready = () => {
    if (!workspace.active) { notifications.toast('请先安装服务端或手动新建配置。', true); return false; }
    if (!editor.blockReason) return true;
    notifications.toast(editor.blockReason, true);
    return false;
  };
  async function beforeLeave() {
    await repository.flush?.();
    if (!isDirty()) return true;
    return Boolean(await ask({ title: '离开当前配置？', description: '当前有未应用的源码、无效输入或保存失败的修改，继续将放弃这些编辑。可取消并先修正错误或复制备份。', confirm: '放弃更改', danger: true, symbol: 'edit' }));
  }
  function reportPersistence(success) {
    notifications.storage(workspace.message);
    if (!success) notifications.toast(workspace.message, true);
    return success;
  }
  function persist() {
    try { return reportPersistence(workspace.persist()); }
    catch (error) { notifications.storage(error.message); notifications.toast(error.message, true); return false; }
  }
  function save({ automatic = false } = {}) {
    if (!workspace.active || (!automatic && !ready())) return false;
    let success = true;
    const source = editor.source();
    if (source !== workspace.active.source || !workspace.persisted) {
      try {
        success = workspace.saveSource(source);
        notifications.storage(workspace.message);
        if (!success && !automatic) notifications.toast(workspace.message, true);
      } catch (error) {
        success = false;
        notifications.storage(error.message);
        if (!automatic) notifications.toast(error.message, true);
      }
    }
    // Keep the editor and focused control intact, including invalid/source drafts.
    summary.render();
    if (success && !automatic) {
      repository.flush().then(saved => notifications.toast(saved ? '所有有效修改已保存到服务器' : repository.error, !saved));
    }
    return success;
  }
  function copy() {
    if (ready()) return copyOutput();
  }
  async function copyOutput() {
    try {
      await clipboard.write(editor.toIni());
      notifications.toast('完整 INI 配置已复制到剪贴板');
    } catch { notifications.toast('复制失败，请允许剪贴板访问，或在「高级编辑 → 输出源码」中手动复制。', true); }
  }
  let panel;
  const navigation = createNavigation({ dom, window, isDirty, onSave: save, onConfigurationView: mode => panel?.setMode(mode) });
  panel = createEditorPanel({ dom, editor, catalog, ask, notify: notifications.toast, onChanged: () => save({ automatic: true }), ready, onViewChanged: navigation.openEditor, workspace });
  navigation.refresh();
  async function saveProfileSource(id, source, message = '配置源码已保存') {
    if (!workspace.updateSource(id, source)) throw new Error(workspace.message || '保存失败，请复制备份后重试。');
    if (id === workspace.active?.id) { resetEditor(); panel.render(); }
    profiles.render();
    summary.render();
    if (repository.flush && !(await repository.flush())) throw new Error(repository.error || '保存失败，请复制备份后重试。');
    notifications.toast(message);
  }
  function changedProfile(successMessage, { source = false } = {}) {
    resetEditor();
    const success = persist();
    render();
    navigation.closeSidebar();
    navigation.openEditor(source ? 'advanced' : 'form');
    if (source) panel?.showSource();
    if (success && successMessage) notifications.toast(successMessage);
  }
  const profiles = createProfilePanel({ dom, workspace, ask, beforeLeave, ready, isDirty, clipboard, notify: notifications.toast,
    getDefaultConfiguration: () => ({ ...defaultConfiguration, baselineCurrent: Boolean(defaultConfiguration?.version) && defaultConfiguration.version === repository.defaultConfiguration?.version }),
    onSaveSource: saveProfileSource, readFile: files.read, validate: files.validate, onImportSource: async (id, source) => {
    const merged = workspace.mergeImportedChanges(id, source);
    await saveProfileSource(id, merged, '已按导入内容修改这套配置');
  }, actions: {
    async select(id) {
      if (id === workspace.active?.id) {
        navigation.closeSidebar();
        return;
      }
      if (!(await beforeLeave())) return;
      workspace.select(id);
      resetEditor();
      persist();
      render();
      navigation.closeSidebar();
    },
    async create(name) {
      try {
        const { source, origin } = await management.request('configuration-template');
        const created = workspace.add(name, source, { origin });
        const baseline = workspace.profiles.find(item => item.locked)?.initialSource;
        if (baseline) created.initialSource = baseline;
        changedProfile('已创建配置');
      } catch (error) { notifications.toast(error.message, true); }
    },
    async duplicate(name, id = workspace.active?.id, { fromList = false } = {}) {
      const sourceProfile = workspace.profiles.find(profile => profile.id === id) ?? workspace.active;
      let source;
      if (sourceProfile.locked && sourceProfile.source === sourceProfile.initialSource) {
        // An untouched default copy gets managed REST settings and can be applied directly.
        try { ({ source } = await management.request('default-configuration')); }
        catch (error) { notifications.toast(error.message, true); return; }
      } else {
        source = id === workspace.active?.id ? editor.source() : sourceProfile.source;
      }
      try {
        const created = workspace.add(name, source, { select: !fromList, origin: `复制自「${sourceProfile.name}」` });
        const baseline = workspace.profiles.find(item => item.locked)?.initialSource;
        if (baseline) created.initialSource = baseline;
      }
      catch (error) { notifications.toast(error.message, true); return; }
      if (!fromList) { changedProfile('已创建独立副本'); return; }
      const success = persist();
      profiles.render();
      summary.render();
      if (success) notifications.toast('已创建独立副本');
    },
    rename(name, id = workspace.active?.id) {
      try { workspace.rename(name, id); }
      catch (error) { notifications.toast(error.message, true); return; }
      if (persist()) notifications.toast('配置名称已提交');
      profiles.render();
      summary.render();
    },
    async remove(id = workspace.active?.id, { fromList = false } = {}) {
      const activeRemoved = id === workspace.active?.id;
      try { workspace.remove(id); }
      catch (error) { notifications.toast(error.message, true); return; }
      if (!fromList) { changedProfile('配置已删除'); return; }
      if (activeRemoved) resetEditor();
      const success = persist();
      profiles.render();
      if (activeRemoved) panel.render();
      summary.render();
      if (success) notifications.toast('配置已删除');
    }
  } });
  createImportDialog({ dom, readFile: files.read, validate: files.validate, beforeOpen: beforeLeave, onOpened: navigation.closeSidebar, async onImport(name, source, origin) {
    const { source: defaultSource } = await management.request('default-configuration');
    workspace.importConfiguration(name, source, defaultSource, { origin });
    changedProfile('已基于游戏默认配置导入，差异已标记为修改');
  } });
  dom.$('restore-input-button').addEventListener('click', async () => {
    if (!workspace.active) return;
    const restore = await ask({ title: '恢复输入配置？', description: '将当前配置恢复为初始基准并自动保存。已检测到官方默认配置时，基准就是这份官方默认；尚未安装时恢复为创建时的内容。其他配置不受影响。', confirm: '恢复输入配置', danger: true, symbol: 'file' });
    if (!restore) return;
    editor.reset(workspace.initialSource);
    let saved = save({ automatic: true });
    render();
    if (saved) saved = await repository.flush();
    notifications.toast(saved ? '已恢复输入配置并自动保存' : '已恢复输入配置，但保存失败，请复制备份', !saved);
  });
  dom.$('header-copy-button').addEventListener('click', copy);
  dom.$('copy-output').addEventListener('click', copyOutput);
  function render() { profiles.render(); panel.render(); summary.render(); }
  render();
  notifications.storage(workspace.message);
  const managementPanel = createManagementPanel({ dom, api: management, ask, notify: notifications.toast, onWorkspaceChanged(revision, defaults) {
    if (defaults && (defaults.state !== defaultConfiguration?.state || defaults.version !== defaultConfiguration?.version)) {
      defaultConfiguration = defaults;
      profiles.render();
    }
    if (revision > repository.revision && !isDirty() && !document.querySelector('dialog[open]')) window.location.reload();
  }, onDefaultsImported() {
    if (!isDirty() && !document.querySelector('dialog[open]')) window.location.reload();
    else notifications.toast('官方默认配置已导入，请复制当前草稿后刷新页面。');
  }, async getConfiguration() {
    if (!ready()) throw new Error(editor.blockReason);
    if (!(await repository.flush())) throw new Error(repository.error || '请等待自动保存完成。');
    return { profileId: workspace.active?.id, revision: repository.revision };
  } });
  createLoginLogsPanel({ dom, api: management, window });
  createAccountSecurity({ dom, api: management, clipboard, notify: notifications.toast });
  repository.subscribe?.(() => {
    notifications.storage(repository.error || workspace.message);
    summary.render();
    if (!repository.pending && !repository.error) managementPanel?.refresh();
  });
}
