import { EditorSession } from './domain/editor-session.js';
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

/** Composition root: connect UI callbacks to domain/application services. */
export function createApp({ document, window, catalog, repository, clipboard, files, management = null }) {
  const dom = createDom(document);
  const workspace = new WorkspaceService({ repository, template: catalog.template });
  const editor = new EditorSession(workspace.active.source, { validate: catalog.validate, formatOutput: catalog.formatOutput });
  const notifications = createNotifications(dom);
  const ask = createDialog(dom);
  const isDirty = () => editor.sourceDraft !== null || editor.errorCount > 0 || editor.source() !== workspace.active.source || !workspace.persisted || repository.pending || Boolean(repository.error);
  const summary = createSummary({ dom, editor, workspace, catalog, isDirty, persistence: repository });
  const ready = () => {
    if (!editor.blockReason) return true;
    notifications.toast(editor.blockReason, true);
    return false;
  };
  async function beforeLeave() {
    await repository.flush?.();
    if (!isDirty()) return true;
    return Boolean(await ask({ title: '离开当前配置？', description: '当前有未应用的源码、无效输入或保存失败的修改，继续将放弃这些编辑。可取消并先应用源码、修正错误或复制备份。', confirm: '放弃更改', danger: true, symbol: 'edit' }));
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
    if (!automatic && !ready()) return false;
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
      if (repository.remote) repository.flush().then(saved => notifications.toast(saved ? '所有有效修改已保存到服务器' : repository.error, !saved));
      else notifications.toast('所有有效修改已自动保存到当前浏览器');
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
  const navigation = createNavigation({ dom, window, isDirty, onSave: save });
  const panel = createEditorPanel({ dom, editor, catalog, ask, notify: notifications.toast, onChanged: () => save({ automatic: true }), ready });
  function changedProfile(successMessage) {
    editor.reset(workspace.active.source);
    const success = persist();
    render();
    navigation.closeSidebar();
    if (success && successMessage) notifications.toast(successMessage);
  }
  const profiles = createProfilePanel({ dom, workspace, ask, beforeLeave, ready, isDirty, actions: {
    async select(id) {
      if (id === workspace.active.id) { navigation.closeSidebar(); return; }
      if (!(await beforeLeave())) return;
      workspace.select(id);
      changedProfile();
    },
    create(name) { workspace.add(name); changedProfile('新配置已创建'); },
    duplicate(name) { workspace.add(name, editor.source()); changedProfile('已创建独立副本'); },
    rename(name) {
      workspace.rename(name);
      if (persist()) notifications.toast(repository.remote ? '配置名称已提交' : '配置名称已保存');
      profiles.render();
      summary.render();
    },
    remove() { workspace.removeActive(); changedProfile('配置已删除'); }
  } });
  createImportDialog({ dom, readFile: files.read, validate: files.validate, beforeOpen: beforeLeave, onOpened: navigation.closeSidebar, onImport(name, source) {
    workspace.add(name, source);
    changedProfile('导入成功，所有原始参数均已保留');
  } });
  dom.$('restore-input-button').addEventListener('click', async () => {
    const restore = await ask({ title: '恢复输入配置？', description: '将当前配置的全部参数恢复为最初输入或导入的内容，放弃后续编辑和未应用的源码。恢复后会自动保存；其他配置不受影响。', confirm: '恢复输入配置', danger: true, symbol: 'file' });
    if (!restore) return;
    editor.reset(workspace.initialSource);
    let saved = save({ automatic: true });
    render();
    if (saved && repository.remote) saved = await repository.flush();
    notifications.toast(saved ? '已恢复输入配置并自动保存' : '已恢复输入配置，但保存失败，请复制备份', !saved);
  });
  dom.$('header-copy-button').addEventListener('click', copy);
  dom.$('copy-output').addEventListener('click', copyOutput);
  function render() { profiles.render(); panel.render(); summary.render(); }
  render();
  notifications.storage(workspace.message);
  let managementPanel;
  if (management) managementPanel = createManagementPanel({ dom, api: management, ask, notify: notifications.toast, async getConfiguration() {
    if (!ready()) throw new Error(editor.blockReason);
    if (!(await repository.flush())) throw new Error(repository.error || '请等待自动保存完成。');
    return { profileId: workspace.active.id, revision: repository.revision };
  } });
  repository.subscribe?.(() => {
    notifications.storage(repository.error || workspace.message);
    summary.render();
    if (!repository.pending && !repository.error) managementPanel?.refresh();
  });
}
