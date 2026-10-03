/** 外部数据（高德 / DataV 的地名）与用户输入拼进 innerHTML 前一律先转义 */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
