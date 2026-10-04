import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** 与 serve.mjs 同一套端口优先级，免得改了 config 就停错端口 */
const cfgPort = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8')).port;
  } catch {
    return '';
  }
})();
const port = Number(process.env.PORT || cfgPort || 8080);

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' });
  } catch {
    return '';
  }
};

/** 只认 LISTENING：TIME_WAIT 的残留连接端口还在，但那不是服务在跑 */
const listeners = () =>
  run('netstat', ['-ano'])
    .split('\n')
    .filter((l) => l.includes('LISTENING') && l.includes(`127.0.0.1:${port}`))
    .map((l) => l.trim().split(/\s+/).pop())
    .filter(Boolean);

const owner = (pid) => (run('tasklist', ['/fi', `PID eq ${pid}`, '/nh', '/fo', 'csv']).match(/^"([^"]+)"/) || [])[1] || '';

const pids = listeners();
// 认不准进程名就宁可不杀，别把抢了同一端口的别的程序给结束了
const foreign = pids.map((pid) => [pid, owner(pid)]).find(([, name]) => name.toLowerCase() !== 'node.exe');

if (!pids.length) {
  console.log(`端口 ${port} 上没有服务，已经是停止状态。`);
} else if (foreign) {
  const [pid, name] = foreign;
  console.log(`端口 ${port} 被 "${name || '未知程序'}"（PID ${pid}）占着，不像 map_ai 的服务，先不动它。`);
  console.log(`确认要结束的话自己执行：  taskkill /pid ${pid} /f`);
} else {
  for (const pid of pids) {
    console.log(`正在停止 map_ai 服务（node.exe，PID ${pid}）...`);
    run('taskkill', ['/pid', pid, '/f']);
  }
  const left = listeners();
  console.log(left.length ? `没停掉，端口仍被 PID ${left.join('、')} 占着。` : `已停止，端口 ${port} 释放了。`);
}

// 双击运行时窗口会一闪而过，留在这儿等一声回车
if (process.stdin.isTTY) {
  console.log('\n按回车关闭窗口...');
  await new Promise((done) => process.stdin.once('data', done));
  process.stdin.destroy();
}
