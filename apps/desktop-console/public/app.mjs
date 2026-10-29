import { scoreFrame } from '/vision.mjs';
const $ = id => document.getElementById(id);
const canvas = $('preview'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const video = $('video');
const reference = await (await fetch('/reference.json')).json();
const { csrf } = await (await fetch('/api/session')).json();
let stream, armed = false, sourceImage, busy = false, lastTime = -1, lastFresh = 0;
let roi = { x: 0, y: 0, width: 1, height: 1 }, drag;
const say = (status, detail) => { $('status').textContent = status; $('detail').textContent = detail; };
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'x-gamepulse-csrf': csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '操作失败');
  return data;
}
function paint(source) {
  const width = source.videoWidth || source.naturalWidth, height = source.videoHeight || source.naturalHeight;
  if (!width || !height) return null;
  ctx.drawImage(source, roi.x * width, roi.y * height, roi.width * width, roi.height * height, 0, 0, 640, 324);
  $('empty').hidden = true;
  return scoreFrame(ctx.getImageData(0, 0, 640, 324), reference);
}
function showScore(result) {
  $('score').textContent = `${(result.confidence * 100).toFixed(1)}%`;
}
async function stop(detail = '本轮已停止，重新开始需点击监控按钮。') {
  armed = false; $('stop').disabled = true; $('arm').disabled = !stream;
  say('监控已停止', detail);
  try { await api('stop'); } catch { say('本地连接异常', '请检查控制台进程，再重新开始。'); }
}
async function startCapture() {
  $('capture').disabled = true;
  try {
    const request = navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
    await stop();
    const previous = stream; stream = undefined;
    previous?.getTracks().forEach(track => track.stop());
    stream = await request;
    sourceImage = undefined; roi = { x: 0, y: 0, width: 1, height: 1 };
    video.srcObject = stream; await video.play(); lastTime = -1; lastFresh = Date.now();
    $('arm').disabled = false;
    const activeStream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (stream === activeStream) { stream = undefined; stop('共享已结束，请重新选择窗口。'); } });
    say('画面已连接', '检查选区覆盖整个客户端，再开始本轮监控。');
  } catch (error) { say('未能共享画面', `${error.name}：请使用本机 Edge/Chrome，并允许窗口共享。`); }
  finally { $('capture').disabled = false; }
}
// Capture must be invoked before any await, otherwise browsers reject activation.
$('capture').onclick = startCapture;
$('arm').onclick = async () => {
  if (!stream || sourceImage || document.hidden) return;
  try { await api('arm'); armed = true; $('arm').disabled = true; $('stop').disabled = false; say('正在留意接受弹窗', '每轮最多提醒一次，用户仍需手动接受对局。'); }
  catch (error) { say('无法开始', error.message); }
};
$('stop').onclick = () => stop();
$('reset').onclick = async () => { await stop('选区已重置，请重新开始监控。'); roi = { x: 0, y: 0, width: 1, height: 1 }; if (sourceImage) showScore(paint(sourceImage)); };
function position(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}
canvas.onpointerdown = event => { if (!stream && !sourceImage) return; drag = position(event); canvas.setPointerCapture(event.pointerId); stop('正在调整客户端区域，请重新开始监控。'); };
canvas.onpointerup = event => {
  if (!drag) return;
  const end = position(event), x = Math.min(drag.x, end.x), y = Math.min(drag.y, end.y);
  const width = Math.abs(end.x - drag.x), height = Math.abs(end.y - drag.y); drag = undefined;
  if (width < .25 || height < .25) return say('选区太小', '请框选整个客户端，不要只框接受按钮。');
  roi = { x: roi.x + x * roi.width, y: roi.y + y * roi.height, width: roi.width * width, height: roi.height * height };
  if (sourceImage) showScore(paint(sourceImage));
  say('选区已更新', '确认整个客户端内容比例正确后，再开始本轮监控。');
};
$('file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  await stop(); const previous = stream; stream = undefined; previous?.getTracks().forEach(track => track.stop());
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode(); sourceImage = image;
    roi = { x: 0, y: 0, width: 1, height: 1 };
    const result = paint(image); showScore(result);
    say(result.confidence >= .9 ? '截图预演：命中参考弹窗' : '截图预演：未命中参考弹窗', '仅在本机分析，没有发送微信。可拖动调整整个客户端区域。');
  } catch { say('无法读取截图', '请选择有效的 PNG、JPEG 或 WebP。'); }
  finally { URL.revokeObjectURL(url); $('arm').disabled = true; }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && armed) stop('本页进入后台，监控已暂停。保持页面可见后重新开始。'); });
async function tick() {
  try {
    if (stream && !drag && video.readyState >= 2 && !busy) {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime; lastFresh = Date.now();
        const result = paint(video); if (!result) return;
        showScore(result);
        if (armed) {
          busy = true;
          const response = await api('observe', { confidence: result.confidence });
          if (response.state === 'notified') { armed = false; $('arm').disabled = false; $('stop').disabled = true; say('提醒已由微信受理', '请返回电脑手动接受。下一轮匹配需重新开始监控。'); }
        }
      } else if (armed && Date.now() - lastFresh > 3000) await stop('画面超过 3 秒没有更新，请检查客户端是否最小化或采集已暂停。');
    }
  } catch (error) {
    armed = false; $('arm').disabled = !stream; $('stop').disabled = true;
    say('提醒状态需要检查', `${error.message}。不自动重发，请检查微信与 SSH 连接。`);
  } finally { busy = false; setTimeout(tick, 250); }
}
tick();
