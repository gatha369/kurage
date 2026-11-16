import GUI from 'lil-gui';
import { exportParams, MAX_PARTICLES, type Params } from './params';
import { MAX_TENTACLES } from './jelly/chains';

export interface GuiStatus { fps: string; level: string }

/** 画面右上の調整パネル。H キーで表示／非表示 */
export function createGui(params: Params, status: GuiStatus, onChange: () => void) {
  const gui = new GUI({ title: '調整パネル（H で表示切替）' });
  gui.onChange(onChange);

  const st = gui.addFolder('品質');
  st.add(params.quality, 'mode', { 自動: 'auto', 高: 'high', 中: 'mid', 低: 'low' }).name('品質');
  st.add(status, 'fps').name('滑らかさ(fps)').disable().listen();
  st.add(status, 'level').name('現在の品質').disable().listen();

  const bg = gui.addFolder('背景・霞み');
  bg.addColor(params.background, 'color').name('背景の色');
  bg.add(params.background, 'brightness', 0, 2, 0.01).name('背景の明るさ');
  bg.add(params.fog, 'density', 0, 0.25, 0.001).name('霞みの濃さ');

  const sp = gui.addFolder('スポットライト');
  sp.add(params.spot, 'intensity', 0, 10, 0.01).name('明るさ');
  sp.add(params.spot, 'angle', 5, 35, 0.1).name('広がり（度）');
  sp.add(params.spot, 'tiltX', -25, 25, 0.1).name('向き：前後（度）');
  sp.add(params.spot, 'tiltZ', -25, 25, 0.1).name('向き：左右（度）');
  sp.add(params.spot, 'beam', 0, 0.3, 0.001).name('光の筋の強さ');
  sp.add(params.spot, 'flicker', 0, 0.5, 0.001).name('ゆらぎ');

  const li = gui.addFolder('環境光・コースティクス');
  li.add(params.ambient, 'intensity', 0, 1, 0.001).name('環境光の強さ');
  li.add(params.caustics, 'strength', 0, 2, 0.01).name('コースティクスの強さ');

  const pa = gui.addFolder('微粒子');
  pa.add(params.particles, 'count', 0, MAX_PARTICLES, 10).name('数');
  pa.add(params.particles, 'size', 0.2, 4, 0.01).name('大きさ');
  pa.add(params.particles, 'sinkSpeed', 0, 0.3, 0.001).name('沈む速さ');

  const po = gui.addFolder('仕上げ');
  po.add(params.bloom, 'strength', 0, 3, 0.01).name('ブルームの強さ');
  po.add(params.dof, 'strength', 0, 4, 0.01).name('ピント（ぼけ）の強さ');
  po.add(params.grain, 'strength', 0, 0.3, 0.001).name('グレインの強さ');

  const ca = gui.addFolder('カメラ');
  ca.add(params.autoRotate, 'enabled').name('自動周回');
  ca.add(params.autoRotate, 'speed', 0, 3, 0.01).name('自動周回の速さ');

  const be = gui.addFolder('クラゲの傘');
  be.add(params.bell, 'size', 0.5, 1.6, 0.01).name('傘の大きさ');
  be.add(params.bell, 'depth', 0.2, 1.0, 0.01).name('傘の深さ');
  be.add(params.bell, 'irregularity', 0, 0.15, 0.001).name('いびつさ');
  be.add(params.bell, 'period', 1.0, 3.5, 0.01).name('拍動の周期（秒）');
  be.add(params.bell, 'contractTime', 0.15, 1.0, 0.01).name('縮む時間（秒）');
  be.add(params.bell, 'relaxTime', 0.5, 2.5, 0.01).name('開く時間（秒）');
  be.add(params.bell, 'strength', 0, 2, 0.01).name('縮む強さ');
  be.add(params.bell, 'thrust', 0, 1.5, 0.01).name('進む力');
  be.add(params.bell, 'sink', 0, 0.3, 0.001).name('沈む速さ');
  be.add(params.bell, 'transparency', 0, 1, 0.01).name('透明度');
  be.add(params.bell, 'rimWhite', 0, 3, 0.01).name('縁の白さ');
  be.add(params.bell, 'refraction', 0, 3, 0.01).name('屈折の強さ');
  be.add(params.bell, 'blue', 0, 1, 0.01).name('青み');
  be.add(params.bell, 'milk', 0, 1, 0.01).name('乳白感');
  be.addColor(params.bell, 'gonadColor').name('四つ葉模様の色');
  be.add(params.bell, 'gonad', 0, 1.5, 0.01).name('四つ葉模様の濃さ');
  be.add(params.bell, 'canal', 0, 2, 0.01).name('放射管の濃さ');

  const te = gui.addFolder('触手');
  te.add(params.tentacles, 'count', 0, MAX_TENTACLES, 1).name('本数');
  te.add(params.tentacles, 'length', 0.1, 1.5, 0.01).name('長さ');
  te.add(params.tentacles, 'thickness', 0.3, 3, 0.01).name('太さ');
  te.add(params.tentacles, 'variation', 0, 1, 0.01).name('ばらつき');
  te.add(params.tentacles, 'suppleness', 0, 1, 0.01).name('しなやかさ（遅れ）');
  te.add(params.tentacles, 'drag', 0, 3, 0.01).name('水の抵抗');

  const ar = gui.addFolder('口腕');
  ar.add(params.arms, 'length', 0.3, 2.5, 0.01).name('長さ');
  ar.add(params.arms, 'width', 0.03, 0.35, 0.001).name('幅');
  ar.add(params.arms, 'frill', 0, 2, 0.01).name('フリルの強さ');
  ar.add(params.arms, 'lag', 0, 1, 0.01).name('遅れ具合');

  const de = gui.addFolder('傘の歪み（追加章A）');
  const dp = params.deform;
  de.add(params.time, 'scale', 0.1, 1, 0.01).name('時間の速さ');
  de.add(dp, 'strength', 0, 3, 0.01).name('全体のゆがみの強さ');
  de.add(dp, 'pulse', 0, 3, 0.01).name('①拍動時のばらつき');
  de.add(dp, 'waves', 1, 6, 1).name('①ゆがみの波の数');
  de.add(dp, 'variability', 0, 1, 0.01).name('①拍動ごとの変わり方');
  de.add(dp, 'drag', 0, 3, 0.01).name('②水の抵抗のつぶれ');
  de.add(dp, 'turn', 0, 3, 0.01).name('③向きを変える時のゆがみ');
  de.add(dp, 'idle', 0, 3, 0.01).name('④うねりの強さ');
  de.add(dp, 'idleSpeed', 0.1, 3, 0.01).name('④うねりの速さ');
  de.add(dp, 'attack', 0.05, 0.4, 0.01).name('ゆがむ速さ（秒）');
  de.add(dp, 'recover', 0.5, 5, 0.01).name('戻る時間（秒）');
  de.add(dp, 'overshoot', 0, 1, 0.01).name('揺れ返しの強さ');
  de.add(dp, 'hardness', 0, 1, 0.01).name('中心の硬さ');

  const to = gui.addFolder('触れたときの反応（追加章B）');
  const tp = params.touch;
  to.add(tp, 'tapTime', 0.1, 0.8, 0.01).name('タップとみなす時間（秒）');
  to.add(tp, 'tapMove', 2, 40, 1).name('タップとみなす移動量（px）');
  to.add(tp, 'dentDepth', 0, 0.15, 0.001).name('へこみの大きさ');
  to.add(tp, 'dentRadius', 0.08, 0.6, 0.01).name('へこみの広がる範囲');
  to.add(tp, 'dentRecover', 0.3, 5, 0.01).name('へこみの戻る時間（秒）');
  to.add(tp, 'panicRise', 0, 1, 0.01).name('慌て度の上がり方');
  to.add(tp, 'panicMax', 0.2, 1.5, 0.01).name('慌て度の上限');
  to.add(tp, 'calmTime', 3, 40, 0.5).name('落ち着くまでの時間（秒）');
  to.add(tp, 'beatSpeedMax', 0, 2, 0.01).name('慌てた時の拍動の速さ');
  to.add(tp, 'beatStrengthMax', 0, 1, 0.01).name('慌てた時の拍動の強さ');
  to.add(tp, 'flee', 0, 3, 0.01).name('逃げる勢い');
  to.add(tp, 'tentacleShrink', 0, 0.8, 0.01).name('触手の縮こまり');
  to.add(tp, 'returnSpeed', 0.1, 3, 0.01).name('中心へ戻る速さ');
  to.add(tp, 'appendageReaction', 0, 3, 0.01).name('触手・口腕の反応');
  to.add(tp, 'waterPush', 0, 3, 0.01).name('微粒子の押し流され方');

  const actions = {
    export: async () => {
      const json = exportParams(params);
      console.log(json);
      let ok = false;
      try {
        await navigator.clipboard.writeText(json);
        ok = true;
      } catch {
        ok = false;
      }
      exportBtn.name(ok ? 'コピーしました ✓' : 'コピー失敗（コンソールに出力しました）');
      setTimeout(() => exportBtn.name('今の設定を書き出す'), 2000);
    },
  };
  const exportBtn = gui.add(actions, 'export').name('今の設定を書き出す');

  // スマートフォン：最初は隠しておき、隅の歯車ボタンで出し入れする
  // （確認用：アドレスの末尾に ?touch=1 を付けると、パソコンでもスマートフォン向けの表示になる）
  const isTouch = window.matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
  if (isTouch) {
    document.body.classList.add('touch-ui');
    gui.hide();
    const gear = document.createElement('button');
    gear.id = 'gear';
    gear.setAttribute('aria-label', '調整パネルの表示切替');
    gear.textContent = '⚙';
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      gui.show(gui._hidden);
      gear.classList.toggle('on', !gui._hidden);
    });
    document.body.appendChild(gear);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      gui.show(gui._hidden);
    }
  });

  return gui;
}
