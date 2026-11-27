// 祸斗（第三章群怪）：扑咬自然出得来；吃火要附近有地上的火（FireFeed 登记表），吃过火才会喷火——
// 摆一片地火：跑过去（seekFire，跑步步态，同 Move）→ 低头吃（eat）→ 肚子鼓起后对玩家喷火（spitWindup → spit）。
// 吠叫（bark）不是状态，是 run 里叠的一下仰头（pBark 从 1 衰减）：关掉 AI 原地站着拨一下 pBark，衰减期间起名 bark
// （吠声由玩法播，片段里没有音效事件）
export default {
  expect: ['biteWindup', 'bite', 'recover', 'eat', 'spitWindup', 'spit', 'bark'],
  locomotion: ['run', 'seekFire'],
  scenes: [
    {
      name: '吃火 → 喷火',
      props: [{ kind: 'fire', at: [2.5, 2], radius: 0.8 }],
      player: { at: [0, 0, 6.5] },
      warmup: 0.8,
      start: (e) => { e.eatCooldown = 0; e.cooldown = 0.6; },
      seconds: 7,
      capture: ['eat', 'spitWindup', 'spit'],
    },
    {
      name: '吠叫（原地）',
      player: { dist: 10 },
      start: (e) => { e.think = () => {}; e.velocity.set(0, 0, 0); e.state = 'run'; e.pBark = 1; },
      step: (e) => { e.velocity.set(0, e.velocity.y, 0); },
      label: (e) => (e.state === 'run' && e.pBark > 0.04 ? 'bark' : e.state),
      seconds: 1.5,
      capture: ['bark'],
    },
  ],
};
