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

/** Composition root: connect UI callbacks to domain/application services. */
export function createApp({ document, window, catalog, repository, clipboard, files }) {
  const dom = createDom(document);
  const workspace = new WorkspaceService({ repository, template: catalog.template });
  const editor = new EditorSession(workspace.active.source, { validate: catalog.validate });
  const notifications = createNotifications(dom);
  const ask = createDialog(dom);
  const isDirty = () => editor.dirty || !workspace.persisted;
  const summary = createSummary({ dom, editor, workspace, catalog, isDirty });
  const ready = () => {
    if (!editor.blockReason) return true;
    notifications.toast(editor.blockReason, true);
    return false;
  };
  async function beforeLeave() {
    if (!isDirty()) return true;
    return Boolean(await ask({ title: '离开当前配置？', description: '当前配置有尚未保存的更改，继续将放弃这些编辑。你可以取消并先保存或复制。', confirm: '放弃更改', danger: true, symbol: 'edit' }));
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
  function save() {
    if (!ready()) return;
    try {
      if (reportPersistence(workspace.saveSource(editor.source()))) {
        editor.reset(workspace.active.source);
        notifications.toast('配置已保存到当前浏览器');
        render();
      } else summary.render();
    } catch (error) { notifications.storage(error.message); notifications.toast(error.message, true); }
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
  const panel = createEditorPanel({ dom, editor, catalog, ask, notify: notifications.toast, onChanged: () => summary.render(), ready });
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
      if (persist()) notifications.toast('配置名称已保存');
      profiles.render();
      summary.render();
    },
    remove() { workspace.removeActive(); changedProfile('配置已删除'); }
  } });
  createImportDialog({ dom, readFile: files.read, validate: files.validate, beforeOpen: beforeLeave, onOpened: navigation.closeSidebar, onImport(name, source) {
    workspace.add(name, source);
    changedProfile('导入成功，所有原始参数均已保留');
  } });
  dom.$('header-save-button').addEventListener('click', save);
  dom.$('header-copy-button').addEventListener('click', copy);
  dom.$('copy-output').addEventListener('click', copyOutput);
  function render() { profiles.render(); panel.render(); summary.render(); }
  render();
  notifications.storage(workspace.message);
}
