// 炭童（第三章群怪）：扑抓、抛炭自然出得来；吹火要身边 3 米内有同伴死后留下的余烬炭堆（tantong_ember）——
// 放一堆炭当友军桩，炭童追击时 findPile 找到它：走过去（blowGo）、蹲下吹（blow）
export default {
  expect: ['pounceWindup', 'pounce', 'flail', 'throwWindup', 'throwRelease', 'recover', 'blowGo', 'blow'],
  scenes: [
    {
      name: '吹火复燃',
      props: [{ kind: 'ally', id: 'tantong_ember', at: [1.8, 1.4] }],
      player: { at: [0, 0, 8] },
      warmup: 0.8,
      seconds: 3,
      capture: ['blowGo', 'blow'],
    },
  ],
};
