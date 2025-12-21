// js/worker-zip.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

self.onmessage = async (e) => {
    const { content, config } = e.data;
    const { MAGIC_TOKEN, ESCAPED_TOKEN } = config; // 从主线程传入配置常量

    try {
        const zip = new JSZip();
        const headerRegex = /(?:^|\n)(?:\\+)?=== File:\s*(.*?)\s*===/g;
        
        let match;
        let count = 0;
        const files = [];

        // 1. 扫描所有文件标记
        while ((match = headerRegex.exec(content)) !== null) {
            files.push({
                path: match[1].trim(),
                startIndex: match.index + match[0].length,
                fullMatchIndex: match.index
            });
        }

        if (files.length === 0) {
            self.postMessage({ success: false, error: "no_tags" });
            return;
        }

        // 2. 提取内容
        for (let i = 0; i < files.length; i++) {
            const current = files[i];
            const next = files[i + 1];
            
            // 截取当前文件块
            let rawChunk = next 
                ? content.substring(current.startIndex, next.fullMatchIndex) 
                : content.substring(current.startIndex);

            let cleanContent = "";
            let processedChunk = rawChunk.trim();

            // 处理 Markdown 代码块包裹
            const hasOpeningFence = /^\s*```/.test(processedChunk);
            const hasClosingFence = /```\s*$/.test(processedChunk);

            if (hasOpeningFence && hasClosingFence) {
                const firstNewLineIndex = processedChunk.indexOf('\n');
                const lastFenceIndex = processedChunk.lastIndexOf('```');

                if (firstNewLineIndex !== -1 && lastFenceIndex > firstNewLineIndex) {
                    cleanContent = processedChunk.substring(firstNewLineIndex + 1, lastFenceIndex);
                }
            } else {
                // 回退模式：直接取内容
                cleanContent = rawChunk.trim();
            }

            // 还原转义字符
            cleanContent = cleanContent.replaceAll(ESCAPED_TOKEN, MAGIC_TOKEN);

            if (cleanContent) {
                zip.file(current.path, cleanContent);
                count++;
            }
        }

        // 3. 生成二进制流 (这也是耗时操作)
        const blob = await zip.generateAsync({ type: "blob" });
        
        self.postMessage({ success: true, blob, count });

    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};