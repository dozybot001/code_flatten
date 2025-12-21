importScripts('https://cdnjs.cloudflare.com/ajax/libs/diff_match_patch/20121119/diff_match_patch.js');

// 如果 utils.js 有 DOM 依赖，建议在这里重写一个简单的 escapeHtml
const escapeHtml = (text) => {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

self.onmessage = (e) => {
    const { patchInput, filesData } = e.data;
    // filesData: { "path/to/file": "content string" }
    
    const dmp = new diff_match_patch();
    
    // 1. 解析 Patch 文本
    const fileRegex = /(?:^|\n)(?:\\+)?=== File:\s*(.*?)\s*===\s*[\r\n]+<<<< SEARCH\s*([\s\S]*?)==== REPLACE\s*([\s\S]*?)>>>>/g;
    const patches = [];
    let match;

    while ((match = fileRegex.exec(patchInput)) !== null) {
        patches.push({
            path: match[1].trim(),
            search: match[2],
            replace: match[3],
            // 生成 ID
            id: `hunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        });
    }

    if (patches.length === 0) {
        self.postMessage({ success: false, error: "invalid_patch" });
        return;
    }

    // 2. 按文件分组
    const patchesByFile = {};
    patches.forEach(p => {
        const pPath = p.path.trim().replace(/^\.\//, '');
        if (!patchesByFile[pPath]) patchesByFile[pPath] = [];
        patchesByFile[pPath].push(p);
    });

    const results = []; // 存放处理后的数据结构

    // 3. 计算 Diff
    for (const [filePath, hunks] of Object.entries(patchesByFile)) {
        const targetFileName = filePath.split('/').pop();
        
        // 在传入的 filesData 中查找原始内容
        let originalContent = filesData[filePath] || filesData[targetFileName] || null;

        const fileResult = {
            filePath,
            hunks: [],
            originalContent, // 传回主线程以便后续应用 Patch
            error: null
        };

        if (originalContent === null) {
            fileResult.error = "File not found in project or baseline";
            results.push(fileResult);
            continue;
        }

        hunks.forEach((hunk) => {
            const searchBlock = hunk.search.replace(/\s+$/, '');
            const occurrenceCount = originalContent.split(searchBlock).length - 1;

            // 计算 diff
            const diffs = dmp.diff_main(hunk.search, hunk.replace);
            dmp.diff_cleanupSemantic(diffs);

            // 生成 HTML
            let oldHtml = "";
            let newHtml = "";
            diffs.forEach(([op, text]) => {
                const safeText = escapeHtml(text);
                if (op === 0) {
                    oldHtml += safeText;
                    newHtml += safeText;
                } else if (op === -1) {
                    oldHtml += `<del>${safeText}</del>`;
                } else if (op === 1) {
                    newHtml += `<ins>${safeText}</ins>`;
                }
            });

            fileResult.hunks.push({
                ...hunk,
                originalSearch: searchBlock,
                isValid: occurrenceCount === 1,
                validityMsg: occurrenceCount === 0 ? "Match Not Found" : (occurrenceCount > 1 ? "Ambiguous Match" : "Ready"),
                diffHtml: { oldHtml, newHtml } // 直接传回 HTML 片段
            });
        });

        results.push(fileResult);
    }

    self.postMessage({ success: true, results });
};