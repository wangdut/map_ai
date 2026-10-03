import { appConfig, saveAmapKey } from '../config.js';

/**
 * 高德 key 配置弹窗。
 * 明文只存在于「用户粘贴 → 本次 POST」这一瞬间：页面里不回填、不打印，
 * 服务端只回掩码，所以截图、控制台、git 里都不会出现 key。
 */
export function createSettings({ ui, onChange }) {
  const mask = document.getElementById('settingsMask');
  const keyIn = document.getElementById('stKey');
  const showChk = document.getElementById('stShow');
  const stateEl = document.getElementById('stState');
  const saveBtn = document.getElementById('stSave');
  const delBtn = document.getElementById('stDelete');
  const warnEl = document.getElementById('stWarn');

  function renderState() {
    stateEl.textContent = appConfig.hasAmapKey
      ? `当前：已配置 ${appConfig.amapKeyMask || '(已保存)'}`
      : '当前：未配置（免 key 模式）';
    stateEl.classList.toggle('on', appConfig.hasAmapKey);
    delBtn.disabled = !appConfig.hasAmapKey;
    const canSave = appConfig.proxy;
    saveBtn.disabled = !canSave;
    warnEl.classList.toggle('warn', !canSave);
    warnEl.textContent = canSave
      ? ''
      : '当前不是通过 node serve.mjs 打开，无法从页面保存：请启动本地服务，或手动把 key 写进 config.json。';
  }

  function open() {
    keyIn.value = '';
    showChk.checked = false;
    keyIn.type = 'password';
    renderState();
    mask.classList.remove('hidden');
    keyIn.focus();
  }

  function close() {
    keyIn.value = '';
    mask.classList.add('hidden');
  }

  async function submit(value, emptyAsDelete) {
    const key = value.trim();
    if (!key && !emptyAsDelete) return ui.toast('请输入 key，或点「删除 key」');
    saveBtn.disabled = true;
    try {
      const r = await saveAmapKey(key);
      ui.toast(key ? `已保存高德 key（${r.amapKeyMask}），POI 搜索与高德路径已启用` : '已删除高德 key，回到免 key 模式');
      close();
      onChange?.();
    } catch (e) {
      ui.toast(`保存失败：${e.message}`);
      renderState();
    } finally {
      saveBtn.disabled = false;
    }
  }

  document.getElementById('settingsBtn').addEventListener('click', open);
  document.getElementById('stClose').addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });
  showChk.addEventListener('change', () => {
    keyIn.type = showChk.checked ? 'text' : 'password';
  });
  keyIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit(keyIn.value, false);
  });
  saveBtn.addEventListener('click', () => submit(keyIn.value, false));
  delBtn.addEventListener('click', () => submit('', true));

  return {
    open,
    close,
    get isOpen() {
      return !mask.classList.contains('hidden');
    },
  };
}
