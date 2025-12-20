/* ==========================================================================
   Application Entry Point & Event Binding
   ========================================================================== */

const App = {
    init: async () => {
        App.cacheDOM(); // 填充 config.js 中的 UI 对象
        App.renderStaticText();
        App.initPlaceholders(); 
        App.mountInteractiveTree();
        App.attachUploadHandlers();
        App.attachToolbarHandlers();
        await App.fetchDefaultIgnoreRules();
        
        window.addEventListener('beforeunload', (e) => {
            if (STATE.files.length > 0) e.returnValue = UI_TEXT.toast.beforeUnload;
        });
    },

    cacheDOM: () => {
        UI.btns.switchLang = document.getElementById('action-switch-lang');
        UI.inputs.dir = document.getElementById('input-upload-directory');
        UI.inputs.file = document.getElementById('input-upload-files');
        UI.inputs.baseline = document.getElementById('input-upload-baseline');
        
        UI.areas.treeViewer = document.getElementById('viewer-file-tree');
        UI.areas.preview = document.getElementById('editor-merge-result');
        UI.areas.patch = document.getElementById('input-patch-source');
        UI.areas.diff = document.getElementById('viewer-diff-result');
        UI.areas.restore = document.getElementById('input-restore-source');
        
        UI.stats.fileCount = document.getElementById('display-file-count');
        UI.stats.tokenCount = document.getElementById('display-token-estimator');
        UI.stats.baselineName = document.getElementById('display-baseline-name');

        UI.btns.upload = document.getElementById('action-import-dir');
        UI.btns.add = document.getElementById('action-append-files');
        UI.btns.copyTree = document.getElementById('action-copy-structure');
        UI.btns.selectAll = document.getElementById('action-select-all');
        UI.btns.mergeTrigger = document.getElementById('action-merge-content');
        UI.btns.clearProject = document.getElementById('action-reset-workspace');
        UI.btns.copyPreview = document.getElementById('action-copy-result');
        UI.btns.downloadPreview = document.getElementById('action-download-text');
        UI.btns.clearPreview = document.getElementById('action-clear-result');
        UI.btns.clearPatch = document.getElementById('action-clear-patch'); 
        UI.btns.uploadBaseline = document.getElementById('action-upload-baseline');
        UI.btns.previewPatch = document.getElementById('action-preview-patch');
        UI.btns.applyDiff = document.getElementById('action-apply-patch');
        UI.btns.clearDiff = document.getElementById('action-clear-diff');
        UI.btns.downloadZip = document.getElementById('action-export-zip');
        UI.btns.clearRestore = document.getElementById('btnClearRestore');
    },
    switchLanguage: () => {
        // 1. 切换状态
        STATE.lang = STATE.lang === 'zh' ? 'en' : 'zh';

        // 2. 更新全局文本对象
        UI_TEXT = I18N_RESOURCES[STATE.lang];

        // 3. 重新渲染静态文本 (data-i18n)
        App.renderStaticText();

        // 4. 重新初始化占位符 (placeholder)
        App.initPlaceholders();

        // 5. 特殊处理：如果有空状态的 innerHTML，需要手动刷新
        if (!STATE.files.length) {
            if (UI.areas.treeContainer) UI.areas.treeContainer.innerHTML = UI_TEXT.html.treeWaiting;
        }
        if (!UI.areas.diff.textContent.trim()) { // 简单判断是否为空状态
            UI.areas.diff.innerHTML = UI_TEXT.html.diffEmptyState;
        }

        // 6. 提示用户
        Utils.showToast(`Language switched to ${STATE.lang === 'zh' ? '中文' : 'English'}`);
    },

    renderStaticText: () => {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const keyPath = el.getAttribute('data-i18n');
            // 通过 'buttons.import' 这种字符串路径去 UI_TEXT 对象里取值
            const text = keyPath.split('.').reduce((obj, key) => obj && obj[key], UI_TEXT);
            if (text) {
                el.textContent = text;
            } else {
                console.warn(`Missing translation for key: ${keyPath}`);
            }
        });
    },

    initPlaceholders: () => {
        UI.areas.treeViewer.placeholder = UI_TEXT.placeholder.tree;
        UI.areas.preview.placeholder = UI_TEXT.placeholder.merge;
        UI.areas.patch.placeholder = UI_TEXT.placeholder.patch;
        UI.areas.restore.placeholder = UI_TEXT.placeholder.restore;
        UI.areas.diff.innerHTML = UI_TEXT.html.diffEmptyState;
    },

    fetchDefaultIgnoreRules: async () => {
        try {
            const response = await fetch('ignore.txt');
            if (!response.ok) return console.warn("未找到 ignore 文件");
            
            const text = await response.text();
            const rules = text.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            STATE.ignoreRules.push(...rules);
            console.log(`[AIchemy] 已加载 ${rules.length} 条默认过滤规则`);
        } catch (error) {
            console.error("无法加载 ignore 文件:", error);
        }
    },

    mountInteractiveTree: () => {
        const oldArea = UI.areas.treeViewer;
        const newDiv = document.createElement('div');
        newDiv.id = 'guiProjectTree';
        newDiv.className = 'file-tree-widget';
        newDiv.innerHTML = UI_TEXT.html.treeWaiting;
        
        oldArea.parentNode.insertBefore(newDiv, oldArea.nextSibling);
        oldArea.classList.add('hidden');
        UI.areas.treeContainer = newDiv;
    },

    attachUploadHandlers: () => {
        UI.btns.upload.onclick = () => UI.inputs.dir.click();
        
        UI.inputs.dir.onchange = async (e) => {
            const fileList = Array.from(e.target.files);
            if (!fileList.length) return;

            STATE.files = [];
            STATE.projectName = fileList[0].webkitRelativePath.split('/')[0] || "Project";
            STATE.ignoreRules = []; 
            
            await App.fetchDefaultIgnoreRules();
            
            const gitIgnoreFiles = fileList.filter(f => f.name === '.gitignore');
            if (gitIgnoreFiles.length > 0) {
                for (const gitIgnore of gitIgnoreFiles) {
                    const text = await Utils.readFile(gitIgnore);
                    const customRules = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                    STATE.ignoreRules.push(...customRules);
                }
                Utils.showToast(UI_TEXT.toast.gitIgnoreDetected(gitIgnoreFiles.length));
            }

            let loaded = 0;
            let ignoredCount = 0;
            for (const f of fileList) {
                const path = f.webkitRelativePath || f.name;
                if (Utils.shouldIgnore(path)) {
                    ignoredCount++;
                    continue;
                }
                STATE.files.push({ path, content: await Utils.readFile(f), originalFile: f });
                loaded++;
            }
            STATE.needsTreeRebuild = true; // 强制下一次渲染重建 DOM
            Logic.renderProjectState();
            Utils.showToast(UI_TEXT.toast.projectLoaded(loaded, ignoredCount));
            e.target.value = '';
        };

        UI.btns.add.onclick = () => UI.inputs.file.click();
        
        UI.inputs.file.onchange = async (e) => {
            const fileList = Array.from(e.target.files);
            for (const f of fileList) {
                const path = "Extra/" + f.name;
                if (Utils.shouldIgnore(path)) continue;

                const content = await Utils.readFile(f);
                const existIdx = STATE.files.findIndex(x => x.path === path);
                if (existIdx > -1) STATE.files[existIdx].content = content;
                else STATE.files.push({ path, content, originalFile: f });
            }
            STATE.needsTreeRebuild = true; // 强制下一次渲染重建 DOM
            Logic.renderProjectState();
            Utils.showToast(UI_TEXT.toast.addedFiles(fileList.length));
            e.target.value = '';
        };
    },

    attachToolbarHandlers: () => {
        UI.btns.switchLang.onclick = App.switchLanguage;
        UI.btns.copyTree.onclick = () => Utils.copyToClipboard(Logic.generateTreeText());
        UI.btns.clearProject.onclick = () => {
            STATE.files = [];
            STATE.projectName = "Project";
            STATE.ignoreRules = [];
            App.fetchDefaultIgnoreRules();
            Logic.renderProjectState();
            UI.areas.treeContainer.innerHTML = UI_TEXT.html.treeEmptyState;
            UI.areas.preview.value = "";
            UI.stats.baselineName.innerText = UI_TEXT.labels.baselineName;
            Utils.showToast(UI_TEXT.toast.projectCleared);
        };
        UI.btns.selectAll.onclick = () => {
            STATE.files.forEach(f => f.excluded = false);
            Logic.renderProjectState();
            // ✅ 修正：
            Utils.showToast(UI_TEXT.toast.treeRestored(STATE.files.length)); 
        };
        UI.btns.mergeTrigger.onclick = Logic.mergeProjectFiles;
        UI.btns.copyPreview.onclick = () => Utils.copyToClipboard(UI.areas.preview.value);
        UI.btns.clearPreview.onclick = () => UI.areas.preview.value = "";
        
        UI.btns.downloadPreview.onclick = () => {
            const blob = new Blob([UI.areas.preview.value], { type: 'text/plain;charset=utf-8' });
            saveAs(blob, `${STATE.projectName}_${Utils.getTimestamp()}.txt`);
        };

        UI.btns.uploadBaseline.onclick = () => UI.inputs.baseline.click();

        UI.inputs.baseline.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const content = await Utils.readFile(file);
            // 调用 Core 中的逻辑注册基准文件
            PatchLogic.registerBaseline(file.name, content);
            UI.stats.baselineName.innerText = file.name;

            Utils.showToast(`已加载基准文件: ${file.name}`);
            e.target.value = ''; // 重置 input 以允许重复上传同名文件
        };

        UI.btns.previewPatch.onclick = PatchLogic.previewPatch;
        UI.btns.clearPatch.onclick = () => UI.areas.patch.value = "";
        UI.btns.clearDiff.onclick = () => {
            UI.areas.diff.innerHTML = UI_TEXT.html.diffEmptyState;
        };
        UI.btns.applyDiff.onclick = PatchLogic.applyChanges;
        UI.btns.downloadZip.onclick = Logic.generateRestorePackage;
        UI.btns.clearRestore.onclick = () => UI.areas.restore.value = "";
    }
};

document.addEventListener('DOMContentLoaded', App.init);