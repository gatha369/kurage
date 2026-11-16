import GUI from 'lil-gui';
import { exportParams, MAX_PARTICLES, type Params } from './params';

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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      gui.show(gui._hidden);
    }
  });

  return gui;
}
