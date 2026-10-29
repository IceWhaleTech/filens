export function normalizeFontFamilyName(fontFamily: string): string {
  return fontFamily.trim().replace(/^['"]+|['"]+$/g, '');
}

export function normalizeLocalizedFontAlias(fontFamily: string): string {
  const normalized = normalizeFontFamilyName(fontFamily);
  switch (normalized) {
    case '等线': return 'DengXian';
    case '等线 Light':
    case '等线 light': return 'DengXian Light';
    case '宋体': return 'SimSun';
    case '黑体': return 'SimHei';
    case '微软雅黑': return 'Microsoft YaHei';
    case '楷体': return 'KaiTi';
    case '仿宋': return 'FangSong';
    case '游ゴシック': return 'Yu Gothic';
    case '游ゴシック Light':
    case '游ゴシック light': return 'Yu Gothic Light';
    case '맑은 고딕': return 'Malgun Gothic';
    default: return normalized;
  }
}
