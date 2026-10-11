# 魔刀千刃 v1 归档（2026-10-06）

2026-10-02 至 10-05 的魔刀千刃实现（双形态斩 / 千刃、128 个独立碎片逐个发射、悬停与召回、千刃·回杀等），
在用户要求按《刺客伍六七》原作从零重做后归档。新设计见 `docs/demon-blade-v2.md`。

- 这批代码当时没有提交过 git，这里是唯一副本。
- 只有魔刀专用文件（`DemonBladeModel.ts`、`BladeFlight.ts`、`bladeLab.ts`、`bladeRange.ts`、两个检视页、
  `tests/demon-blade.test.mjs`、两份文档、`art/reviews/demon-blade-20261005/`）是完整的魔刀内容。
- 其余共享文件（`WeaponSystem.ts`、`Viewmodel.ts`、`Projectiles.ts`、`types.ts` 等）是归档当时的整文件快照，
  里面同时含有其他功能的代码，只用于查阅旧魔刀逻辑，不能直接拷回工程。
- 目录不在 `tsconfig` 的 `include` 里，不参与类型检查和构建。
