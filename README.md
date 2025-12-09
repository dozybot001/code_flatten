# Code Packer 📦

**Code Packer** 是一个专为 AI 辅助编程（LLM-assisted coding）设计的轻量级 Web 工具。

它旨在解决开发者在使用 ChatGPT、Claude 或 DeepSeek 进行项目级开发时的两个核心痛点：

1.  **上下文投喂难**：如何高效地将多文件项目结构和代码提供给 AI？
2.  **代码应用难**：如何快速将 AI 修改后的多个文件还原到本地项目中？

## ✨ 核心功能

### 1\. 智能打包 (Pack Mode)

将本地项目文件夹一键转化为 **Token 友好** 的 Prompt 文本。

  * **自动过滤**：内置智能规则，自动忽略 `node_modules`、`.git`、Build 产物及二进制文件，只保留核心代码。
  * **结构可视化**：生成清晰的 `Project Structure` 树状图，帮助 AI 理解文件间的引用关系。
  * **格式统一**：将文件名与内容拼接为标准格式，方便 AI 读取。
  * **Token 估算**：实时显示预估 Token 消耗，防止超长。

### 2\. 极速还原 (Unpack Mode)

实现 AI 代码的闭环落地。

  * **逆向解析**：自动识别并提取 AI 回复中的代码块（支持 `=== File: path ===` 标记）。
  * **ZIP 导出**：将提取出的多个文件自动重组并打包为 ZIP 下载，直接覆盖本地项目即可生效。

## 🚀 优势

  * **🛡️ 隐私安全**：所有逻辑均在浏览器端（纯前端）执行，**文件绝不上传服务器**。
  * **⚡️ 提升效率**：告别繁琐的手动复制粘贴，实现“拖入文件夹 -\> 复制 Prompt -\> 粘贴 AI 回复 -\> 下载更新”的极速工作流。
  * **🎨 现代化 UI**：基于 CSS3 变量的深色模式界面，操作流畅，体验舒适。

## 🛠 使用方法

### 打包代码给 AI

1.  打开网页，切换到 **打包模式 (Pack)**。
2.  将项目文件夹拖入上传区域。
3.  在文件列表中勾选/取消需要的文件（默认已过滤垃圾文件）。
4.  点击 **“复制到剪贴板”**，将其发送给 AI。

### 从 AI 还原代码

1.  提示 AI 修改代码时，要求其保留 `Project Structure` 和 `=== File: path ===` 格式（工具内提供了提示词复制功能）。
2.  将 AI 的完整回复复制。
3.  切换到 **还原模式 (Unpack)**，粘贴内容。
4.  点击 **“解析并下载 Zip”**。

## 🔧 技术栈

  * Vanilla JS (ES6+)
  * HTML5 / CSS3 (Flex/Grid, Animations)
  * [JSZip](https://stuk.github.io/jszip/) - 用于 ZIP 打包
  * [FileSaver.js](https://www.google.com/search?q=https://github.com/eligrey/FileSaver.js) - 用于文件下载

-----

**License**
MIT
