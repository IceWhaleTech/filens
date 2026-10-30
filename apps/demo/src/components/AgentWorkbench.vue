<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import skillMarkdown from '../../../../skills/filens/SKILL.md?raw';
import WorkbenchIcon from './WorkbenchIcon.vue';

const audience = ref<'human' | 'agent'>('human');
const target = ref('auto');
const scope = ref('global');
const profile = ref('full');
const copied = ref('');
const copyError = ref(false);
const id = useId();
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
const repo = 'https://github.com/IceWhaleTech/filens';
const skillUrl = `${import.meta.env.BASE_URL}skills/filens/SKILL.md`;
const installCommand = computed(() => [
  'npx --yes skills add IceWhaleTech/filens --skill filens',
  target.value === 'auto' ? '' : `--agent ${target.value}`,
  scope.value === 'global' ? '--global' : '',
  '--yes'
].filter(Boolean).join(' '));
const cliCommand = computed(() => `npm install -g ${profile.value === 'full' ? 'filens-cli' : 'filens-cli-lite'}`);
const installPrompt = computed(() => `请为我安装 FiLens CLI 和 Skill。\n\n1. 安装 CLI：\n${cliCommand.value}\n\n2. ${scope.value === 'global' ? '在用户技能目录安装' : '在当前项目目录安装'} FiLens Skill${target.value === 'auto' ? '（自动检测 Agent）' : `（${target.value}）`}：\n${installCommand.value}\n\n3. 运行 filens capacity --json，检查实际支持的操作、格式与 OCR 状态，再按需读取文件。\n\nSkill 原文：${new URL(skillUrl, window.location.href).href}\n安装完成后告诉我结果；如需重新加载技能，请说明。`);
watch([installCommand, cliCommand], () => {
  if (['install', 'cli', 'prompt'].includes(copied.value)) copied.value = '';
});
const capabilities = [
  { icon: 'file', title: '读取文档', description: '读取 PDF、Office 和表格，交付原文与可引用的证据。', command: 'filens read "report.pdf" --json' },
  { icon: 'search', title: '跨文件搜索', description: '搜索目录、压缩包和嵌套文件，保留命中片段与来源。', command: 'filens search "./documents" --query "预算 风险" --json' },
  { icon: 'scan', title: 'OCR 与布局', description: '识别扫描件与图片中的文字，获取可用的页码和坐标。', command: 'filens layout "invoice.png" --json' },
  { icon: 'sliders', title: '提取关键内容', description: '按主题与字数预算选取关键原文，保留出处和省略标记。', command: 'filens summarize "report.pdf" --query "预算 风险" --json' },
  { icon: 'copy', title: '重复文件与相似图片', description: '扫描重复文件和缩放、压缩后的图片变体，输出分组供核对。', command: 'filens similar-images "./photos" --threshold 8 --json' },
  { icon: 'arrow', title: '文件转换', description: '转换支持的格式，例如 DOC 转 DOCX、CSV 转 XLSX。', command: 'filens convert "report.doc" --output "report.docx" --json' }
] as const;

async function copy(value: string, key: string): Promise<void> {
  clearTimeout(feedbackTimer);
  copied.value = '';
  copyError.value = false;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = key;
    feedbackTimer = setTimeout(() => { copied.value = ''; }, 5000);
  } catch {
    copyError.value = true;
  }
}
onUnmounted(() => clearTimeout(feedbackTimer));
</script>

<template>
  <section class="agent-workbench" aria-label="Agent 功能与 Skill 安装">
    <div class="agent-content">
      <header class="agent-intro">
        <p class="wb-eyebrow">FILENS FOR AGENTS</p>
        <h2>让 Agent 读懂你的文件。</h2>
        <p>读取、搜索、识别与转换，在本地完成。把有出处的原文交给 Agent，继续分析与问答。</p>
        <div class="agent-intro-actions">
          <button type="button" class="wb-button agent-primary" @click="copy(installCommand, 'install')"><WorkbenchIcon :name="copied === 'install' ? 'check' : 'download'" />{{ copied === 'install' ? '安装命令已复制' : '一键安装 Skill' }}</button>
          <button type="button" class="wb-button" @click="copy(installPrompt, 'prompt')"><WorkbenchIcon :name="copied === 'prompt' ? 'check' : 'copy'" />{{ copied === 'prompt' ? '安装提示已复制' : '复制给 Agent 的安装提示' }}</button>
        </div>
        <p class="agent-install-note">安装按钮会复制命令，请在本机终端运行；也可以把安装提示发给你的 Agent。</p>
      </header>

      <div class="agent-audience" role="group" aria-label="说明阅读方式">
        <button :id="`${id}-human`" type="button" :aria-pressed="audience === 'human'" :aria-controls="`${id}-human-content`" @click="audience = 'human'">给人看 <span>能力与上手指南</span></button>
        <button :id="`${id}-agent`" type="button" :aria-pressed="audience === 'agent'" :aria-controls="`${id}-agent-content`" @click="audience = 'agent'">给 Agent 看 <span>SKILL.md 原文</span></button>
      </div>

      <div v-show="audience === 'human'" :id="`${id}-human-content`" :aria-labelledby="`${id}-human`">
        <section class="agent-capabilities" aria-label="Agent 能力">
          <article v-for="(capability, index) in capabilities" :key="capability.title" class="agent-card">
            <div class="agent-card-heading"><WorkbenchIcon :name="capability.icon" /><h3>{{ capability.title }}</h3></div>
            <p>{{ capability.description }}</p>
            <div class="agent-example"><code>{{ capability.command }}</code><button type="button" class="wb-icon-button" :aria-label="`复制${capability.title}命令`" @click="copy(capability.command, `example-${index}`)"><WorkbenchIcon :name="copied === `example-${index}` ? 'check' : 'copy'" /></button></div>
          </article>
        </section>
        <p class="agent-boundary">此处展示本地 CLI 用法。运行 <code>filens capacity --json</code> 确认当前安装支持的能力；总结改写和问答由上层 Agent 完成。</p>

        <section class="agent-setup" aria-labelledby="agent-setup-heading">
          <div class="agent-section-heading"><div><p class="wb-eyebrow">GET STARTED</p><h3 id="agent-setup-heading">安装与接入</h3></div><span>需要 Node.js 20.11+</span></div>
          <div class="agent-setup-step">
            <span class="agent-step-number">01</span>
            <div class="agent-step-content">
              <h4>安装 FiLens CLI</h4><p>选择一个版本安装，两者都提供 <code>filens</code> 命令。</p>
              <label class="agent-select">CLI 版本<select v-model="profile"><option value="full">Full · 含中英文 OCR</option><option value="lite">Lite · 按需安装 OCR</option></select></label>
              <div class="agent-command"><code>{{ cliCommand }}</code><button type="button" class="wb-button" @click="copy(cliCommand, 'cli')"><WorkbenchIcon :name="copied === 'cli' ? 'check' : 'copy'" />{{ copied === 'cli' ? '已复制' : '复制 CLI 安装命令' }}</button></div>
              <p v-if="profile === 'lite'" class="agent-step-hint">需要识别图片时，运行 <code>filens setup-ocr</code> 补装 OCR。</p>
            </div>
          </div>
          <div class="agent-setup-step">
            <span class="agent-step-number">02</span>
            <div class="agent-step-content">
              <h4>把 Skill 装给你的 Agent</h4><p>Skill 告诉 Agent 如何调用 FiLens、检查结果和引用原文。</p>
              <div class="agent-selects">
                <label class="agent-select">目标 Agent<select v-model="target"><option value="auto">自动检测</option><option value="codex">Codex</option><option value="claude-code">Claude Code</option><option value="cursor">Cursor</option><option value="opencode">OpenCode</option></select></label>
                <label class="agent-select">安装范围<select v-model="scope"><option value="global">用户目录 · 所有项目可用</option><option value="project">当前项目</option></select></label>
              </div>
              <div class="agent-command"><code>{{ installCommand }}</code><button type="button" class="wb-button" @click="copy(installCommand, 'install')"><WorkbenchIcon :name="copied === 'install' ? 'check' : 'copy'" />{{ copied === 'install' ? '已复制' : '复制 Skill 安装命令' }}</button></div>
              <p class="agent-step-hint">{{ scope === 'project' ? '在目标项目目录执行。' : '安装到用户技能目录。' }}通过 <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noopener noreferrer">skills CLI</a> 安装后，按所用 Agent 的方式重新加载技能或开启新会话。</p>
            </div>
          </div>
          <div class="agent-setup-step">
            <span class="agent-step-number">03</span>
            <div class="agent-step-content"><h4>验证，然后开始使用</h4><p>在终端检查能力，或让 Agent 使用 FiLens 读取你的文件。</p><div class="agent-command"><code>filens capacity --json</code><button type="button" class="wb-button" @click="copy('filens capacity --json', 'capacity')"><WorkbenchIcon :name="copied === 'capacity' ? 'check' : 'copy'" />{{ copied === 'capacity' ? '已复制' : '复制验证命令' }}</button></div></div>
          </div>
        </section>
      </div>

      <section v-show="audience === 'agent'" :id="`${id}-agent-content`" class="agent-skill" :aria-labelledby="`${id}-agent`">
        <header class="agent-skill-heading"><div><h3>SKILL.md</h3><p>与发布包共用的 Skill 原文，包含调用约定、证据定位与错误处理。</p></div><div class="agent-skill-actions"><button type="button" class="wb-button" @click="copy(skillMarkdown, 'skill')"><WorkbenchIcon :name="copied === 'skill' ? 'check' : 'copy'" />{{ copied === 'skill' ? '已复制' : '复制 SKILL.md' }}</button><a class="wb-button" :href="skillUrl" download="SKILL.md"><WorkbenchIcon name="download" />下载 SKILL.md</a></div></header>
        <p class="agent-skill-link">可直接交给 Agent 的地址：<a :href="skillUrl" target="_blank" rel="noopener noreferrer">skills/filens/SKILL.md ↗</a></p>
        <pre tabindex="0" aria-label="SKILL.md 原文"><code>{{ skillMarkdown }}</code></pre>
      </section>

      <footer class="agent-footer"><span><WorkbenchIcon name="lock" />文件在本地处理 · 首次安装需要联网</span><a :href="`${repo}/blob/main/docs/agent-cli.zh-CN.md`" target="_blank" rel="noopener noreferrer">完整 CLI 文档 ↗</a><a :href="skillUrl" download="SKILL.md">下载 Skill</a></footer>
    </div>
    <p v-if="copied || copyError" class="agent-feedback" :class="{ 'is-error': copyError }" role="status">{{ copyError ? '复制失败，请手动选择命令或原文复制。' : copied === 'install' ? '安装命令已复制，请在终端运行。' : copied === 'prompt' ? '安装提示已复制，粘贴给你的 Agent 即可。' : '已复制到剪贴板。' }}</p>
  </section>
</template>

<style src="./agent-workbench.css"></style>
