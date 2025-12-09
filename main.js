let finalContent = "";

// ================= 配置区域 =================
// 通用忽略目录 (涵盖前端、后端、移动端、DevOps)
const IGNORE_DIRS = [
    '.git', '.svn', '.hg', '.idea', '.vscode', '.settings', // IDE & Git
    'node_modules', 'bower_components', // JS
    'build', 'dist', 'out', 'target', // Build outputs
    '__pycache__', '.venv', 'venv', 'env', '.pytest_cache', // Python
    '.dart_tool', '.pub-cache', // Flutter/Dart
    'bin', 'obj', '.gradle', // C# / Java / Gradle
    'vendor', // Go / PHP
    'tmp', 'temp', 'logs', 'coverage', '.next', '.nuxt' // Misc
];

// 通用忽略后缀 (二进制、媒体、锁文件)
const IGNORE_EXTS = [
    // Images/Media
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', 
    '.mp4', '.mp3', '.wav', '.mov', '.avi',
    // Documents/Binaries
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.class', '.jar',
    '.db', '.sqlite', '.sqlite3', '.parquet',
    // Locks & System
    '.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    '.DS_Store', 'Thumbs.db'
];
// ===========================================

document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    resetUI();
    updateStatus(`正在分析 ${files.length} 个文件...`, 'processing');

    // 1. 智能过滤
    const filteredFiles = files.filter(file => {
        const path = file.webkitRelativePath || file.name;
        const parts = path.split('/');
        
        // 过滤隐藏文件（以.开头的文件，除了特定的配置文件可能需要保留，这里简单处理过滤所有 . 开头的文件夹）
        for (let part of parts) {
            if (IGNORE_DIRS.includes(part)) return false;
        }
        // 过滤扩展名
        for (let ext of IGNORE_EXTS) {
            if (path.toLowerCase().endsWith(ext)) return false;
        }
        return true;
    });

    if (filteredFiles.length === 0) {
        updateStatus("未找到有效的代码文件 (所有文件均被过滤规则忽略)。", 'error');
        return;
    }

    updateStatus(`正在读取 ${filteredFiles.length} 个文件...`, 'processing');

    // 2. 生成结构树
    let treeString = "Project Structure:\n";
    const paths = filteredFiles.map(f => f.webkitRelativePath);
    treeString += generateTree(paths);
    treeString += "\n\n================================================\n\n";

    // 3. 读取内容
    let fileContents = "";
    let processedCount = 0;

    for (const file of filteredFiles) {
        try {
            const text = await readFileAsText(file);
            fileContents += `\n=== File: ${file.webkitRelativePath} ===\n`;
            fileContents += text;
            fileContents += `\n\n`;
            processedCount++;
        } catch (err) {
            console.warn(`Skipped binary or unreadable file: ${file.name}`);
        }
    }

    // 4. 完成
    finalContent = treeString + fileContents;
    
    // UI 更新
    document.getElementById('actionBar').style.display = 'flex';
    document.getElementById('previewContainer').style.display = 'block';
    document.getElementById('previewArea').innerText = finalContent.substring(0, 3000) + (finalContent.length > 3000 ? "\n... (更多内容请下载或复制)" : "");
    
    // 计算 Token (粗略: 1 token ≈ 4 chars)
    const tokenCount = Math.ceil(finalContent.length / 4);
    document.getElementById('tokenEstimate').innerText = `Token 估算: ~${tokenCount.toLocaleString()} (GPT-4)`;
    
    updateStatus(`✅ 处理完成！包含 ${processedCount} 个核心文件，总大小 ${(finalContent.length/1024).toFixed(1)} KB`, 'success');
});

// 工具函数
function resetUI() {
    document.getElementById('actionBar').style.display = 'none';
    document.getElementById('previewContainer').style.display = 'none';
    finalContent = "";
}

function updateStatus(msg, type) {
    const el = document.getElementById('status');
    el.innerText = msg;
    el.style.color = type === 'error' ? '#ff5546' : (type === 'success' ? '#81c995' : '#a8abb1');
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        // 尝试读取为文本，如果文件本身是二进制但扩展名漏了，这里可能会乱码，但不影响程序运行
        reader.readAsText(file);
    });
}

async function copyToClipboard() {
    try {
        await navigator.clipboard.writeText(finalContent);
        const btn = document.querySelector('.btn-secondary');
        const originalText = btn.innerHTML;
        btn.innerHTML = "✅ 已复制！";
        setTimeout(() => btn.innerHTML = originalText, 2000);
    } catch (err) {
        alert('复制失败，文件可能太大，请使用下载功能。');
    }
}

function downloadFile() {
    const blob = new Blob([finalContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project_context_prompt.txt';
    a.click();
    URL.revokeObjectURL(url);
}

function generateTree(paths) {
    let tree = {};
    paths.forEach(path => {
        let parts = path.split('/');
        let current = tree;
        parts.forEach(part => {
            current[part] = current[part] || {};
            current = current[part];
        });
    });
    
    function printTree(node, prefix = "") {
        let output = "";
        let keys = Object.keys(node);
        keys.forEach((key, index) => {
            let isLast = index === keys.length - 1;
            let connector = isLast ? "└── " : "├── ";
            if (Object.keys(node[key]).length === 0) {
                output += prefix + connector + key + "\n";
            } else {
                output += prefix + connector + key + "/\n";
                output += printTree(node[key], prefix + (isLast ? "    " : "│   "));
            }
        });
        return output;
    }
    let rootKey = Object.keys(tree)[0];
    return rootKey + "/\n" + printTree(tree[rootKey]);
}